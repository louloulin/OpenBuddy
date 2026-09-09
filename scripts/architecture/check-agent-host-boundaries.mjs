#!/usr/bin/env node
/**
 * CI gate for the agent-host dependency direction.
 * host-modules are injected by agent-host and must never import the facade
 * composition root back. Comments and test fixtures are intentionally
 * included: a reverse import is unsafe regardless of the caller.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const modules = join(root, "electron", "main", "agent", "host-modules");
const violations = [];

function visit(directory) {
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) visit(path);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      const source = readFileSync(path, "utf8");
      const lines = source.split("\n");
      lines.forEach((lineText, index) => {
        const line = lineText.trim();
        if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;
        if (/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])\.\.(?:\/agent-host|\/\.\.\/agent-host)["']/.test(line)) {
          violations.push(`${relative(root, path)}:${index + 1}: reverse import of agent-host`);
        }
      });
    }
  }
}

visit(modules);
const result = {
  schema: "openbuddy.agent-host-boundaries.v1",
  checked: relative(root, modules),
  violations,
  passed: violations.length === 0,
};
console.log(JSON.stringify(result, null, 2));
if (violations.length > 0) process.exit(1);
