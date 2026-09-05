// Real-no-mock orchestrator for top-tier AI Agent benchmark adapters.
//
// Runs every local adapter (GAIA, AgentBench/ToolBench, AgentDojo, MT-bench, BFCL, NL2Bash, SWE-bench-style) and
// produces a single redacted evidence artifact. Each adapter must:
//   - validate its dataset structurally,
//   - produce real JSON evidence on disk,
//   - fail closed when OPENBUDDY_E2E_REQUIRED=1 without credentials.
//
// Each adapter writes its full structured JSON to disk; we read those
// artifacts to compute accurate aggregate counts (stdout may not include
// structural findings when the adapter short-circuits on validation failure).
//
// Usage:
//   node evals/node/run_top_tier_local.mjs
//   OPENBUDDY_E2E_REQUIRED=1 node evals/node/run_top_tier_local.mjs
import { mkdirSync, readFileSync, writeFileSync, existsSync as existsSyncSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR
  ?? join(root, "evidence", "top-tier-local");
mkdirSync(evidenceDir, { recursive: true });

const externalRequired = process.env.OPENBUDDY_E2E_REQUIRED === "1";

const adapters = [
  { id: "gaia-style", script: "evals/node/run_gaia_local.mjs", artifact: "gaia-local-run.json" },
  { id: "agentbench-toolbench", script: "evals/node/run_agentbench_tools.mjs", artifact: "agentbench-tools-local.json" },
  { id: "agentdojo-safety", script: "evals/node/run_agentdojo_safety.mjs", artifact: "agentdojo-safety-local.json" },
  { id: "mt-bench-style", script: "evals/node/run_mt_bench_style.mjs", artifact: "mt-bench-style.json" },
  { id: "bfcl-style", script: "evals/node/run_bfcl_style.mjs", artifact: "bfcl-style.json" },
  { id: "nl2bash-style", script: "evals/node/run_nl2bash_style.mjs", artifact: "nl2bash-style.json" },
  { id: "swe-bench-style", script: "evals/node/run_swe_bench_style.mjs", artifact: "swe-bench-style.json" },
];

const startedAt = new Date().toISOString();
const results = [];
let totalFindings = 0;
let totalPassed = 0;

for (const adapter of adapters) {
  const subDir = join(evidenceDir, adapter.id);
  mkdirSync(subDir, { recursive: true });
  const result = spawnSync("node", [join(root, adapter.script)], {
    cwd: root,
    env: { ...process.env, OPENBUDDY_EVIDENCE_DIR: subDir },
    encoding: "utf8",
  });
  const passed = result.status === 0;
  const stdout = result.stdout ?? "";
  // Each adapter always writes a redacted JSON artifact to disk; read it for
  // accurate findings even when stdout is empty (failure path).
  const artifactPath = join(subDir, adapter.artifact);
  let parsed = null;
  if (existsSyncSync(artifactPath)) {
    try { parsed = JSON.parse(readFileSync(artifactPath, "utf8")); } catch { /* ignore */ }
  } else {
    try { parsed = JSON.parse(stdout); } catch { /* ignore */ }
  }
  const findings = parsed?.structuralFindings?.length ?? 0;
  totalFindings += findings;
  if (passed) totalPassed += 1;
  results.push({
    id: adapter.id,
    script: adapter.script,
    status: passed ? "pass" : (externalRequired && result.status === 2 ? "external-blocked" : "fail"),
    exitCode: result.status,
    datasetRows: parsed?.datasetRows ?? null,
    structuralFindings: findings,
    artifactPath: parsed?.artifactPath ?? null,
    mode: parsed?.mode ?? null,
    stderr: (result.stderr ?? "").slice(-300),
  });
}

const summary = {
  schema: "openbuddy.top-tier-local-orchestrator.v1",
  startedAt,
  finishedAt: new Date().toISOString(),
  externalRequired,
  adapters: results,
  totals: {
    total: adapters.length,
    passed: totalPassed,
    structuralFindings: totalFindings,
  },
  pass: !externalRequired && totalFindings === 0 && totalPassed === adapters.length,
};

const artifactPath = join(evidenceDir, "top-tier-local-orchestrator.json");
writeFileSync(artifactPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, artifactPath }, null, 2));

if (!summary.pass) {
  console.error(`top-tier-local: ${totalFindings} structural findings across ${adapters.length} adapters.`);
  process.exit(1);
}
