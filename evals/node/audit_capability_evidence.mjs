import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const matrix = JSON.parse(readFileSync(join(root, "evals", "capability-matrix.json"), "utf8"));
const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR ?? "";
const externalConfigured = process.env.OPENBUDDY_E2E_EXTERNAL === "1"
  && process.env.OPENBUDDY_E2E_REQUIRED === "1"
  && Boolean(process.env.OPENBUDDY_E2E_API_KEY?.trim())
  && Boolean(process.env.OPENBUDDY_E2E_BASE_URL?.trim())
  && Boolean(process.env.OPENBUDDY_E2E_MODEL_ID?.trim());
const findings = [];
const forbiddenKeys = /^(?:apiKey|prompt|fullPayload|secret|token|authorization|headers)$/i;
const secretPattern = /(?:^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~-]{16,})/;
const allowedEvidenceSchemas = new Set([
  "openbuddy.redacted-evidence.v1",
  "openbuddy.email-ai-quality.v2",
]);

function walk(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => walk(join(path, entry.name)));
}

function inspectSecrets(value, path) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectSecrets(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) findings.push(`${path}.${key}: forbidden evidence field`);
    inspectSecrets(child, `${path}.${key}`);
  }
}

function artifactClaims(artifact) {
  return new Set([
    ...(Array.isArray(artifact.capabilities) ? artifact.capabilities : []),
    ...(Array.isArray(artifact.claims) ? artifact.claims : []),
    ...(typeof artifact.capability === "string" ? [artifact.capability] : []),
  ]);
}

function artifactPath(relativePath) {
  return evidenceRoot ? join(evidenceRoot, relativePath) : "";
}

function readArtifact(relativePath) {
  const path = artifactPath(relativePath);
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function artifactPasses(artifact, capabilityId, expectedLevel) {
  if (!artifact || artifact.schema !== "openbuddy.redacted-evidence.v1") return false;
  const level = artifact.evidenceLevel;
  if (level !== expectedLevel) return false;
  if (level === "real-external" && !externalConfigured) return false;
  if (artifact.ok === false || artifact.failed > 0) return false;
  if (typeof artifact.passed === "number" && artifact.passed < 1) return false;
  const claims = artifactClaims(artifact);
  if (!claims.has(capabilityId)) return false;
  const booleans = artifact.evidence?.capabilities;
  if (booleans && typeof booleans === "object" && !Array.isArray(booleans)
    && booleans[capabilityId] !== undefined && booleans[capabilityId] !== true) return false;
  if (artifact.filesystem && artifact.filesystem !== "not-run-by-policy") return false;
  return true;
}

const capabilities = (matrix.capabilities ?? []).map((capability) => {
  if (capability.status === "disabled-by-policy") return { id: capability.id, status: "disabled-by-policy", artifacts: [] };
  const localArtifacts = Array.isArray(capability.localArtifacts) ? capability.localArtifacts : [];
  const externalArtifacts = Array.isArray(capability.realArtifacts) ? capability.realArtifacts : [];
  const localClaims = Array.isArray(capability.localClaims) ? capability.localClaims : [];
  const claims = Array.isArray(capability.realClaims) ? capability.realClaims : [];
  const inspectArtifacts = (artifacts, expectedLevel, declaredClaims) => artifacts.map((relativePath) => {
    const artifact = readArtifact(relativePath);
    const ok = (declaredClaims.length === 0 || declaredClaims.includes(capability.id))
      && artifactPasses(artifact, capability.id, expectedLevel);
    if (!ok) findings.push(`${capability.id}: ${expectedLevel} artifact ${relativePath} does not prove the declared claim`);
    return { path: relativePath, ok, evidenceLevel: artifact?.evidenceLevel ?? null };
  });
  const localResults = inspectArtifacts(localArtifacts, "real-local", localClaims);
  const externalResults = externalConfigured
    ? inspectArtifacts(externalArtifacts, "real-external", claims)
    : [];
  const localVerified = localResults.length > 0 && localResults.every((entry) => entry.ok);
  const externalVerified = externalConfigured && externalResults.length > 0 && externalResults.every((entry) => entry.ok);
  const verified = externalConfigured ? externalVerified : localVerified;
  return {
    id: capability.id,
    status: verified ? "verified" : "unverified",
    localStatus: localVerified ? "verified" : "unverified",
    externalStatus: externalConfigured ? (externalVerified ? "verified" : "unverified") : "not-configured",
    artifacts: { local: localResults, external: externalResults },
  };
});

for (const path of walk(evidenceRoot).filter((candidate) => candidate.endsWith(".json"))) {
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { findings.push(`${path}: invalid JSON`); continue; }
  inspectSecrets(value, path);
  if (!allowedEvidenceSchemas.has(value.schema)) findings.push(`${path}: unsupported evidence schema`);
  if (value.filesystem && value.filesystem !== "not-run-by-policy") findings.push(`${path}: filesystem smoke was not disabled`);
}

const report = {
  framework: "openbuddy-capability-evidence-audit",
  schema: "openbuddy.capability-evidence-audit.v1",
  evidenceRoot: evidenceRoot || null,
  externalConfigured,
  filesystem: "not-run-by-policy",
  total: capabilities.length,
  verified: capabilities.filter((entry) => entry.status === "verified").length,
  unverified: capabilities.filter((entry) => entry.status === "unverified").length,
  disabledByPolicy: capabilities.filter((entry) => entry.status === "disabled-by-policy").length,
  localVerified: capabilities.filter((entry) => entry.localStatus === "verified").length,
  externalVerified: capabilities.filter((entry) => entry.externalStatus === "verified").length,
  capabilities,
  findings,
  ok: findings.length === 0,
};
console.log(JSON.stringify(report, null, 2));
process.exit(findings.length === 0 ? 0 : 1);
