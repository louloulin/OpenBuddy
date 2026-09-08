/**
 * Pure helpers for `cold-start.mjs` (P3-02).
 *
 * Kept as a separate module so the analyzer can be unit-tested without
 * spinning up a real Electron process. The thin CLI wrapper at
 * `cold-start.mjs` handles I/O and process exit, while this module owns
 * the math (parse, diff, budget evaluation).
 *
 * @typedef {{ts:number,name:string,deltaMs?:number,[k:string]:unknown}} Mark
 */

/** Parse a JSONL buffer into an array of marks. Throws on invalid JSON. */
export function parseJsonl(raw) {
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/** Read a JSONL file from disk. Thin wrapper so callers can mock fs in tests. */
export async function readJsonl(path, fsImpl) {
  const fs = fsImpl ?? (await import("node:fs/promises"));
  const raw = await fs.readFile(path, "utf8");
  return parseJsonl(raw);
}

/** Pick the first mark with a given name, or undefined. */
export function pickFirst(marks, name) {
  return marks.find((m) => m && m.name === name);
}

/** Compute `later.ts - earlier.ts` in ms. Returns null when either is missing. */
export function diffMs(marks, earlierName, laterName) {
  const a = pickFirst(marks, earlierName);
  const b = pickFirst(marks, laterName);
  if (!a || !b) return null;
  return Math.max(0, b.ts - a.ts);
}

/**
 * Compute the canonical cold-start metrics from a list of marks.
 *
 * The "reference" timestamp is `app-whenReady` (Electron `ready` event)
 * because the JSONL cannot record the actual process-spawn wall clock.
 * This keeps the numbers stable across machines: the renderer cannot
 * render before `app.whenReady()` resolves, so any time before that point
 * is opaque to the trace.
 */
export function computeMetrics(marks) {
  const first = marks[0];
  const ready = pickFirst(marks, "window-ready");
  const paint = pickFirst(marks, "first-paint");
  const whenReady = pickFirst(marks, "app-whenReady");
  const reference = whenReady ?? first;

  return {
    readyMs: reference && ready ? Math.max(0, ready.ts - reference.ts) : null,
    paintMs: reference && paint ? Math.max(0, paint.ts - reference.ts) : null,
    harnessMs: diffMs(marks, "app-whenReady", "harness-server-spawn"),
    agentHostMs: diffMs(marks, "app-whenReady", "agent-host-loaded"),
    connectorsMs: diffMs(marks, "connectors-register-start", "connectors-register-end"),
    counts: {
      total: marks.length,
      uniqueNames: new Set(marks.map((m) => m.name)).size,
    },
  };
}

/**
 * Evaluate a metrics object against a budget map.
 * Returns an array of human-readable violation strings, empty on pass.
 */
export function evaluateBudgets(metrics, budgets) {
  const violations = [];
  if (
    Number.isFinite(budgets.readyMs) &&
    metrics.readyMs !== null &&
    metrics.readyMs > budgets.readyMs
  ) {
    violations.push(`readyMs ${metrics.readyMs}ms > budget ${budgets.readyMs}ms`);
  }
  if (
    Number.isFinite(budgets.paintMs) &&
    metrics.paintMs !== null &&
    metrics.paintMs > budgets.paintMs
  ) {
    violations.push(`paintMs ${metrics.paintMs}ms > budget ${budgets.paintMs}ms`);
  }
  return violations;
}

/**
 * Build the JSON artifact the perf dashboard aggregates. Schema version
 * is kept stable so existing aggregators do not break when new mark
 * names are added.
 */
export function buildJsonArtifact(metrics, source, budgets, measuredAt) {
  return {
    schema: "openbuddy/cold-start/v1",
    measuredAt,
    source,
    metrics,
    budgets: {
      ...(Number.isFinite(budgets.readyMs) ? { readyMs: budgets.readyMs } : {}),
      ...(Number.isFinite(budgets.paintMs) ? { paintMs: budgets.paintMs } : {}),
    },
  };
}
