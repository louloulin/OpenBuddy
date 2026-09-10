#!/usr/bin/env node
// scripts/audit/canonical-packages-e2e.mjs
//
// Node entry that delegates to scripts/audit/canonical-packages-e2e.sh.
// See pi-sdk-usage.mjs for the rationale of the bash-as-source-of-truth
// pattern.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "canonical-packages-e2e.sh");

const args = process.argv.slice(2);
const jsonOnly = args.includes("--json");

try {
  const stdout = execFileSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (jsonOnly) {
    process.stdout.write(stdout);
  } else {
    process.stdout.write(stdout);
  }
} catch (err) {
  console.error("audit failed:", err.message);
  process.exit(1);
}
