// Golden snapshot compare helper. Used by evals/node runners and the
// scripts/electron closed-loop launcher. See evals/golden/README.md for
// the schema and lifecycle.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SCHEMA = "openbuddy.golden-snapshot.v1";

/**
 * Compare a runner's `results` against the golden snapshot at
 * `{goldenDir}/{datasetHash}.json`.
 *
 * Behavior:
 *   - No golden on disk + `OPENBUDDY_GOLDEN_UPDATE=1` → write the golden,
 *     return `{pass: true, status: "seeded", mismatches: []}`.
 *   - No golden on disk + no update flag → return
 *     `{pass: true, status: "no-golden", mismatches: []}` (first-run; runner
 *     exits non-zero only if a downstream audit requires a golden).
 *   - Golden on disk with different datasetHash than what the runner was
 *     built against → return `{pass: true, status: "stale-hash",
 *     staleDatasetHash, currentDatasetHash}` (caller decides whether to
 *     re-seed via OPENBUDDY_GOLDEN_UPDATE=1).
 *   - Golden on disk, same hash, mismatches → return
 *     `{pass: false, status: "mismatch", mismatches: [...]}` unless
 *     `OPENBUDDY_GOLDEN_TOLERATE=1`.
 *   - Golden on disk, same hash, all match → return
 *     `{pass: true, status: "match", mismatches: []}`.
 *
 * @param {object} options
 * @param {string} options.runnerId
 * @param {string} options.datasetHash 16-char sha256 prefix
 * @param {Array} options.results       runner's per-task results
 * @param {string} options.goldenDir    absolute path to runner's golden dir
 * @returns {{
 *   pass: boolean,
 *   status: "seeded" | "no-golden" | "stale-hash" | "mismatch" | "match",
 *   mismatches: Array<{id, expected, actual}>,
 *   currentDatasetHash?: string,
 *   staleDatasetHash?: string,
 * }}
 */
export function compareToGolden({ runnerId, datasetHash, results, goldenDir }) {
  const updateMode = process.env.OPENBUDDY_GOLDEN_UPDATE === "1";
  const tolerate = process.env.OPENBUDDY_GOLDEN_TOLERATE === "1";

  if (!datasetHash) {
    return { pass: false, status: "no-dataset-hash", mismatches: [{ id: "*", expected: "datasetHash", actual: null }] };
  }

  const goldenPath = join(goldenDir, `${datasetHash}.json`);

  // No golden on disk.
  if (!existsSync(goldenPath)) {
    if (updateMode) {
      writeGolden({ goldenPath, runnerId, datasetHash, results });
      return { pass: true, status: "seeded", mismatches: [], currentDatasetHash: datasetHash };
    }
    return { pass: true, status: "no-golden", mismatches: [], currentDatasetHash: datasetHash };
  }

  // Golden on disk — load and compare.
  let golden;
  try {
    golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  } catch (error) {
    return {
      pass: false,
      status: "mismatch",
      mismatches: [{ id: "*", expected: "valid JSON", actual: String(error?.message ?? error) }],
      currentDatasetHash: datasetHash,
    };
  }

  if (golden.datasetHash !== datasetHash) {
    // Runner was run against a different dataset than this golden
    // represents. Caller decides whether to re-seed via update flag.
    return {
      pass: true,
      status: "stale-hash",
      mismatches: [],
      currentDatasetHash: datasetHash,
      staleDatasetHash: golden.datasetHash,
    };
  }

  const mismatches = diffResults(golden.results ?? [], Array.isArray(results) ? results : []);
  const pass = mismatches.length === 0 || tolerate;

  if (mismatches.length > 0 && !pass) {
    return { pass: false, status: "mismatch", mismatches, currentDatasetHash: datasetHash };
  }
  return { pass, status: "match", mismatches, currentDatasetHash: datasetHash };
}

/**
 * Diff two result arrays by `id`. Reports cases where `ok`, `eventsFingerprint`,
 * or `errorDigest` differ.
 */
function diffResults(expected, actual) {
  const expectedById = new Map();
  for (const entry of expected) {
    if (entry && typeof entry === "object" && "id" in entry) {
      expectedById.set(String(entry.id), entry);
    }
  }
  const actualById = new Map();
  for (const entry of actual) {
    if (entry && typeof entry === "object" && "id" in entry) {
      actualById.set(String(entry.id), entry);
    }
  }
  const mismatches = [];
  const allIds = new Set([...expectedById.keys(), ...actualById.keys()]);
  for (const id of allIds) {
    const exp = expectedById.get(id);
    const act = actualById.get(id);
    if (!exp) {
      mismatches.push({ id, expected: null, actual: summarize(act), field: "presence" });
      continue;
    }
    if (!act) {
      mismatches.push({ id, expected: summarize(exp), actual: null, field: "presence" });
      continue;
    }
    for (const field of ["ok", "eventsFingerprint", "errorDigest"]) {
      if (exp[field] !== act[field]) {
        mismatches.push({ id, expected: exp[field], actual: act[field], field });
      }
    }
  }
  return mismatches;
}

function summarize(entry) {
  if (!entry) return null;
  return {
    ok: entry.ok,
    eventsFingerprint: entry.eventsFingerprint ?? null,
    errorDigest: entry.errorDigest ?? null,
  };
}

function writeGolden({ goldenPath, runnerId, datasetHash, results }) {
  mkdirSync(dirname(goldenPath), { recursive: true });
  const sanitized = (Array.isArray(results) ? results : []).map((entry) => ({
    id: entry?.id ?? null,
    ok: Boolean(entry?.ok),
    eventsFingerprint: entry?.eventsFingerprint ?? null,
    errorDigest: entry?.errorDigest ?? null,
  }));
  const golden = {
    schema: SCHEMA,
    runnerId,
    datasetHash,
    createdAt: new Date().toISOString(),
    results: sanitized,
  };
  writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n", { mode: 0o644 });
}