#!/usr/bin/env node
// scripts/audit/test-coverage.mjs — bash thin wrapper (no node deps)
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "test-coverage.sh");
const args = process.argv.slice(2);

const stdout = execFileSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
process.stdout.write(stdout);