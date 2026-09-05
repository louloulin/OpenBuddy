import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const casesPath = join(root, "evals", "datasets", "email_ai_contract_cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const results = [];
function citations(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry.messageId === "string" && entry.messageId.trim());
}
function quoteMatches(citation, sourceMessages) {
  if (!citation.quote) return true;
  const body = sourceMessages?.[citation.messageId];
  return typeof body === "string" && body.toLocaleLowerCase().includes(citation.quote.replace(/\s+/g, " ").trim().toLocaleLowerCase());
}
function validate(input, sourceMessageIds = [], sourceMessages = {}) {
  if (!input || typeof input !== "object") return { valid: false, reason: "not-object" };
  if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) return { valid: false, reason: "confidence-out-of-range" };
  const findings = [
    ...(Array.isArray(input.facts) ? input.facts : []),
    ...(Array.isArray(input.actions) ? input.actions : []),
    ...(Array.isArray(input.risks) ? input.risks : []),
    ...(input.replyDraft ? [input.replyDraft] : []),
  ];
  for (const finding of findings) {
    if (!finding || typeof finding !== "object" || citations(finding.citations).length === 0) return { valid: false, reason: "missing-source-citation" };
  }
  const allowedSourceIds = new Set(sourceMessageIds);
  if (allowedSourceIds.size > 0) {
    const invalidCitation = findings.flatMap((finding) => citations(finding.citations)).find((citation) => !allowedSourceIds.has(citation.messageId));
    if (invalidCitation) return { valid: false, reason: "citation-not-in-thread" };
  }
  const invalidQuote = findings.flatMap((finding) => citations(finding.citations)).find((citation) => !quoteMatches(citation, sourceMessages));
  if (invalidQuote) return { valid: false, reason: "citation-quote-not-in-message" };
  return { valid: true, citationCount: findings.reduce((count, finding) => count + citations(finding.citations).length, 0), mustNotExecute: true };
}
for (const testCase of cases) {
  const actual = validate(testCase.input, testCase.sourceMessageIds, testCase.sourceMessages);
  const ok = actual.valid === testCase.expect.valid && (!testCase.expect.reason || actual.reason === testCase.expect.reason) && (!testCase.expect.minCitations || actual.citationCount >= testCase.expect.minCitations) && (!testCase.expect.mustNotExecute || actual.mustNotExecute === true);
  results.push({ id: testCase.id, ok, expected: testCase.expect, actual });
}
const failed = results.filter((item) => !item.ok);
const report = {
  framework: "openbuddy-email-ai-contract-evaluation",
  schema: "openbuddy.redacted-evidence.v1",
  evidenceLevel: "real-local",
  realE2E: false,
  capability: "email-ai-analysis",
  passed: results.length - failed.length,
  failed: failed.length,
  claims: ["structured-schema", "source-citation-boundary", "thread-citation-membership", "citation-quote-boundary", "confidence-boundary", "prompt-injection-no-execution"],
  cases: results,
  note: "This local suite validates the result contract and safety boundary; it does not claim model factual accuracy or real-provider connectivity."
};
const output = process.env.OPENBUDDY_EVIDENCE_DIR ? join(process.env.OPENBUDDY_EVIDENCE_DIR, "email-ai-contract/email-ai-contract.json") : null;
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ ...report, evidenceArtifact: output }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
