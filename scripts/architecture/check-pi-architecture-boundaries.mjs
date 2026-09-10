#!/usr/bin/env node
// CI gate for the OpenBuddy PI architecture dependency direction.
//
// Phase 7.1 of plan3.0.md:
//   Detect 4 cross-layer reverse-import violations that sheriff.config.ts
//   flags as "warn" but does not yet promote to "error" (the 0.19.6 release
//   has 3 SH-001 false-positives around the ui-* baseUrl aliases that we
//   avoid by scanning .ts source paths instead of resolving tsconfig path
//   aliases).
//
// Rules:
//   1. electron/main/agent/host-modules must not import agent-host
//      (composition root reverse-import).
//   2. packages/ui/openbuddy-ui-*/src must not import electron/main
//      or packages/runtime/openbuddy-plugin-host/src directly
//      (UI <-> core boundary; preload contract is the only path).
//   3. packages/runtime/openbuddy-plugin-host/src must not import
//      electron/main (plugin host stays renderer-agnostic).
//   4. packages/runtime/openbuddy-plugin-sdk/src must not import
//      electron/main or packages/ui (plugin SDK stays transport-agnostic).
//
// Comments and test fixtures are intentionally included: a reverse import
// is unsafe regardless of the caller.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Each rule: { id, dir, banned } where banned is a list of spec SUFFIXES
// the source may NOT import. Suffix match means "../agent-host" matches
// but "../agent-host-provider-registry" does NOT (composition root only).
const RULES = [
  {
    id: "host-modules -> agent-host",
    dir: join(root, "electron", "main", "agent", "host-modules"),
    banned: ["../agent-host", "../../agent-host"],
  },
  {
    id: "ui packages -> electron/main or plugin-host",
    dir: join(root, "packages", "ui"),
    banned: [
      "../../../../electron/main/",
      "../../../../../electron/main/",
      "../../../../packages/runtime/openbuddy-plugin-host/src/",
      "../../../../../packages/runtime/openbuddy-plugin-host/src/",
    ],
    prefix: "openbuddy-ui-",
    inside: "src",
  },
  {
    id: "plugin-host -> electron/main",
    dir: join(root, "packages", "runtime", "openbuddy-plugin-host", "src"),
    banned: ["../../../electron/main/", "../../../../electron/main/"],
  },
  {
    id: "plugin-sdk -> electron/main or ui packages",
    dir: join(root, "packages", "runtime", "openbuddy-plugin-sdk", "src"),
    banned: [
      "../../../electron/main/",
      "../../../../electron/main/",
      "../../../packages/ui/openbuddy-ui-",
      "../../../../packages/ui/openbuddy-ui-",
    ],
  },
];

const IMPORT_RE = /(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])([^"']+)["']/g;

function visit(directory) {
  if (!existsSync(directory)) return [];
  const out = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...visit(path));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const violations = [];
const stats = { filesScanned: 0, rulesChecked: RULES.length };

for (const rule of RULES) {
  if (!existsSync(rule.dir)) continue;
  let files;
  if (rule.prefix) {
    // ui packages: scan each openbuddy-ui-*/src subdir.
    files = [];
    for (const name of readdirSync(rule.dir)) {
      if (!name.startsWith(rule.prefix)) continue;
      const sub = join(rule.dir, name, rule.inside ?? "src");
      if (existsSync(sub)) files.push(...visit(sub));
    }
  } else {
    files = visit(rule.dir);
  }

  for (const file of files) {
    stats.filesScanned += 1;
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    lines.forEach((lineText, index) => {
      const trimmed = lineText.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      IMPORT_RE.lastIndex = 0;
      let match;
      while ((match = IMPORT_RE.exec(lineText)) !== null) {
        const spec = match[1];
        if (!spec.startsWith(".") && !spec.startsWith("/")) continue; // bare module import
        for (const banned of rule.banned) {
          // Match either the exact banned spec OR a child of it
          // (e.g. '../agent-host' or '../agent-host/foo'). This avoids
          // catching '../agent-host-provider-registry' which is a
          // sibling file, not the composition root.
          if (spec === banned || spec.startsWith(banned + "/")) {
            violations.push({
              rule: rule.id,
              file: relative(root, file),
              line: index + 1,
              spec,
              detail: `banned import (${banned})`,
            });
            return;
          }
        }
      }
    });
  }
}

const result = {
  schema: "openbuddy.pi-architecture-boundaries.v1",
  ...stats,
  violations,
  passed: violations.length === 0,
};
console.log(JSON.stringify(result, null, 2));
if (violations.length > 0) process.exit(1);