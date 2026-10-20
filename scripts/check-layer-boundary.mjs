#!/usr/bin/env node
//====================================================================
// scripts/check-layer-boundary.mjs — 4 层架构边界校验(2026-09 改造)
//
// 4 层定义(详见 packages/ui/AGENTS.md):
//   Tier 0 根基: cordis / renderer-host / plugin-host / plugin-sdk / storage /
//              logging-* / shared-types
//   Tier 1 服务: auth-* / files-kb / team-team / collaboration-* / fs-* /
//              capability-* / bundle-base / core-session
//   Tier 2 渲染: Tier 1 包的 ./renderer 子路径(显式) + Tier 1 包的纯类型
//              (被 type-only 引用允许)
//   Tier 3 UI: ui-* 包全部 + agent-rpc + platform
//
// 边界规则:
//   Tier 0 → 任何层都可 import
//   Tier 1 → 同层 + Tier 2 + Tier 3
//   Tier 2 → Tier 2 + Tier 3(只能通过 ./renderer 子路径)
//   Tier 3 → Tier 0 + Tier 3(纯类型引用 Tier 1 允许)
//
// 违规 → exit 1 + 文件:行号违规清单
//====================================================================
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");

const TIER_BY_PACKAGE = {
  // Tier 0 根基
  "@openbuddy/cordis": 0,
  "@openbuddy/renderer-host": 0,
  "@openbuddy/plugin-host": 0,
  "@openbuddy/plugin-sdk": 0,
  "@openbuddy/storage": 0,
  "@openbuddy/logging-main": 0,
  "@openbuddy/logging-renderer": 0,
  "@openbuddy/logging-shared": 0,
  "@openbuddy/shared-types": 0,

  // Tier 1 服务/能力底层
  "@openbuddy/auth-casdoor": 1,
  "@openbuddy/auth-permission": 1,
  "@openbuddy/files-kb": 1,
  "@openbuddy/team-team": 1,
  "@openbuddy/collaboration-coordinator": 1,
  "@openbuddy/collaboration-inbox": 1,
  "@openbuddy/collaboration-evidence": 1,
  "@openbuddy/collaboration-network": 1,
  "@openbuddy/collaboration-policy": 1,
  "@openbuddy/collaboration-protocol": 1,
  "@openbuddy/collaboration-room": 1,
  "@openbuddy/collaboration-task": 1,
  "@openbuddy/fs-fs-local": 1,
  "@openbuddy/capability-authorization": 1,
  "@openbuddy/capability-calendar": 1,
  "@openbuddy/capability-email": 1,
  "@openbuddy/capability-mcp-client": 1,
  "@openbuddy/capability-plan": 1,
  "@openbuddy/capability-folder-trust": 1,
  "@openbuddy/bundle-base": 1,
  "@openbuddy/core-session": 1,

  // Tier 3 UI 表现层
  "@openbuddy/agent-rpc": 3,
  "@openbuddy/platform": 3,
};

const uiDir = join(repoRoot, "packages/ui");
if (existsSync(uiDir)) {
  for (const ent of readdirSync(uiDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || !ent.name.startsWith("openbuddy-ui-")) continue;
    const pkgName = "@openbuddy/" + ent.name.replace(/^openbuddy-/, "");
    TIER_BY_PACKAGE[pkgName] = 3;
  }
}

function targetTier(specifier) {
  const m = specifier.match(/^(@openbuddy\/[^/'"`]+)(?:\/(.+))?$/);
  if (!m) return null;
  const pkg = m[1];
  const subpath = m[2];
  const tier = TIER_BY_PACKAGE[pkg];
  if (tier === undefined) return null;
  if (tier === 1 && subpath === "renderer") return 2;
  return tier;
}

function* walkSrc(dir) {
  if (!existsSync(dir)) return;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist") continue;
        stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(ent.name)) continue;
      yield full;
    }
  }
}

function fileToPackage(file) {
  const m = file.match(/packages\/[^/]+\/([^/]+)\/src\//);
  if (m) {
    return "@openbuddy/" + m[1].replace(/^openbuddy-/, "");
  }
  if (file.includes("/apps/")) return null;
  if (file.includes("/electron/")) return null;
  if (file.includes("/src/")) return null;
  return null;
}

// Tier X (FROM) → set of Tier Y (TO) it can import
// Tier 0 根基:任何层都可 import;Tier 2 是 renderer 给 Tier 3 用的 API
const ALLOWED = {
  0: new Set([0, 1, 2, 3]),
  1: new Set([0, 1]),  // 服务只依赖根基 + 同层
  2: new Set([0, 1, 2, 3]),  // renderer adapter 可引用全部(实现层用)
  3: new Set([0, 2, 3]),  // UI 用根基 + renderer API + 同层
};

// 判断一行 import 语句是否纯类型引用
function isTypeOnlyLine(line) {
  if (/\bimport\s+type\s+/.test(line)) return true;
  if (/^\s*export\s+type\s+/.test(line)) return true;
  // `import { type Foo, type Bar }` 或 `import { Foo, type Bar }`
  if (/\{\s*type\s+\w+/.test(line)) return true;
  if (/,\s*type\s+\w+\s*\}/.test(line)) return true;
  // 仅有 type 修饰符的 named imports
  return false;
}

const violations = [];
let scannedFiles = 0;

for (const file of walkSrc(repoRoot)) {
  scannedFiles++;
  const fromPkg = fileToPackage(file);
  if (!fromPkg) continue;
  const fromTier = TIER_BY_PACKAGE[fromPkg];
  if (fromTier === undefined) continue;

  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    const importMatch = line.match(/(?:from|import)\s+['"]([^'"]+)['"]/);
    if (!importMatch) return;
    const spec = importMatch[1];
    const targetT = targetTier(spec);
    if (targetT === null) return;
    // 例外:Tier 2/3 通过 type-only 引用 Tier 1 的类型是被允许的
    const typeOnly = isTypeOnlyLine(line);
    const typeOnlyAllowed =
      typeOnly && fromTier >= 2 && targetT === 1;
    if (typeOnlyAllowed) return;
    if (!ALLOWED[fromTier].has(targetT)) {
      violations.push({
        file: file.replace(repoRoot + "/", ""),
        line: i + 1,
        from: fromPkg + " (Tier " + fromTier + ")",
        to: spec + " (Tier " + targetT + ")",
        text: line.trim(),
        isTypeOnly: typeOnly,
      });
    }
  });
}

console.log("[check-layer-boundary] scanned " + scannedFiles + " files");
if (violations.length === 0) {
  console.log("[check-layer-boundary] all imports respect 4-layer boundaries ✓");
  process.exit(0);
}

console.error("[check-layer-boundary] " + violations.length + " violation(s):");
for (const v of violations) {
  const marker = v.isTypeOnly ? "[TYPE-ONLY]" : "[VALUE-IMPORT]";
  console.error("  " + marker + " " + v.file + ":" + v.line + "  " + v.from + " → " + v.to);
  console.error("    " + v.text);
}
process.exit(1);
