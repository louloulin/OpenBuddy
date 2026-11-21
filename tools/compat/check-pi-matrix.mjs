#!/usr/bin/env node
// Pi compatibility matrix gate (B1a): the record must match the SDK actually installed,
// and every entry must state how it was verified (or why it is market-only).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const matrix = read("tools/compat/pi-matrix.json");
const sdk = read("node_modules/@earendil-works/pi-coding-agent/package.json");
const statuses = new Set(["verified", "market-only", "blocked"]);
const errors = [];

if (matrix.schemaVersion !== 1) errors.push("schemaVersion must be 1");
if (matrix.sdk?.package !== "@earendil-works/pi-coding-agent") errors.push("sdk.package mismatch");
if (matrix.sdk?.version !== sdk.version)
  errors.push(`sdk.version is ${matrix.sdk?.version}, installed is ${sdk.version} — run \`pnpm update\` and re-record`);
if (!Array.isArray(matrix.packages) || matrix.packages.length === 0) errors.push("packages must be a non-empty array");

for (const [index, entry] of (matrix.packages ?? []).entries()) {
  const at = `packages[${index}]`;
  if (typeof entry?.source !== "string" || !entry.source) errors.push(`${at}.source is required`);
  if (typeof entry?.version !== "string" || !entry.version) errors.push(`${at}.version is required`);
  if (!statuses.has(entry?.status)) errors.push(`${at}.status must be one of ${[...statuses].join(" / ")}`);
  if (!Array.isArray(entry?.hostRequirements)) errors.push(`${at}.hostRequirements must be an array`);
  if (!Array.isArray(entry?.failures)) errors.push(`${at}.failures must be an array`);
  if (entry?.status === "verified" && typeof entry?.verifiedBy !== "string") errors.push(`${at}.verifiedBy is required when status is verified`);
  if (entry?.status === "market-only" && typeof entry?.notes !== "string") errors.push(`${at}.notes is required when status is market-only`);
}

const summary = {
  sdk: sdk.version,
  packages: matrix.packages?.length ?? 0,
  verified: (matrix.packages ?? []).filter((entry) => entry.status === "verified").length,
  marketOnly: (matrix.packages ?? []).filter((entry) => entry.status === "market-only").length,
};
if (errors.length) {
  console.error("PI_MATRIX_FAIL", JSON.stringify(summary));
  for (const error of errors) console.error(" -", error);
  process.exit(1);
}
console.log("PI_MATRIX_OK", JSON.stringify(summary));
