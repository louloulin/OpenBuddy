/**
 * Tests for `scripts/perf/_cold-start-lib.mjs` (P3-02 cold-start analyzer).
 *
 * Uses `node:test` so the suite runs in CI with no extra dependencies —
 * the perf script directory has no `package.json` and is intentionally
 * dependency-free. The Node test runner is available in all CI images.
 *
 *   node --test scripts/perf/_cold-start-lib.test.mjs
 *
 * Pure-function tests — no Electron, no real files. The JSONL is fed in as
 * a string so the assertions cover the parsing math without needing a
 * perf-trace fixture under userData.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonl,
  pickFirst,
  diffMs,
  computeMetrics,
  evaluateBudgets,
  buildJsonArtifact,
} from "./_cold-start-lib.mjs";

/** Build a marks array with the canonical cold-start sequence. */
function standardMarks() {
  return [
    { ts: 1000, name: "app-whenReady", deltaMs: 0 },
    { ts: 1050, name: "agent-host-loaded", deltaMs: 50 },
    { ts: 1100, name: "harness-server-spawn", deltaMs: 50 },
    { ts: 1150, name: "connectors-register-start", deltaMs: 50 },
    { ts: 1200, name: "connectors-register-end", deltaMs: 50 },
    { ts: 2000, name: "first-paint", deltaMs: 800 },
    { ts: 2100, name: "window-ready", deltaMs: 100 },
    { ts: 2200, name: "window-resources-ready", deltaMs: 100 },
  ];
}

test("parseJsonl skips blank lines and parses each line as JSON", () => {
  const raw = standardMarks().map((m) => JSON.stringify(m)).join("\n") + "\n\n";
  const marks = parseJsonl(raw);
  assert.equal(marks.length, 8);
  assert.equal(marks[0].name, "app-whenReady");
});

test("parseJsonl throws SyntaxError on malformed input so the CLI exits 2", () => {
  assert.throws(() => parseJsonl("not-json\n"), SyntaxError);
});

test("pickFirst returns the first mark matching the name", () => {
  const hit = pickFirst(standardMarks(), "window-ready");
  assert.equal(hit?.ts, 2100);
});

test("pickFirst returns undefined when no mark matches", () => {
  assert.equal(pickFirst(standardMarks(), "no-such-mark"), undefined);
});

test("diffMs returns the positive delta between two named marks", () => {
  assert.equal(diffMs(standardMarks(), "app-whenReady", "harness-server-spawn"), 100);
});

test("diffMs clamps negative deltas to zero (clock skew safe)", () => {
  const marks = [
    { ts: 100, name: "earlier" },
    { ts: 50, name: "later" },
  ];
  assert.equal(diffMs(marks, "earlier", "later"), 0);
});

test("diffMs returns null when either side is missing", () => {
  assert.equal(diffMs(standardMarks(), "missing-a", "window-ready"), null);
  assert.equal(diffMs(standardMarks(), "app-whenReady", "missing-b"), null);
});

test("computeMetrics returns the canonical cold-start metrics from a complete trace", () => {
  const m = computeMetrics(standardMarks());
  assert.equal(m.readyMs, 1100); // 2100 - 1000
  assert.equal(m.paintMs, 1000); // 2000 - 1000
  assert.equal(m.harnessMs, 100); // 1100 - 1000
  assert.equal(m.agentHostMs, 50);
  assert.equal(m.connectorsMs, 50);
  assert.equal(m.counts.total, 8);
  assert.equal(m.counts.uniqueNames, 8);
});

test("computeMetrics falls back to the first mark when app-whenReady is missing", () => {
  const marks = [
    { ts: 500, name: "preload-loaded" },
    { ts: 1200, name: "first-paint" },
  ];
  const m = computeMetrics(marks);
  assert.equal(m.paintMs, 700);
  assert.equal(m.readyMs, null);
});

test("computeMetrics returns null metrics when the trace is empty", () => {
  const m = computeMetrics([]);
  assert.equal(m.readyMs, null);
  assert.equal(m.paintMs, null);
  assert.equal(m.counts.total, 0);
});

test("evaluateBudgets passes when both budgets are met", () => {
  const metrics = computeMetrics(standardMarks());
  assert.deepEqual(evaluateBudgets(metrics, { readyMs: 2000, paintMs: 2000 }), []);
});

test("evaluateBudgets passes when no budget is set (NaN filtered out)", () => {
  const metrics = computeMetrics(standardMarks());
  assert.deepEqual(evaluateBudgets(metrics, { readyMs: NaN, paintMs: NaN }), []);
});

test("evaluateBudgets flags readyMs over budget", () => {
  const metrics = computeMetrics(standardMarks());
  const v = evaluateBudgets(metrics, { readyMs: 500 });
  assert.deepEqual(v, ["readyMs 1100ms > budget 500ms"]);
});

test("evaluateBudgets flags paintMs over budget", () => {
  const metrics = computeMetrics(standardMarks());
  const v = evaluateBudgets(metrics, { paintMs: 500 });
  assert.deepEqual(v, ["paintMs 1000ms > budget 500ms"]);
});

test("evaluateBudgets can flag both metrics at once", () => {
  const metrics = computeMetrics(standardMarks());
  const v = evaluateBudgets(metrics, { readyMs: 500, paintMs: 500 });
  assert.equal(v.length, 2);
});

test("evaluateBudgets does not flag a metric that the trace did not record", () => {
  const partial = computeMetrics([{ ts: 100, name: "app-whenReady" }]);
  const v = evaluateBudgets(partial, { readyMs: 1, paintMs: 1 });
  assert.deepEqual(v, []); // both metrics are null → not flaggable
});

test("buildJsonArtifact emits a stable v1 schema with the supplied budgets", () => {
  const metrics = computeMetrics(standardMarks());
  const artifact = buildJsonArtifact(
    metrics,
    "/tmp/trace.jsonl",
    { readyMs: 2000 },
    "2026-01-01T00:00:00Z",
  );
  assert.equal(artifact.schema, "openbuddy/cold-start/v1");
  assert.equal(artifact.measuredAt, "2026-01-01T00:00:00Z");
  assert.equal(artifact.source, "/tmp/trace.jsonl");
  assert.deepEqual(artifact.budgets, { readyMs: 2000 });
  assert.equal(artifact.metrics.readyMs, 1100);
});

test("buildJsonArtifact omits unset budget fields so dashboard consumers can detect 'no budget'", () => {
  const metrics = computeMetrics(standardMarks());
  const artifact = buildJsonArtifact(
    metrics,
    "/tmp/trace.jsonl",
    { readyMs: NaN },
    "2026-01-01T00:00:00Z",
  );
  assert.deepEqual(artifact.budgets, {});
});
