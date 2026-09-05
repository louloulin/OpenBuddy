import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const manifest = JSON.parse(readFileSync(join(root, "evals", "benchmark-manifest.json"), "utf8"));
const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR ?? "";
const artifactByBenchmark = {
  "swe-bench-verified": "repo-fix/repo-fix.json",
  "terminal-bench": "repo-fix/repo-fix.json",
  "tau-bench": "core-regression/core-regression.json",
  toolsandbox: "strict-agent-benchmark/strict-real-agent-benchmark.json",
  bfcl: "strict-agent-benchmark/strict-real-agent-benchmark.json",
  "openbuddy-strict-agent": "strict-agent-benchmark/strict-real-agent-benchmark.json",
};

function readArtifact(relativePath) {
  if (!evidenceRoot || !relativePath) return null;
  const path = join(evidenceRoot, relativePath);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function artifactPassed(artifact) {
  if (!artifact || artifact.schema !== "openbuddy.redacted-evidence.v1") return false;
  if (artifact.ok === false || artifact.failed > 0) return false;
  return artifact.ok === true
    || artifact.testsPassed === true
    || (typeof artifact.passed === "number" && artifact.passed > 0);
}

const results = (manifest.benchmarks ?? []).map((benchmark) => {
  const artifactPath = artifactByBenchmark[benchmark.id] ?? null;
  const artifact = readArtifact(artifactPath);
  const classification = ["passed", "executed"].includes(benchmark.status)
    ? "official-claimed"
    : benchmark.status === "adapter-only"
      ? (artifactPassed(artifact) ? "adapter-backed" : "adapter-only")
      : benchmark.id === "openbuddy-strict-agent" && artifactPassed(artifact)
        ? "project-suite-backed"
        : "official-not-run";
  return {
    id: benchmark.id,
    name: benchmark.name,
    manifestStatus: benchmark.status,
    classification,
    officialPass: classification === "official-claimed",
    officialDataset: false,
    officialRunner: false,
    officialOracle: false,
    adapter: benchmark.adapter ?? null,
    artifact: artifactPath && artifact ? {
      path: artifactPath,
      schema: artifact.schema,
      ok: artifactPassed(artifact),
      passed: artifact.passed ?? null,
      failed: artifact.failed ?? null,
      framework: artifact.framework ?? null,
    } : null,
    oracle: benchmark.oracle,
    limitation: benchmark.limitation,
  };
});

const findings = results
  .filter((result) => result.officialPass && !(result.officialDataset && result.officialRunner && result.officialOracle))
  .map((result) => `${result.id}: official pass requires dataset, runner, and oracle evidence`);
const report = {
  framework: "openbuddy-benchmark-evidence-matrix",
  schema: "openbuddy.benchmark-evidence.v1",
  evidenceRoot: evidenceRoot || null,
  policy: manifest.policy,
  officialPassesClaimed: results.filter((result) => result.officialPass).map((result) => result.id),
  adapterEvidenceBacked: results.filter((result) => result.classification === "adapter-backed").map((result) => result.id),
  projectSuiteEvidenceBacked: results.filter((result) => result.classification === "project-suite-backed").map((result) => result.id),
  officialNotRun: results.filter((result) => result.classification === "official-not-run").map((result) => result.id),
  results,
  findings,
  ok: findings.length === 0,
};
console.log(JSON.stringify(report, null, 2));
process.exit(findings.length === 0 ? 0 : 1);
