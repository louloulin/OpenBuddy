#!/usr/bin/env node
//====================================================================
// scripts/verify-ui-boundaries.mjs — ui-* 包边界 + 单一来源校验脚本
//
// 2026-09 改造:从 scripts/sync-ui-aliases.mjs(648 行"写入工具")退化为"CI 校验脚本"。
// 单一来源改为:
//   - tsconfig.json 的 paths + references(本脚本只读)
//   - package.json#exports(vite-tsconfig-paths 读)
//   - packages/ui/openbuddy-ui-*/ 目录存在性
//
// 本脚本职责:
//   1. 扫描 packages/ui/openbuddy-ui-* 目录列表,与根 tsconfig.json 的
//      references 比对 → 漏列 exit 1
//   2. 对比 package.json#exports 与 tsconfig.json paths 的子路径一致性
//      → 缺 subpath 告警(不阻塞)
//   3. 硬门禁:ui-* 包源码不应跨多层相对路径回到根 src/(循环依赖式耦合) → exit 1
//   4. 软报告:ui-* 包通过 @/ 别名引用 root src/ 的 lib/stores/assets 等
//      → 打印汇总,不阻塞(留作 L4 拆包路线图)
//
// 本脚本**不写**任何文件 — 所有别名维护交给 vite-tsconfig-paths 插件。
//====================================================================
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const uiDir = join(repoRoot, "packages/ui");

// 白名单:规划中但尚未启动的 stub 包
const STUB_PACKAGES = new Set([
  "openbuddy-agent-rpc",
  "openbuddy-platform",
  "openbuddy-ui-contract",
  "openbuddy-ui-state",
]);

const CONTRACT_PACKAGE_DIRS = new Set([
  "openbuddy-agent-rpc",
  "openbuddy-platform",
]);

function listUiPackages() {
  if (!existsSync(uiDir)) return [];
  return readdirSync(uiDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        (e.name.startsWith("openbuddy-ui-") || CONTRACT_PACKAGE_DIRS.has(e.name)),
    )
    .map((e) => e.name)
    .sort();
}

function packageName(dirName) {
  return "@openbuddy/" + dirName.replace(/^openbuddy-/, "");
}

// 读 tsconfig.json 的 references 与 paths — 用 state machine 去行注释(保留字符串内 //)
function readTsconfig() {
  const raw = readFileSync(join(repoRoot, "tsconfig.json"), "utf8");
  let out = "";
  let i = 0;
  let inString = false;
  let stringQuote = "";
  let escape = false;
  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      continue;
    }
    out += ch;
    i++;
  }
  return JSON.parse(out);
}

// ── 主流程 ────────────────────────────────────────────────────
const allPackages = listUiPackages();
const packages = allPackages.filter((p) => !STUB_PACKAGES.has(p));
const tsconfig = readTsconfig();
const tsconfigRefs = new Set(
  (tsconfig.references ?? []).map((r) => String(r.path ?? "").replace(/^\.\//, ""))
);
const tsconfigPaths = tsconfig.compilerOptions?.paths ?? {};

let errors = 0;
let warnings = 0;

console.log("[verify-ui-boundaries] checking " + packages.length + " ui-* packages against root tsconfig.json references...");
for (const dir of packages) {
  const refPath = "packages/ui/" + dir + "/tsconfig.json";
  if (!tsconfigRefs.has(refPath)) {
    console.error("  MISSING reference: " + refPath);
    errors++;
  }
}

console.log("\n[verify-ui-boundaries] checking package.json#exports vs tsconfig.json paths...");
for (const dir of packages) {
  const pkgPath = join(uiDir, dir, "package.json");
  if (!existsSync(pkgPath)) continue;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    continue;
  }
  const exports = pkg.exports ?? {};
  for (const subpath of Object.keys(exports)) {
    if (!subpath.startsWith(".")) continue;
    let seg = subpath.slice(1);
    if (seg.startsWith("/")) seg = seg.slice(1);
    if (seg === "" || seg === "package.json" || seg === "client" || seg === "invariant") continue;
    const alias = packageName(dir) + "/" + seg;
    if (!tsconfigPaths[alias]) {
      console.warn("  exports declares " + subpath + " but tsconfig.json paths missing " + alias);
      warnings++;
    }
  }
}

console.log("\n[verify-ui-boundaries] linting ui-* src for deep-relative back to root src/...");
const forbiddenDeepRelRe = /from\s+['"](\.\.\/){3,}src\//;
const violations = [];
for (const dir of packages) {
  const srcDir = join(uiDir, dir, "src");
  if (!existsSync(srcDir)) continue;
  const stack = [srcDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(ent.name)) continue;
      const text = readFileSync(full, "utf8");
      text.split("\n").forEach((line, i) => {
        if (forbiddenDeepRelRe.test(line)) {
          violations.push({ file: full, line: i + 1, text: line.trim() });
        }
      });
    }
  }
}
if (violations.length > 0) {
  console.error("\n  " + violations.length + " deep-relative violations:");
  for (const v of violations) {
    console.error("    " + v.file.replace(repoRoot + "/", "") + ":" + v.line + "  " + v.text);
  }
  errors++;
} else {
  console.log("  ok no deep-relative back to root src/");
}

const forbiddenAliasPrefixes = ["foundation/", "lib/", "stores/", "types/", "components/", "hooks/", "utils/", "assets/"];
const softViolations = [];
for (const dir of packages) {
  const srcDir = join(uiDir, dir, "src");
  if (!existsSync(srcDir)) continue;
  const stack = [srcDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(ent.name)) continue;
      const text = readFileSync(full, "utf8");
      text.split("\n").forEach((line, i) => {
        for (const sub of forbiddenAliasPrefixes) {
          const seg = sub.replace(/\/$/, "");
          const re = new RegExp("from\\s+['\"]@\\/" + seg + "(?=[\\s/'\"\\);,])", "");
          if (re.test(line)) {
            softViolations.push({ file: full, line: i + 1, sub });
            break;
          }
        }
      });
    }
  }
}
if (softViolations.length > 0) {
  console.log("\n  " + softViolations.length + " ui-* packages reference @/" + forbiddenAliasPrefixes.join("|@/") + " (前向共享,留作 L4 拆包路线图)");
}

console.log("\n[verify-ui-boundaries] summary: " + errors + " error(s), " + warnings + " warning(s), " + softViolations.length + " soft violation(s)");
console.log("[verify-ui-boundaries] registered packages:");
for (const p of allPackages) console.log("  - " + packageName(p) + (STUB_PACKAGES.has(p) ? " (stub)" : ""));
if (errors > 0) {
  process.exit(1);
}
process.exit(0);
