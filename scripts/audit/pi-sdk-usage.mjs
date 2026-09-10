#!/usr/bin/env node
// scripts/audit/pi-sdk-usage.mjs
//
// Node entry that delegates to scripts/audit/pi-sdk-usage.sh — keeps the bash
// script as source-of-truth (works without node) while exposing a typed JSON
// shape for pnpm scripts and CI.
//
// Usage:
//   node scripts/audit/pi-sdk-usage.mjs                  # human table + JSON
//   node scripts/audit/pi-sdk-usage.mjs --json           # only JSON
//   node scripts/audit/pi-sdk-usage.mjs --root <dir>
//
// Exit codes mirror the bash script.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "pi-sdk-usage.sh");

const args = process.argv.slice(2);
const jsonOnly = args.includes("--json");

try {
  const stdout = execFileSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (jsonOnly) {
    // bash --json prints JSON on stdout
    process.stdout.write(stdout);
  } else {
    // bash prints human table on stdout + JSON on stderr
    process.stdout.write(stdout);
  }
} catch (err) {
  console.error("audit failed:", err.message);
  process.exit(1);
}
