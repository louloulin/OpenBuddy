import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const matrixPath = join(root, "evals", "capability-matrix.json");
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const scenarioPath = join(root, "evals", "agent-scenario-manifest.json");
const scenarioManifest = JSON.parse(readFileSync(scenarioPath, "utf8"));
const errors = [];
const ids = new Set();
if (matrix.schema !== "openbuddy.capability-matrix.v1") errors.push("unexpected capability matrix schema");
if (matrix.runtime !== "electron+pi") errors.push("capability matrix is not scoped to electron+pi");
if (matrix.policy?.fixtureIsExternalEvidence !== false) errors.push("fixture results must not count as external evidence");
if (matrix.policy?.filesystemSmoke !== "disabled-by-policy") errors.push("filesystem smoke policy must remain disabled");
const scenarioCapabilities = new Set((scenarioManifest.scenarios ?? []).map((scenario) => scenario.capability));
const scenarioRoles = new Map();
for (const scenario of scenarioManifest.scenarios ?? []) {
  const entries = scenarioRoles.get(scenario.capability) ?? [];
  entries.push(scenario.coverageRole ?? "primary");
  scenarioRoles.set(scenario.capability, entries);
}

for (const capability of matrix.capabilities ?? []) {
  if (!capability?.id || ids.has(capability.id)) errors.push(`missing or duplicate capability id: ${capability?.id ?? "<missing>"}`);
  ids.add(capability.id);
  if (!capability.surface) errors.push(`${capability.id}: missing surface description`);
  if (!scenarioCapabilities.has(capability.id)) errors.push(`${capability.id}: missing agent scenario coverage`);
  if ((scenarioRoles.get(capability.id) ?? []).filter((role) => role === "primary").length !== 1) errors.push(`${capability.id}: must have exactly one primary scenario`);
  for (const field of ["localEvidence", "realEvidence"]) {
    if (!Array.isArray(capability[field])) errors.push(`${capability.id}: ${field} must be an array`);
    for (const path of capability[field] ?? []) if (!existsSync(join(root, path))) errors.push(`${capability.id}: missing evidence entrypoint ${path}`);
  }
  if ((capability.realEvidence?.length ?? 0) > 0 && !Array.isArray(capability.realArtifacts)) {
    errors.push(`${capability.id}: realEvidence requires realArtifacts declaration`);
  }
  for (const artifact of capability.realArtifacts ?? []) {
    if (typeof artifact !== "string" || artifact.length === 0 || artifact.startsWith("/")) {
      errors.push(`${capability.id}: invalid relative real artifact path`);
    }
  }
  if (capability.status === "disabled-by-policy" && capability.id !== "filesystem") errors.push(`${capability.id}: unexpected disabled-by-policy status`);
}
for (const scenario of scenarioManifest.scenarios ?? []) {
  if (!ids.has(scenario.capability)) errors.push(`${scenario.id}: references unknown capability ${scenario.capability}`);
}

const externalConfigured = process.env.OPENBUDDY_E2E_REQUIRED === "1"
  && Boolean(process.env.OPENBUDDY_E2E_API_KEY?.trim())
  && Boolean(process.env.OPENBUDDY_E2E_BASE_URL?.trim())
  && Boolean(process.env.OPENBUDDY_E2E_MODEL_ID?.trim());
const harnessConfigured = Boolean(process.env.OPENBUDDY_HARNESS_URL?.trim())
  && Boolean(process.env.OPENBUDDY_HARNESS_TOKEN?.trim());
const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR ?? "";
const artifactCache = new Map();
function readArtifact(relativePath) {
  if (artifactCache.has(relativePath)) return artifactCache.get(relativePath);
  if (!evidenceRoot) {
    artifactCache.set(relativePath, null);
    return null;
  }
  const path = join(evidenceRoot, relativePath);
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    artifactCache.set(relativePath, value);
    return value;
  } catch {
    artifactCache.set(relativePath, null);
    return null;
  }
}
function realArtifactReady(capability) {
  const artifacts = Array.isArray(capability.realArtifacts) ? capability.realArtifacts : [];
  const claims = Array.isArray(capability.realClaims) ? capability.realClaims : [];
  if (artifacts.length === 0) return false;
  if (claims.length === 0) return false;
  return artifacts.every((relativePath) => {
    const artifact = readArtifact(relativePath);
    if (!artifact || artifact.schema !== "openbuddy.redacted-evidence.v1") return false;
    const evidenceLevel = artifact.evidenceLevel
      ?? (artifact.realE2E === true ? (process.env.OPENBUDDY_E2E_EXTERNAL === "1" ? "real-external" : "real-local") : "fixture-only");
    if (evidenceLevel === "real-external" && !externalConfigured) return false;
    if (!(["real-local", "real-external"].includes(evidenceLevel))) return false;
    if (artifact.ok === false || artifact.failed > 0) return false;
    if (typeof artifact.passed === "number" && artifact.passed < 1) return false;
    if (!Array.isArray(artifact.capabilities) && !Array.isArray(artifact.claims) && !(typeof artifact.capability === "string")) return false;
    const declaredClaims = new Set([...(artifact.capabilities ?? []), ...(artifact.claims ?? []), ...(artifact.capability ? [artifact.capability] : [])]);
    if (!claims.every((claim) => declaredClaims.has(claim))) return false;
    return true;
  });
}
const report = {
  framework: "openbuddy-capability-matrix-audit",
  schema: matrix.schema,
  runtime: matrix.runtime,
  total: matrix.capabilities?.length ?? 0,
  localEvidence: (matrix.capabilities ?? []).filter((capability) => capability.localEvidence?.length).length,
  realEvidenceDeclared: (matrix.capabilities ?? []).filter((capability) => capability.realEvidence?.length).length,
  externalProviderConfigured: externalConfigured,
  harnessConfigured,
  evidenceRoot: evidenceRoot || null,
  filesystem: "not-run-by-policy",
  capabilities: (matrix.capabilities ?? []).map((capability) => ({
    id: capability.id,
    local: capability.localEvidence?.length > 0,
    real: realArtifactReady(capability),
    realArtifacts: capability.realArtifacts ?? [],
    status: capability.status ?? (realArtifactReady(capability)
      ? "real-artifact-backed"
      : (capability.realEvidence?.length && (externalConfigured || capability.realEvidence.length > 0) ? "ready-for-real-run" : "local-only")),
  })),
  errors,
};
console.log(JSON.stringify({ ...report, ok: errors.length === 0 }, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
