import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.env.OPENBUDDY_EVIDENCE_DIR ?? "";
const errors = [];
const forbiddenKeys = /^(?:apiKey|prompt|fullPayload|secret|token|authorization|headers)$/i;
const secretPattern = /(?:^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~-]{16,})/;
const allowedSchemas = new Set([
  "openbuddy.redacted-evidence.v1",
  "openbuddy.email-ai-quality.v2",
]);

function walk(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => walk(join(path, entry.name)));
}

function inspect(value, path) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspect(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) errors.push(`${path}.${key}: forbidden evidence field`);
    inspect(child, `${path}.${key}`);
  }
}

const files = walk(root).filter((path) => path.endsWith(".json"));
const externalRequired = process.env.OPENBUDDY_E2E_REQUIRED === "1";
if (externalRequired && !root) errors.push("OPENBUDDY_EVIDENCE_DIR is required for real-provider evidence");
if (externalRequired && files.length === 0) errors.push("real-provider run produced no evidence artifact");
if (externalRequired) {
  for (const name of [
    "electron-real-ui-smoke/real-ui-smoke.json",
    "expert-graph/expert-graph.json",
    "strict-agent-benchmark/strict-real-agent-benchmark.json",
    "real-agent-capability-audit/real-agent-capability-audit.json",
    "core-regression/core-regression.json",
    "repo-fix/repo-fix.json",
    "email-mcp/email-mcp.json",
    "capability-surface/capability-surface.json",
  ]) {
    if (!existsSync(join(root, name))) errors.push(`missing required real-provider artifact: ${name}`);
  }
}
for (const path of files) {
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { errors.push(`${path}: invalid JSON`); continue; }
  if (!allowedSchemas.has(value.schema)) errors.push(`${path}: unsupported evidence schema`);
  inspect(value, path);
  const serialized = JSON.stringify(value);
  if (secretPattern.test(serialized)) {
    errors.push(`${path}: secret-like material found`);
  }
}

console.log(JSON.stringify({
  framework: "openbuddy-evidence-artifact-audit",
  schema: "openbuddy.redacted-evidence.v1",
  evidenceRoot: root || null,
  files: files.map((path) => path.replace(`${root}/`, "")),
  errors,
  ok: errors.length === 0,
}, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
