#!/usr/bin/env node
/**
 * chat-render-bench.mjs — CLI shim around the chat-render perf bench.
 *
 * The actual JSX render benchmark lives in `_chat-render-jsdom.test.ts`
 * because React + JSX require Vite's transform pipeline (vitest + jsdom).
 * This script:
 *
 *   1. Parses --iterations / --messages / --json / --strict CLI flags.
 *   2. Spawns `vitest run _chat-render-jsdom.test.ts` with the same flags
 *      forwarded as env vars so the test writes its JSON artifact to the
 *      expected path.
 *   3. With --strict, exits non-zero if the artifact's `within60Fps` flag
 *      is false (i.e. the chat surface blew the 60 fps budget).
 *
 * Usage:
 *   node scripts/perf/chat-render-bench.mjs
 *   node scripts/perf/chat-render-bench.mjs --strict
 *   node scripts/perf/chat-render-bench.mjs --json evidence/perf/x.json
 *
 * Exit codes:
 *   0 = bench ran, frame budget held
 *   1 = bench failed OR --strict and frame budget violated
 *   2 = invocation error
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);

function argValue(key, fallback) {
  const hit = argv.find((arg) => arg.startsWith(`--${key}=`));
  return hit ? hit.split("=")[1] : fallback;
}
function argBool(key) {
  return argv.includes(`--${key}`);
}

const iterations = argValue("iterations", "100");
const messages = argValue("messages", "200");
const explicitJson = argValue("json", "");
const strict = argBool("strict");

// Forward JSON path as an env var so the test picks it up. We strip the
// --json= flag from the args before forwarding to vitest so it doesn't
// trip the test runner's parser.
const env = {
  ...process.env,
  CHAT_RENDER_OUT_PATH: explicitJson || "",
};
// We don't expose iterations/messages to the test yet (the test uses
// its own constants), but we keep the args for forward-compat in case
// future rounds want to tune them via CLI.
env.CHAT_RENDER_ITERATIONS = iterations;
env.CHAT_RENDER_MESSAGES = messages;

const vitestArgs = [
  "run",
  "--reporter=dot",
  "scripts/perf/_chat-render-jsdom.test.ts",
];

// Use `node_modules/.bin/vitest` directly so we don't trigger pnpm's
// postinstall hooks (which can fail in environments where build scripts
// have not been approved via `pnpm approve-builds`). The bin entry is a
// small shell shim — invoking it via `sh` keeps the behaviour identical
// to `pnpm exec vitest …`.
const vitestBin = resolve(repoRoot, "node_modules", ".bin", "vitest");
console.log(`[chat-render-bench] spawning: sh ${vitestBin} ${vitestArgs.join(" ")}`);
const result = spawnSync("sh", [vitestBin, ...vitestArgs], {
  cwd: repoRoot,
  stdio: "inherit",
  env,
});

if (result.status !== 0) {
  console.error(`[chat-render-bench] vitest failed with exit ${result.status}`);
  process.exit(result.status ?? 1);
}

// Locate the JSON artifact the test wrote. Either the explicit path the
// caller asked for, or the most recent one matching the timestamp pattern.
let artifactPath = explicitJson;
if (!artifactPath) {
  const dir = join(repoRoot, "evidence", "perf");
  if (!existsSync(dir)) {
    console.error(`[chat-render-bench] evidence/perf/ missing and no --json given`);
    process.exit(2);
  }
  const candidates = readdirSync(dir)
    .filter((f) => f.startsWith("chat-render-bench-") && f.endsWith(".json"))
    .sort();
  if (candidates.length === 0) {
    console.error(`[chat-render-bench] no chat-render-bench-*.json artifact in evidence/perf/`);
    process.exit(2);
  }
  artifactPath = join(dir, candidates[candidates.length - 1]);
}

if (!existsSync(artifactPath)) {
  console.error(`[chat-render-bench] artifact not found: ${artifactPath}`);
  process.exit(2);
}

const summary = JSON.parse(readFileSync(artifactPath, "utf8"));
console.log("");
console.log("=== chat-render-bench summary ===");
console.log(JSON.stringify(summary, null, 2));

if (strict && summary.budget.within60Fps === false) {
  console.error(
    `[chat-render-bench] --strict: frame budget violated ` +
      `(sumWorstCaseMsPerFrame=${summary.budget.sumWorstCaseMsPerFrame}ms > 16.6ms)`,
  );
  process.exit(1);
}

console.log(
  `[chat-render-bench] OK — within 60fps: ${summary.budget.within60Fps} ` +
    `(headroom ${summary.budget.frameHeadroomMs}ms)`,
);
