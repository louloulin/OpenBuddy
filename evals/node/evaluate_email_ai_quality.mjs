import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const datasetPath = process.env.OPENBUDDY_EMAIL_AI_QUALITY_DATASET ?? new URL("../datasets/email_ai_quality_cases.json", import.meta.url);
const parseJson = (value, label) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(`invalid ${label}: ${error instanceof Error ? error.message : "invalid JSON"}`);
    process.exit(2);
  }
};
const cases = parseJson(readFileSync(datasetPath, "utf8"), "email AI quality dataset");
if (!Array.isArray(cases) || cases.length === 0) {
  console.error("email AI quality dataset must be a non-empty array");
  process.exit(2);
}
const caseIds = new Set();
for (const testCase of cases) {
  if (!testCase || typeof testCase !== "object" || typeof testCase.id !== "string" || !testCase.id.trim()) {
    console.error("email AI quality dataset contains a case without a valid id");
    process.exit(2);
  }
  if (caseIds.has(testCase.id)) {
    console.error(`email AI quality dataset contains duplicate case id: ${testCase.id}`);
    process.exit(2);
  }
  caseIds.add(testCase.id);
  if (!Array.isArray(testCase.expectedActions)) {
    console.error(`email AI quality dataset case ${testCase.id} must define expectedActions`);
    process.exit(2);
  }
  for (let index = 0; index < testCase.expectedActions.length; index += 1) {
    const action = testCase.expectedActions[index];
    if (typeof action?.content !== "string" || !action.content.trim()) {
      console.error(`email AI quality dataset case ${testCase.id} has an invalid expected action at index ${index}`);
      process.exit(2);
    }
  }
}
const predictionsPath = process.env.OPENBUDDY_EMAIL_AI_QUALITY_PREDICTIONS;
if (!predictionsPath) {
  console.error("email AI quality evaluation requires OPENBUDDY_EMAIL_AI_QUALITY_PREDICTIONS");
  process.exit(2);
}
const predictions = parseJson(readFileSync(predictionsPath, "utf8"), "email AI quality predictions");
if (!Array.isArray(predictions)) {
  console.error("email AI quality predictions must be an array");
  process.exit(2);
}
const predictionById = new Map();
const invalidPredictionErrors = [];
for (const prediction of predictions) {
  if (!prediction || typeof prediction !== "object" || typeof prediction.id !== "string" || !prediction.id.trim()) {
    invalidPredictionErrors.push("prediction without a valid id");
    continue;
  }
  if (predictionById.has(prediction.id)) {
    invalidPredictionErrors.push(`duplicate prediction id: ${prediction.id}`);
    continue;
  }
  if (!Array.isArray(prediction.actions)) {
    invalidPredictionErrors.push(`prediction ${prediction.id} must define actions`);
    continue;
  }
  predictionById.set(prediction.id, prediction);
}
const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const dateKey = (value) => value ? String(value).slice(0, 10) : "";
const actionKey = (action) => `${normalize(action?.content)}|${normalize(action?.owner)}|${dateKey(action?.dueAt)}|${normalize(action?.messageId)}`;
const actionContentKey = (action) => `${normalize(action?.content)}|${normalize(action?.owner)}`;
const validateAction = (action, label) => {
  if (!action || typeof action !== "object" || Array.isArray(action)) return `${label} is not an object`;
  if (typeof action.content !== "string" || !action.content.trim()) return `${label}.content is required`;
  if (action.owner !== undefined && action.owner !== null && typeof action.owner !== "string") return `${label}.owner must be a string`;
  if (action.dueAt !== undefined && action.dueAt !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(String(action.dueAt)) || !Number.isFinite(Date.parse(`${action.dueAt}T00:00:00Z`)))) return `${label}.dueAt must be an ISO date`;
  if (action.messageId !== undefined && action.messageId !== null && (typeof action.messageId !== "string" || !action.messageId.trim())) return `${label}.messageId must be a non-empty string`;
  return null;
};
const results = [];
let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;
let dueDateMatches = 0;
let dueDateTotal = 0;
let citationCovered = 0;
let citationAccurate = 0;
let actionTotal = 0;
let noActionCorrect = 0;
let noActionTotal = 0;
let caseExactMatches = 0;
let duplicateActionCount = 0;
for (const testCase of cases) {
  const expected = testCase.expectedActions ?? [];
  const actual = predictionById.get(testCase.id)?.actions ?? [];
  for (let index = 0; index < actual.length; index += 1) {
    const error = validateAction(actual[index], `prediction ${testCase.id}.actions[${index}]`);
    if (error) invalidPredictionErrors.push(error);
  }
  const expectedKeys = new Set(expected.map(actionKey));
  const actualKeys = new Set(actual.map(actionKey));
  duplicateActionCount += actual.length - actualKeys.size;
  const matched = [...actualKeys].filter((key) => expectedKeys.has(key));
  const caseTp = matched.length;
  const caseFp = actualKeys.size - caseTp;
  const caseFn = expectedKeys.size - caseTp;
  truePositive += caseTp;
  falsePositive += caseFp;
  falseNegative += caseFn;
  const expectedWithDue = expected.filter((item) => item.dueAt);
  dueDateTotal += expectedWithDue.length;
  dueDateMatches += expectedWithDue.filter((item) => actual.some((candidate) => actionContentKey(candidate) === actionContentKey(item) && dateKey(candidate.dueAt) === dateKey(item.dueAt))).length;
  actionTotal += actual.length;
  citationCovered += actual.filter((item) => typeof item.messageId === "string" && item.messageId.trim()).length;
  const expectedMessageIds = new Set(expected.map((item) => normalize(item.messageId)).filter(Boolean));
  citationAccurate += actual.filter((item) => typeof item.messageId === "string" && expectedMessageIds.has(normalize(item.messageId))).length;
  if (expected.length === 0) {
    noActionTotal += 1;
    if (actual.length === 0) noActionCorrect += 1;
  }
  if (caseTp === expectedKeys.size && caseFp === 0 && caseFn === 0) caseExactMatches += 1;
  results.push({ id: testCase.id, truePositive: caseTp, falsePositive: caseFp, falseNegative: caseFn, expected: expected.length, actual: actual.length, exactMatch: caseTp === expectedKeys.size && caseFp === 0 && caseFn === 0 });
}
const precision = truePositive / Math.max(truePositive + falsePositive, 1);
const recall = truePositive / Math.max(truePositive + falseNegative, 1);
const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
const ratio = (numerator, denominator) => denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
const missingPredictionCases = cases.filter((testCase) => !predictionById.has(testCase.id)).map((testCase) => testCase.id);
const unexpectedPredictionCases = [...predictionById.keys()].filter((id) => !caseIds.has(id));
const thresholds = {
  actionPrecision: Number(process.env.OPENBUDDY_EMAIL_AI_QUALITY_MIN_PRECISION ?? "0.8"),
  actionRecall: Number(process.env.OPENBUDDY_EMAIL_AI_QUALITY_MIN_RECALL ?? "0.8"),
  dueDateAccuracy: Number(process.env.OPENBUDDY_EMAIL_AI_QUALITY_MIN_DUE_DATE_ACCURACY ?? "0.8"),
  citationCoverage: Number(process.env.OPENBUDDY_EMAIL_AI_QUALITY_MIN_CITATION_COVERAGE ?? "1"),
  noActionAccuracy: Number(process.env.OPENBUDDY_EMAIL_AI_QUALITY_MIN_NO_ACTION_ACCURACY ?? "1"),
};
for (const [name, value] of Object.entries(thresholds)) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    console.error(`invalid quality threshold ${name}: expected a number between 0 and 1`);
    process.exit(2);
  }
}
const metrics = {
  actionPrecision: Number(precision.toFixed(4)),
  actionRecall: Number(recall.toFixed(4)),
  actionF1: Number(f1.toFixed(4)),
  dueDateAccuracy: ratio(dueDateMatches, dueDateTotal),
  citationCoverage: ratio(citationCovered, actionTotal),
  citationAccuracy: ratio(citationAccurate, actionTotal),
  noActionAccuracy: ratio(noActionCorrect, noActionTotal),
  caseExactMatch: Number((caseExactMatches / Math.max(cases.length, 1)).toFixed(4)),
};
const gateFailures = [
  ...(invalidPredictionErrors.length ? ["invalid-predictions"] : []),
  ...(missingPredictionCases.length ? ["missing-predictions"] : []),
  ...(unexpectedPredictionCases.length ? ["unexpected-predictions"] : []),
  ...(metrics.actionPrecision < thresholds.actionPrecision ? ["action-precision"] : []),
  ...(metrics.actionRecall < thresholds.actionRecall ? ["action-recall"] : []),
  ...(metrics.dueDateAccuracy < thresholds.dueDateAccuracy ? ["due-date-accuracy"] : []),
  ...(metrics.citationCoverage < thresholds.citationCoverage ? ["citation-coverage"] : []),
  ...(metrics.noActionAccuracy < thresholds.noActionAccuracy ? ["no-action-accuracy"] : []),
];
const report = {
  framework: "openbuddy-email-ai-quality-evaluation",
  schema: "openbuddy.email-ai-quality.v2",
  evidenceLevel: "fixture-quality",
  realE2E: false,
  dataset: { id: createHash("sha256").update(JSON.stringify(cases)).digest("hex").slice(0, 16), cases: cases.length },
  predictionSource: { modelId: process.env.OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID ?? "unspecified", runId: process.env.OPENBUDDY_EMAIL_AI_QUALITY_RUN_ID ?? "unspecified" },
  cases: results,
  metrics,
  qualityGate: {
    requested: process.env.OPENBUDDY_EMAIL_AI_QUALITY_REQUIRE_PASS === "1",
    passed: gateFailures.length === 0,
    thresholds,
    failures: gateFailures,
    invalidPredictionCount: invalidPredictionErrors.length,
    duplicateActionCount,
    missingPredictionCases,
    unexpectedPredictionCases,
  },
  note: "Fixture quality evidence only. It does not represent model quality until predictions are produced by a real configured model and reviewed against an expanded, blinded dataset.",
};
const output = process.env.OPENBUDDY_EVIDENCE_DIR ? join(process.env.OPENBUDDY_EVIDENCE_DIR, "email-ai-quality/email-ai-quality.json") : null;
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ ...report, evidenceArtifact: output }, null, 2));
if (report.qualityGate.requested && !report.qualityGate.passed) process.exit(1);
