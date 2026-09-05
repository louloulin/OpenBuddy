#!/usr/bin/env node
/**
 * P3-03: IPC dispatch hot-path micro-benchmark.
 *
 * Measures the per-call cost of the validation + payload-extraction logic
 * that runs on EVERY renderer-initiated IPC call (validateRpcRequestPayload
 * + rpcPayload). We avoid loading the compiled main bundle because it
 * transitively imports `electron` (not available in plain Node).
 *
 * Instead, we re-implement the hot path here against the actual
 * `@openbuddy/plugin-host` schema validator (if reachable) and measure it.
 * The numbers represent the floor cost that every IPC handler pays —
 * anything expensive in the dispatcher's wrapper code shows up here.
 *
 * Output:
 *   - human-readable summary printed to stdout
 *   - JSON written to evidence/perf/ipc-latency-<timestamp>.json
 *
 * Usage:
 *   node scripts/perf/ipc-latency.mjs
 *   node scripts/perf/ipc-latency.mjs --iterations=10000
 *   node scripts/perf/ipc-latency.mjs --inner=100  # ops per sample
 *   node scripts/perf/ipc-latency.mjs --json evidence/perf/x.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function arg(name, fallback) {
  const list = process.argv.slice(2);
  const prefixed = list.find((a) => a.startsWith(`--${name}=`));
  if (prefixed) {
    return prefixed.split("=", 2)[1] ?? fallback;
  }
  const flag = list.indexOf(`--${name}`);
  if (flag !== -1 && flag + 1 < list.length && !list[flag + 1].startsWith("--")) {
    return list[flag + 1];
  }
  return fallback;
}

function numArg(name, fallback) {
  const v = arg(name, fallback);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const iterations = numArg("iterations", 5000);
const innerLoops = numArg("inner", 50);
const jsonPath = arg("json", join("evidence", "perf", `ipc-latency-${Date.now()}.json`));

// --- Reproduce the hot path exactly as dispatchTypedRpc does it. -----------
//
// We import the real validator from @openbuddy/plugin-host so the numbers
// reflect production cost, not a guess. The source is TS, so we transpile
// on the fly with the same TypeScript that ships with the monorepo.
let validateRpcRequestPayload = null;
try {
  const ts = await import("typescript");
  const validatorSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(
      pathToFileURL(
        join(repoRoot, "packages/runtime/openbuddy-plugin-host/src/rpc-contract.ts"),
      ),
      "utf8",
    ),
  );
  const transpiled = ts.transpileModule(validatorSrc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  new Function("module", "exports", transpiled.outputText ?? transpiled)(m, m.exports);
  validateRpcRequestPayload = m.exports.validateRpcRequestPayload;
} catch {
  // Validator unreachable; the dispatchTypedRpc unit test suite measures it
  // end-to-end. We fall back to simulating the validation cost locally.
}

function rpcPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RPC payload must be an object");
  }
  return value;
}

// Fallback validator — shape-checks the payload. This approximates what
// the JSON-schema-driven validator does without needing TypeScript at runtime.
function fallbackValidate(method, payload) {
  if (typeof method !== "string" || method.length === 0) {
    throw new Error("method required");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("payload must be object");
  }
  // Cheap structural scan — representative of the validator's per-key work.
  for (const key of Object.keys(payload)) {
    if (typeof payload[key] === "string" && payload[key].length > 1024) {
      throw new Error("payload string too long");
    }
  }
  return true;
}

const validator = validateRpcRequestPayload ?? fallbackValidate;

const METHODS = [
  { method: "host.describe", payload: {} },
  { method: "agent.init", payload: { cwd: "/tmp", modelId: "noop" } },
  { method: "session.list", payload: { cwd: "/tmp", limit: 50 } },
  { method: "plugin.snapshot", payload: { pluginId: "deepseek-cordis", scope: "all" } },
];

function stats(samples) {
  if (samples.length === 0) return { mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    mean: sum / sorted.length,
    median: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: sorted.length,
  };
}

function benchmark(fn, iters, inner) {
  // Warm-up pass to populate any JIT caches.
  for (let i = 0; i < Math.min(200, iters); i += 1) fn(inner);
  const samples = new Array(iters);
  for (let i = 0; i < iters; i += 1) {
    const start = performance.now();
    fn(inner);
    samples[i] = performance.now() - start;
  }
  return stats(samples);
}

function formatStats(label, s, inner) {
  const perOp = (n) => (s.mean / (inner || 1)).toFixed(5);
  return `${label.padEnd(38)} mean=${s.mean.toFixed(3)}ms p50=${s.median.toFixed(3)}ms p95=${s.p95.toFixed(3)}ms p99=${s.p99.toFixed(3)}ms (per-op≈${perOp()}ms)`;
}

console.log(`ipc-latency: ${iterations} samples × ${innerLoops} ops/sample`);
console.log(`validator: ${validateRpcRequestPayload ? "real (transpiled)" : "fallback"}\n`);

// 1. Pure payload extraction (no schema validation).
console.log("--- payload extraction only ---");
console.log(
  formatStats(
    `rpcPayload({}) [${innerLoops}×]`,
    benchmark((n) => {
      for (let i = 0; i < n; i += 1) rpcPayload({});
    }, iterations, innerLoops),
    innerLoops,
  ),
);

// 2. Schema validation + payload extraction (the actual IPC hot path).
console.log("\n--- validate + extract combined ---");
const results = {};
for (const { method, payload } of METHODS) {
  // Pre-build rpc envelope outside the loop so we only measure validation work.
  const envelope = { method, payload };
  const stat = benchmark((n) => {
    for (let i = 0; i < n; i += 1) {
      try {
        validator(envelope.method, envelope.payload);
        rpcPayload(envelope.payload);
      } catch { /* unknown method is fine for benchmark */ }
    }
  }, iterations, innerLoops);
  console.log(formatStats(method, stat, innerLoops));
  results[method] = { ...stat, perOpMeanMs: stat.mean / innerLoops };
}

// 3. Compare against a baseline "do nothing" loop to put the numbers in context.
console.log("\n--- baseline ---");
console.log(
  formatStats(
    `noop loop [${innerLoops}×]`,
    benchmark((n) => {
      for (let i = 0; i < n; i += 1) {
        /* noop */
      }
    }, iterations, innerLoops),
    innerLoops,
  ),
);

const payload = {
  timestamp: new Date().toISOString(),
  iterations,
  innerLoops,
  validator: validateRpcRequestPayload ? "real" : "fallback",
  note: validateRpcRequestPayload
    ? "validateRpcRequestPayload transpiled from openbuddy-plugin-host"
    : "fallback validator used; see electron/main/__tests__/dispatch-rpc-realhandlers.test.ts for end-to-end numbers",
  results,
};
const fullJsonPath = join(repoRoot, jsonPath);
await mkdir(dirname(fullJsonPath), { recursive: true });
await writeFile(fullJsonPath, JSON.stringify(payload, null, 2));
console.log(`\nwrote ${fullJsonPath}`);