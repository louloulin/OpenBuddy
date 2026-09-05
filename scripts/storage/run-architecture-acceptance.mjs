import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkArchitectureBoundaries } from "./check-architecture-boundaries.mjs";

const root = resolve(import.meta.dirname, "../..");
const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const storageIndex = read("packages/runtime/openbuddy-storage/src/index.ts");
const preflight = read("packages/runtime/openbuddy-storage/src/adapters/legacy-preflight.ts");
const storageDriver = read("packages/runtime/openbuddy-storage/src/sqlite/driver.ts");
const html = read("docs/storage-architecture-audit.html");
const report = read("docs/storage-verification-report.md");
const architecture = read("docs/diagrams/openbuddy-storage-architecture.md");
const boundaryCheck = checkArchitectureBoundaries();

assert(existsSync(resolve(root, "packages/runtime/openbuddy-storage")), "storage package is missing");
assert(storageIndex.includes("openStorage") && storageIndex.includes("MigrationRunner"), "storage package does not export openStorage and migrations");
assert(storageIndex.includes("EventStore") && storageIndex.includes("SessionCatalog"), "storage package does not export event/session catalogs");
assert(storageIndex.includes("ContentAddressedObjectStore") && storageIndex.includes("CredentialStore"), "storage package does not export object/credential seams");
assert(storageIndex.includes("preflightLegacySources") && preflight.includes("openbuddy.storage-legacy-preflight.v1"), "read-only legacy preflight is missing");
assert(storageDriver.includes("PRAGMA busy_timeout") && storageDriver.includes("PRAGMA foreign_keys"), "SQLite safety pragmas are missing");
assert(storageDriver.includes("VACUUM INTO") && storageDriver.includes("BEGIN IMMEDIATE"), "backup/transaction primitives are missing");
assert(!html.includes("<script") && html.includes("Content-Security-Policy") && !/https?:\/\//u.test(html), "offline HTML contains script or external URL");
assert(report.includes("OpenClaw") && report.includes("unknown/not-run"), "verification report does not preserve OpenClaw not-run boundary");
assert(report.includes("A1–A10 证据矩阵"), "verification report is missing the acceptance evidence matrix");
assert(architecture.includes("SQLite") && architecture.includes("Pi JSONL") && architecture.includes("OpenClaw"), "architecture diagram is missing required storage boundaries");
assert(boundaryCheck.violations.length === 0, `architecture boundary violations: ${JSON.stringify(boundaryCheck.violations)}`);

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    schema: "openbuddy.storage-architecture-acceptance.v1",
    checks: ["package-boundary", "sqlite-safety-primitives", "offline-html", "acceptance-matrix", "openclaw-not-run-boundary", "architecture-boundaries", "static-import-boundaries"],
  }, null, 2));
}
