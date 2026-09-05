import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const manifestPath = join(root, "evals", "benchmark-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const scenarioManifestPath = join(root, "evals", "agent-scenario-manifest.json");
const scenarioManifest = JSON.parse(readFileSync(scenarioManifestPath, "utf8"));
const findings = [];
const addFinding = (code, message, details = {}) => findings.push({ code, message, ...details });
const requiredFiles = [
  "evals/node/run_full_acceptance.mjs",
  "evals/node/run_agent_benchmark.mjs",
  "evals/node/run_real_agent_capabilities.mjs",
  "evals/node/run_regression.mjs",
  "evals/node/run_repo_fix.mjs",
  "scripts/electron/real-ui-smoke.mjs",
  "evals/inspect_ai/openbuddy_task.py",
  "evals/deepeval/test_openbuddy_chat.py",
  "evals/promptfoo/promptfooconfig.yaml",
  "evals/langfuse/trace_realtime.py",
  "evals/datasets/agent_benchmark.jsonl",
  "evals/datasets/core_tasks.jsonl",
  "evals/capability-matrix.json",
  "docs/ai-agent-test-plan.md",
  "evals/node/audit_capability_matrix.mjs",
  "evals/node/audit_evidence_artifacts.mjs",
  "evals/node/run_real_capability_surface.mjs",
  "evals/node/audit_benchmark_evidence.mjs",
  "evals/agent-scenario-manifest.json",
];
for (const relativePath of requiredFiles) {
  if (!existsSync(join(root, relativePath))) addFinding("missing-file", `Required evaluation file is missing: ${relativePath}`, { path: relativePath });
}

if (manifest.schema !== "openbuddy.benchmark-manifest.v1") addFinding("schema", "Unexpected benchmark manifest schema");
if (manifest.policy?.fixtureIsExternalEvidence !== false) addFinding("policy", "Fixture results must never count as external evidence");
if (manifest.policy?.filesystemSmoke !== "disabled-by-policy") addFinding("policy", "Filesystem smoke policy is not disabled");
if (scenarioManifest.schema !== "openbuddy.agent-scenario-manifest.v1") addFinding("scenario-schema", "Unexpected agent scenario manifest schema");
if (scenarioManifest.policy?.fixtureIsExternalEvidence !== false) addFinding("scenario-policy", "Scenario fixtures must never count as external evidence");
if (scenarioManifest.policy?.filesystemSmoke !== "disabled-by-policy") addFinding("scenario-policy", "Scenario filesystem smoke policy is not disabled");
if (scenarioManifest.policy?.evidenceContract?.artifactSchema !== "openbuddy.redacted-evidence.v1") {
  addFinding("evidence-contract", "Scenario evidence contract must use the redacted artifact schema");
}

const scenarioIds = new Set();
for (const scenario of scenarioManifest.scenarios ?? []) {
  if (!scenario?.id || scenarioIds.has(scenario.id)) addFinding("scenario-id", `Missing or duplicated scenario id: ${scenario?.id ?? "<missing>"}`);
  scenarioIds.add(scenario.id);
  for (const field of ["capability", "layer", "evidenceLevel", "oracle", "artifactSchema"]) {
    if (!scenario[field]) addFinding("scenario-schema", `Scenario ${scenario.id ?? "<missing>"} is missing ${field}`);
  }
  if (!Array.isArray(scenario.entrypoints) || !Array.isArray(scenario.assertions) || scenario.assertions.length === 0
    || !Array.isArray(scenario.negativeAssertions) || scenario.negativeAssertions.length === 0) {
    addFinding("scenario-schema", `Scenario ${scenario.id ?? "<missing>"} must declare entrypoints, positive assertions, and negative assertions`);
  }
  if (scenario.artifactSchema !== scenarioManifest.policy?.evidenceContract?.artifactSchema) {
    addFinding("evidence-contract", `Scenario ${scenario.id} uses an unsupported artifact schema`);
  }
  for (const entrypoint of scenario.entrypoints ?? []) {
    if (!existsSync(join(root, entrypoint))) addFinding("scenario-entrypoint", `Scenario ${scenario.id} references missing entrypoint ${entrypoint}`);
  }
  if (scenario.evidenceLevel === "real-external" && scenario.externalProviderRequired !== true) {
    addFinding("scenario-policy", `External scenario ${scenario.id} must require provider credentials`);
  }
  if (scenario.evidenceLevel === "disabled-by-policy" && scenario.id !== "filesystem") {
    addFinding("scenario-policy", `Only filesystem may be disabled by policy: ${scenario.id}`);
  }
}

const capabilityCoverage = new Map();
for (const scenario of scenarioManifest.scenarios ?? []) {
  const role = scenario.coverageRole ?? "primary";
  const entries = capabilityCoverage.get(scenario.capability) ?? [];
  entries.push({ id: scenario.id, role });
  capabilityCoverage.set(scenario.capability, entries);
}
for (const [capability, entries] of capabilityCoverage) {
  const primary = entries.filter((entry) => entry.role === "primary");
  if (primary.length !== 1) addFinding("coverage-role", `${capability} must have exactly one primary scenario`, { scenarios: entries });
  for (const entry of entries) if (!["primary", "supplement"].includes(entry.role)) addFinding("coverage-role", `${entry.id} has invalid coverageRole ${entry.role}`);
}

const statuses = new Set(["not-run", "adapter-only", "ready-not-run", "executed", "passed"]);
const benchmarkIds = new Set();
for (const benchmark of manifest.benchmarks ?? []) {
  if (!benchmark.id || benchmarkIds.has(benchmark.id)) addFinding("benchmark-id", `Benchmark id is missing or duplicated: ${benchmark.id ?? "<missing>"}`);
  benchmarkIds.add(benchmark.id);
  if (!statuses.has(benchmark.status)) addFinding("benchmark-status", `Unknown benchmark status: ${benchmark.id}`, { status: benchmark.status });
  if (benchmark.id !== "openbuddy-strict-agent") {
    for (const field of ["kind", "officialUrl", "officialObject", "oracle", "limitation"]) {
      if (!benchmark[field]) addFinding("benchmark-schema", `Official benchmark entry is missing ${field}: ${benchmark.id}`);
    }
  }
  if (typeof benchmark.officialUrl === "string") {
    try {
      const url = new URL(benchmark.officialUrl);
      if (!/^https?:$/.test(url.protocol)) addFinding("benchmark-url", `Official URL is not HTTP(S): ${benchmark.id}`);
    } catch {
      addFinding("benchmark-url", `Invalid official URL: ${benchmark.id}`);
    }
  }
  if (benchmark.adapter && !existsSync(join(root, benchmark.adapter))) addFinding("benchmark-adapter", `Declared adapter is missing: ${benchmark.id}`, { adapter: benchmark.adapter });
  if ((benchmark.status === "executed" || benchmark.status === "passed") && !benchmark.evidence) {
    addFinding("unsubstantiated-status", `Benchmark status requires evidence and cannot be asserted from the manifest alone: ${benchmark.id}`);
  }
  if ((benchmark.status === "executed" || benchmark.status === "passed") && benchmark.evidence) {
    for (const field of ["officialDatasetInstalled", "officialRunnerOrEnvironmentExecuted", "officialOracleOrScorerExecuted", "redactedEvidenceArtifact"]) {
      if (benchmark.evidence[field] !== true) addFinding("incomplete-evidence", `Official benchmark evidence is incomplete: ${benchmark.id}.${field}`);
    }
  }
}

const source = (relativePath) => readFileSync(join(root, relativePath), "utf8");
const strictRunners = [
  "evals/node/run_agent_benchmark.mjs",
  "evals/node/run_real_agent_capabilities.mjs",
  "evals/node/run_regression.mjs",
  "evals/node/run_repo_fix.mjs",
  "evals/inspect_ai/openbuddy_task.py",
];
for (const relativePath of strictRunners) {
  if (!existsSync(join(root, relativePath))) continue;
  const text = source(relativePath);
  if (!/OPENBUDDY_E2E_REQUIRED/.test(text)) addFinding("missing-real-gate", `${relativePath} does not require OPENBUDDY_E2E_REQUIRED=1`);
  if (!/OPENBUDDY_E2E_API_KEY/.test(text) || !/OPENBUDDY_E2E_BASE_URL/.test(text) || !/OPENBUDDY_E2E_MODEL_ID/.test(text)) {
    addFinding("missing-provider-gate", `${relativePath} does not require all provider credentials`);
  }
  if (/fixture|mock/i.test(text) && !/never|fail-closed|refus|no fixture|no mock/i.test(text)) addFinding("possible-fixture-fallback", `${relativePath} mentions fixture/mock without an explicit fail-closed guard`);
}
const deepeval = source("evals/deepeval/test_openbuddy_chat.py");
if (/pytest\.skip\(/.test(deepeval)) addFinding("skip-fallback", "DeepEval-style real evaluation must not skip when the harness or credentials are missing");
if (!/pytest\.fail\(".*OPENBUDDY_HARNESS_URL/.test(deepeval) || !/pytest\.fail\(".*OPENBUDDY_E2E_REQUIRED/.test(deepeval)) {
  addFinding("missing-python-gate", "DeepEval-style evaluation must fail closed for missing harness or credentials");
}

const acceptance = source("evals/node/run_full_acceptance.mjs");
for (const requiredPattern of [
  /OPENBUDDY_FILESYSTEM_SMOKE.*0/,
  /realProviderConfigured/,
  /run_agent_benchmark\.mjs/,
  /run_real_agent_capabilities\.mjs/,
  /run_regression\.mjs/,
  /run_repo_fix\.mjs/,
  /real-ui-smoke\.mjs/,
  /externalBlocked/,
  /OPENBUDDY_EVIDENCE_DIR/,
  /capability-evidence-audit/,
  /benchmark-evidence-audit/,
  /no-file-parallelism/,
  /expert-graph-smoke\.mjs/,
]) {
  if (!requiredPattern.test(acceptance)) addFinding("acceptance-gap", `run_full_acceptance.mjs is missing required guard or phase: ${requiredPattern}`);
}
const strictBenchmarkSource = source("evals/node/run_agent_benchmark.mjs");
for (const requiredPattern of [
  /openbuddy\.redacted-evidence\.v1/,
  /OPENBUDDY_EVIDENCE_DIR/,
  /recallTurns/,
  /prior-context marker missing/,
]) {
  if (!requiredPattern.test(strictBenchmarkSource)) addFinding("evidence-gap", `run_agent_benchmark.mjs is missing evidence contract requirement: ${requiredPattern}`);
}
const capabilityRunnerSource = source("evals/node/run_real_agent_capabilities.mjs");
for (const requiredPattern of [/openbuddy\.redacted-evidence\.v1/, /OPENBUDDY_EVIDENCE_DIR/, /errorDigest/]) {
  if (!requiredPattern.test(capabilityRunnerSource)) addFinding("evidence-gap", `run_real_agent_capabilities.mjs is missing evidence contract requirement: ${requiredPattern}`);
}

const datasetReports = [];
for (const relativePath of ["evals/datasets/agent_benchmark.jsonl", "evals/datasets/core_tasks.jsonl"]) {
  const entries = readFileSync(join(root, relativePath), "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return { value: JSON.parse(line), line: index + 1 }; }
    catch (error) { addFinding("dataset-json", `Invalid JSON in ${relativePath}:${index + 1}`); return null; }
  }).filter(Boolean);
  const ids = new Set();
  for (const { value, line } of entries) {
    if (!value.id || ids.has(value.id)) addFinding("dataset-id", `Missing or duplicated dataset id in ${relativePath}:${line}`, { id: value.id });
    ids.add(value.id);
    if (relativePath.endsWith("agent_benchmark.jsonl") && value.context?.requiresPriorTurns
      && (!Array.isArray(value.context.recallTurns) || value.context.recallTurns.some((index) => !Number.isInteger(index) || index <= 0))) {
      addFinding("dataset-context", `${value.id ?? "unknown"}: context.recallTurns must identify follow-up turns`, { line });
    }
    if (relativePath.endsWith("agent_benchmark.jsonl") && value.context?.requiresPriorTurns) {
      for (const index of value.context.recallTurns ?? []) {
        const markers = value.context.recallMarkers?.[String(index)];
        if (!Array.isArray(markers) || markers.length === 0 || markers.some((marker) => !value.context.markers?.includes(marker))) {
          addFinding("dataset-context", `${value.id ?? "unknown"}: recallMarkers[${index}] must select remembered markers`, { line });
        }
      }
    }
    if (/sk-[A-Za-z0-9_-]{16,}/.test(JSON.stringify(value))) addFinding("dataset-secret", `Secret-like value in ${relativePath}:${line}`);
  }
  datasetReports.push({ path: relativePath, total: entries.length, ids: ids.size });
}

const configured = Boolean(process.env.OPENBUDDY_E2E_REQUIRED === "1"
  && process.env.OPENBUDDY_E2E_API_KEY
  && process.env.OPENBUDDY_E2E_BASE_URL
  && process.env.OPENBUDDY_E2E_MODEL_ID);
const harnessConfigured = Boolean(process.env.OPENBUDDY_HARNESS_URL && process.env.OPENBUDDY_HARNESS_TOKEN);
const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR ?? "";
const realArtifactBacked = configured && Boolean(evidenceRoot);
const report = {
  framework: "openbuddy-evaluation-suite-audit",
  schema: manifest.schema,
  officialBenchmarks: (manifest.benchmarks ?? []).length,
  datasetReports,
  scenarioReports: {
    total: scenarioManifest.scenarios?.length ?? 0,
    external: scenarioManifest.scenarios?.filter((scenario) => scenario.evidenceLevel === "real-external").length ?? 0,
    local: scenarioManifest.scenarios?.filter((scenario) => scenario.evidenceLevel === "real-local").length ?? 0,
    fixtureOnly: scenarioManifest.scenarios?.filter((scenario) => scenario.evidenceLevel === "fixture-only").length ?? 0,
    disabledByPolicy: scenarioManifest.scenarios?.filter((scenario) => scenario.evidenceLevel === "disabled-by-policy").length ?? 0,
    primaryCapabilities: [...capabilityCoverage].filter(([, entries]) => entries.filter((entry) => entry.role === "primary").length === 1).length,
  },
  realProviderConfigured: configured,
  harnessConfigured,
  evidenceRoot: evidenceRoot || null,
  externalRunStatus: realArtifactBacked ? "artifact-backed-run" : configured ? "ready-to-run" : "blocked-by-missing-temporary-credentials",
  filesystem: "not-run-by-policy",
  findings,
  ok: findings.length === 0,
};
console.log(JSON.stringify(report, null, 2));
process.exit(findings.length === 0 ? 0 : 1);
