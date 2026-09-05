#!/usr/bin/env node
//====================================================================
// scripts/sync-ui-aliases.mjs — ui-* 包路径别名单一来源同步脚本
//
// 扫描 packages/ui/* 后,自动维护三个位置:
//   1. 根 tsconfig.json 的 paths(让根 App / electron 能解析 @openbuddy/ui-*)
//   2. 每个 ui-* 包 tsconfig.json 的 paths(让兄弟包互相解析)
//   3. packages/ui/alias-list.json(供 electron.vite.config.ts 等运行时工具使用)
//
// 幂等且保守:只新增,不删除也不重排已有条目。添加 / 删除任何
// packages/ui/openbuddy-ui-* 目录后运行本脚本即可。
//====================================================================
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const uiDir = join(repoRoot, "packages/ui");
const aliasListPath = join(uiDir, "alias-list.json");

// 工作区非 ui-* 包的别名(供 ui-* 包跨包 import)
const workspacePackageAliases = {
  "@openbuddy/shared-types": "packages/shared/openbuddy-types/src/index.ts",
  "@openbuddy/files-kb": "packages/shared/openbuddy-files-kb/src/index.ts",
  "@openbuddy/cordis": "packages/runtime/openbuddy-cordis/src/index.ts",
  "@openbuddy/auth-casdoor": "packages/auth/openbuddy-casdoor/src/index.ts",
  "@openbuddy/auth-permission": "packages/auth/openbuddy-permission/src/index.ts",
  "@openbuddy/plugin-host": "packages/runtime/openbuddy-plugin-host/src/index.ts",
  "@openbuddy/bundle-base": "packages/bundle/openbuddy-base/src/index.ts",
  "@openbuddy/renderer-host": "packages/renderer/openbuddy-renderer-host/src/index.ts",
  "@openbuddy/core-session": "packages/core/openbuddy-session/src/index.ts",
  "@openbuddy/storage": "packages/runtime/openbuddy-storage/src/index.ts",
};

function listUiPackages() {
  if (!existsSync(uiDir)) return [];
  return readdirSync(uiDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("openbuddy-ui-"))
    .map((e) => e.name)
    .sort();
}

function packageName(dirName) {
  return "@openbuddy/" + dirName.replace(/^openbuddy-/, "");
}

function srcEntry(dirName, suffix) {
  const file = suffix || "index";
  if (file === "client") {
    const tsxPath = join(uiDir, dirName, "src", "client.tsx");
    if (existsSync(tsxPath)) {
      return "./packages/ui/" + dirName + "/src/client.tsx";
    }
  }
  return "./packages/ui/" + dirName + "/src/" + file + ".ts";
}

function toRepoRelative(absPath) {
  const posix = absPath.split(sep).join("/");
  const rootPosix = repoRoot.split(sep).join("/");
  if (posix.startsWith(rootPosix + "/")) {
    return "./" + posix.slice(rootPosix.length + 1);
  }
  return posix.startsWith("./") ? posix : "./" + posix;
}

function resolveExportPath(dirName, target) {
  let stripped = target.replace(/^\.\//, "");
  const candidate = stripped.startsWith("src/") ? stripped : "src/" + stripped;
  return toRepoRelative(join(uiDir, dirName, candidate));
}

function buildDesiredPaths(packages) {
  const paths = [];
  for (const dir of packages) {
    const name = packageName(dir);
    paths.push([name, [srcEntry(dir)]]);
    paths.push([name + "/client", [srcEntry(dir, "client")]]);
    paths.push([name + "/invariant", [srcEntry(dir, "invariant")]]);

    const pkgPath = join(uiDir, dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const exports = pkg.exports || {};
        for (const [subpath, target] of Object.entries(exports)) {
          if (!subpath.startsWith(".")) continue;
          let seg = subpath.slice(1);
          if (seg.startsWith("/")) seg = seg.slice(1);
          if (seg === "" || seg === "package.json") continue;
          if (seg === "client" || seg === "invariant") continue;
          if (typeof target !== "string") continue;
          paths.push([name + "/" + seg, [resolveExportPath(dir, target)]]);
        }
      } catch (err) {
        console.warn("[sync-ui-aliases] failed to read exports from " + pkgPath + ": " + err.message);
      }
    }
  }
  return paths.sort(([a], [b]) => a.localeCompare(b));
}

function findPathsBlock(raw) {
  const start = raw.indexOf('"paths"');
  if (start < 0) return null;
  const open = raw.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  let end = -1;
  let inString = false;
  let stringQuote = "";
  let escape = false;
  for (let i = open; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === stringQuote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringQuote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  return { start, open, end };
}

function parseExistingKeys(blockText) {
  const keys = new Set();
  const re = /"((?:[^"\\]|\\.)+)"\s*:\s*\[/g;
  let m;
  while ((m = re.exec(blockText)) !== null) keys.add(m[1]);
  return keys;
}

function insertMissingEntries(raw, block, missing) {
  if (missing.length === 0) return raw;
  const lineStart = raw.lastIndexOf("\n", block.end) + 1;
  const closingIndent = raw.slice(lineStart, block.end).match(/^\s*/)[0];

  const innerIndent = closingIndent + "  ";
  // 每个新条目都带逗号;但最后一个新条目的逗号需要剥掉,避免 JSON 出现 trailing comma。
  const newLines = missing
    .map(([key, value], i) => {
      const sep = i === missing.length - 1 ? "" : ",";
      return innerIndent + JSON.stringify(key) + ": " + JSON.stringify(value) + sep;
    })
    .join("\n");

  const before = raw.slice(0, block.end);
  const after = raw.slice(block.end);

  let cutAt = block.end;
  while (cutAt > block.open + 1 && /\s/.test(raw[cutAt - 1])) cutAt--;
  if (raw[cutAt - 1] !== ",") {
    const lastEntryEnd = cutAt;
    return raw.slice(0, lastEntryEnd) + ",\n" + newLines + "\n" + closingIndent + "}" + raw.slice(block.end + 1);
  }
  return before + "\n" + newLines + "\n" + closingIndent + "}" + after.slice(1);
}

function patchTsconfigPaths(tsconfigPath, desiredPaths, baseUrl = ".") {
  if (!existsSync(tsconfigPath)) return false;
  const raw = readFileSync(tsconfigPath, "utf8");
  const block = findPathsBlock(raw);
  if (!block) {
    console.warn("[sync-ui-aliases] paths block not found in " + tsconfigPath + " — skipping");
    return false;
  }
  const blockText = raw.slice(block.open, block.end + 1);
  const existing = parseExistingKeys(blockText);
  const missing = desiredPaths.filter(([k]) => !existing.has(k));
  if (missing.length === 0) return false;
  const newRaw = insertMissingEntries(raw, block, missing);
  writeFileSync(tsconfigPath, newRaw);
  return missing.length;
}

// Compute paths for a single ui-* package (path keys are package-internal)
function buildPackageUiPaths(packages, thisPackageName) {
  const paths = [];
  for (const dir of packages) {
    const name = packageName(dir);
    // 不跳过自身:其他包(被 paths 间接拉入 program)的文件可能反向引用本包,
    // 此时需要 `@openbuddy/<self>` 也可解析。
    paths.push([name, [srcEntry(dir)]]);
    paths.push([name + "/client", [srcEntry(dir, "client")]]);
    paths.push([name + "/invariant", [srcEntry(dir, "invariant")]]);

    // Subpath exports
    const pkgPath = join(uiDir, dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const exports = pkg.exports || {};
        for (const [subpath, target] of Object.entries(exports)) {
          if (!subpath.startsWith(".")) continue;
          let seg = subpath.slice(1);
          if (seg.startsWith("/")) seg = seg.slice(1);
          if (seg === "" || seg === "package.json") continue;
          if (seg === "client" || seg === "invariant") continue;
          if (typeof target !== "string") continue;
          paths.push([name + "/" + seg, [resolveExportPath(dir, target)]]);
        }
      } catch {}
    }
  }
  // Add workspace non-ui packages
  for (const [k, v] of Object.entries(workspacePackageAliases)) {
    paths.push([k, ["./" + v]]);
  }
  return paths.sort(([a], [b]) => a.localeCompare(b));
}

function patchRootTsconfig(desiredPaths) {
  const tsconfigPath = join(repoRoot, "tsconfig.json");
  const inserted = patchTsconfigPaths(tsconfigPath, desiredPaths, ".");
  if (inserted) {
    console.log("[sync-ui-aliases] root tsconfig.json: +" + inserted + " entries");
  } else {
    console.log("[sync-ui-aliases] root tsconfig.json already up to date.");
  }
}

function patchPackageTsconfigs(packages) {
  let totalInserted = 0;
  for (const dir of packages) {
    const tsconfigPath = join(uiDir, dir, "tsconfig.json");
    if (!existsSync(tsconfigPath)) continue;
    const thisName = packageName(dir);
    const desired = buildPackageUiPaths(packages, thisName);
    const inserted = patchTsconfigPaths(tsconfigPath, desired, "../../..");
    if (inserted) {
      console.log("[sync-ui-aliases] " + thisName + ": +" + inserted + " entries");
      totalInserted += inserted;
    }
    // 自动补 assets.d.ts 到 include(若任何 ui-* 包引用了 @/assets/*,全包都加,
    // 因为跨包 tsc 会通过 paths 拉入其他包的文件并触发声明解析。)
    if (anyPackageNeedsAssets() && ensureAssetsDtsInclude(dir, tsconfigPath)) {
      console.log("[sync-ui-aliases] " + thisName + ": +assets.d.ts include");
    }
  }
  if (totalInserted === 0) {
    console.log("[sync-ui-aliases] all ui-* tsconfig.json files already up to date.");
  }
}

function packageNeedsAssetsDts(pdir) {
  // 自动检测包内是否有 @/assets/* 引用。任意 ui-* 包只要含有这类引用,
  // 都需要 packages/ui/assets.d.ts 的模块声明在 include 中可用。
  // 跨包 tsc 会通过 paths 把其他包的源码拉入 program,可能间接命中 @/assets/*,
  // 因此我们在所有 ui-* 包的 tsconfig.json 都追加 ../assets.d.ts(共享,单一来源)。
  const srcDir = join(uiDir, pdir, "src");
  if (!existsSync(srcDir)) return false;
  const re = /from\s*["']@\/assets\/[^"']+["']/;
  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (walk(p)) return true;
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
        try {
          const body = readFileSync(p, "utf8");
          if (re.test(body)) return true;
        } catch {}
      }
    }
    return false;
  }
  return walk(srcDir);
}

// 全局判断:若任何 ui-* 包有 @/assets/* 引用,所有包都应包含 ../assets.d.ts
function anyPackageNeedsAssets() {
  const uiPkgs = listUiPackages();
  for (const p of uiPkgs) if (packageNeedsAssetsDts(p)) return true;
  return false;
}

function ensureAssetsDtsInclude(pdir, tsconfigPath) {
  // packages/ui/assets.d.ts 是 ui-* 包共用的资产模块声明文件;
  // 它放在 packages/ui/ 下(不进任何具体包),所有 ui-* 包都通过 ../assets.d.ts 引用。
  // 这样:既不依赖仓库根 src/*,又只需维护一份声明。
  const sharedAssets = join(uiDir, "assets.d.ts");
  if (!existsSync(sharedAssets)) {
    const content =
      "/** Module declarations for static asset imports (shared across ui-* packages). */\n" +
      "declare module \"*.png\" { const src: string; export default src; }\n" +
      "declare module \"*.jpg\" { const src: string; export default src; }\n" +
      "declare module \"*.jpeg\" { const src: string; export default src; }\n" +
      "declare module \"*.svg\" { const src: string; export default src; }\n" +
      "declare module \"*.gif\" { const src: string; export default src; }\n" +
      "declare module \"*.webp\" { const src: string; export default src; }\n" +
      "declare module \"*.css\";\n";
    writeFileSync(sharedAssets, content);
  }
  if (!existsSync(tsconfigPath)) return false;
  const raw = readFileSync(tsconfigPath, "utf8");
  // 已包含 ../assets.d.ts 或 ./src/assets.d.ts 则跳过
  if (raw.includes("../assets.d.ts") || raw.includes("./src/assets.d.ts")) return false;
  // 去掉旧的仓库根引用
  let newRaw = raw.replace(
    /,?\s*"\.\.\/\.\.\/\.\.\/src\/types\/assets\.d\.ts"/,
    ""
  );
  // 在 include 中追加 "../assets.d.ts"
  if (!newRaw.includes("../assets.d.ts")) {
    newRaw = newRaw.replace(
      /"include"\s*:\s*\[\s*"src"(\s*,\s*"[^"]*")?\s*\]/,
      '"include": [\n    "src",\n    "../assets.d.ts"\n  ]'
    );
  }
  if (newRaw === raw) return false;
  writeFileSync(tsconfigPath, newRaw);
  return true;
}

function patchAggregationReferences(packages) {
  // packages/ui/tsconfig.json 是一个聚合配置,它的 references 字段应包含所有
  // ui-* 子包路径。新增 / 删除子包时,自动同步。
  const tsconfigPath = join(uiDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return;
  const raw = readFileSync(tsconfigPath, "utf8");
  // 找到 "references": [ ... ] 块(剥去注释后用正则找)
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
  const m = stripped.match(/"references"\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return;
  const inner = m[1];
  const existing = new Set();
  for (const line of inner.split(/[\n,]/)) {
    const tm = line.match(/"\.\/([\w-]+)"/);
    if (tm) existing.add(tm[1]);
  }
  const desired = new Set(packages);
  const missing = [...desired].filter((d) => !existing.has(d)).sort();
  const stale = [...existing].filter((d) => !desired.has(d));
  if (missing.length === 0 && stale.length === 0) return;
  if (missing.length > 0) console.log("[sync-ui-aliases] aggregation references: +" + missing.join(", "));
  if (stale.length > 0) console.log("[sync-ui-aliases] aggregation references: -" + stale.join(", "));
  // 用原始 raw 中的 references 块做字符串替换,以保留注释 / 缩进风格
  // 找到 references 数组的右括号位置
  const reRef = /"references"\s*:\s*\[/;
  const refStart = stripped.search(reRef);
  if (refStart < 0) return;
  // 在 raw 中定位对应位置(粗略,假设 // 注释只出现在文件头)
  // 简化做法:整体重写 references 块
  const before = raw.slice(0, refStart);
  const afterRef = stripped.indexOf("]", refStart);
  const after = raw.slice(stripped.indexOf("]", refStart));
  // 构造新的 references 数组
  const desiredSorted = [...desired].sort();
  const newBlock =
    '"references": [\n' +
    desiredSorted.map((d) => '    { "path": "./' + d + '" }').join(",\n") +
    "\n  ]";
  // 保留 raw 的 head 注释
  const headComment = (() => {
    let c = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("//")) c += line + "\n";
      else if (line.trim()) break;
    }
    return c;
  })();
  // 抽取 extends + compilerOptions + 它们的 } 之后的内容(include 等)
  // 这里采取保守做法:把整个 tsconfig.json 反序列化、修改、序列化
  const jsonRaw = raw.replace(/^\s*\/\/.*$/gm, "");
  let cfg;
  try { cfg = JSON.parse(jsonRaw); } catch { return; }
  cfg.references = desiredSorted.map((d) => ({ path: "./" + d }));
  const newRaw = headComment + JSON.stringify(cfg, null, 2) + "\n";
  writeFileSync(tsconfigPath, newRaw);
}

function writeAliasList(packages) {
  // 既给 vite alias 用,也给 consumers(文档/编辑器)用:每个 ui-* 包的所有
  // subpath(./、./client、./invariant、./styles、./icons、./schedule-utils …)
  // 一并展开。读取 buildDesiredPaths 的同一份数据,避免漏写。
  const desired = buildDesiredPaths(packages);
  const byName = new Map();
  for (const [name, targetList] of desired) {
    if (!name.startsWith("@openbuddy/ui-")) continue;
    const seg = name.replace(/^@openbuddy\//, "");
    const m = seg.match(/^ui-([a-z\-]+)(\/(.*))?$/);
    if (!m) continue;
    const [, pkgName, , subpath] = m;
    if (!byName.has(pkgName)) byName.set(pkgName, { dir: "openbuddy-ui-" + pkgName, name: "@openbuddy/ui-" + pkgName, main: null, client: null, invariant: null, subpaths: {} });
    const entry = byName.get(pkgName);
    const target = targetList[0];
    if (!subpath) entry.main = target;
    else if (subpath === "client") entry.client = target;
    else if (subpath === "invariant") entry.invariant = target;
    else entry.subpaths[subpath] = target;
  }
  const list = Array.from(byName.values()).map((e) => ({ ...e, subpaths: e.subpaths }));
  writeFileSync(aliasListPath, JSON.stringify(list, null, 2) + "\n");
}

// ----------------------------------------------------------------
// 路径自愈:某些历史版本曾产出 .//Users/.../src/src/... 这类重复路径;
// 这里统一正则清洗为标准的 ./packages/... 形式。
// ----------------------------------------------------------------
function repairBadPaths(tsconfigPath) {
  if (!existsSync(tsconfigPath)) return false;
  const raw = readFileSync(tsconfigPath, "utf8");
  // 匹配 ".//Users/.../src/src/..."(绝对路径 + src/src/ 重复)或 ".//Users/..."
  const re = /"\.\/\/[A-Za-z0-9_\-\/]+packages\/ui\/openbuddy-ui-([a-z\-]+)\/src\/(?:src\/)?([a-zA-Z0-9_\-\/\.]+)"/g;
  let changed = false;
  const next = raw.replace(re, (match, pkg, rest) => {
    changed = true;
    // rest 可能含 src/ 前缀(重复)、需要剥离
    const cleanRest = rest.startsWith("src/") ? rest.slice(4) : rest;
    return '"' + "./packages/ui/openbuddy-ui-" + pkg + "/src/" + cleanRest + '"';
  });
  if (changed) writeFileSync(tsconfigPath, next);
  return changed;
}

// ----------------------------------------------------------------
// 路径自愈规则 2:"./src/<file>.<ext>" 缺 packages/ui/<pkg>/ 前缀
// 旧版 sync-ui-aliases 产物的另一种坏路径。修复方式:用 "@openbuddy/ui-<pkg>/<sub>" 
// 这个 key 推断出 pkg 与 file,然后改写为标准的 ./packages/ui/openbuddy-<pkg>/src/<file>。<ext>。
// ----------------------------------------------------------------
function repairShortPathEntries(tsconfigPath) {
  if (!existsSync(tsconfigPath)) return false;
  const raw = readFileSync(tsconfigPath, "utf8");
  const reShort = /"(@openbuddy\/ui-([a-z\-]+)\/(client|invariant|index|template-config|schedule-utils))"\s*:\s*\[\s*"\.\/src\/([a-z\-]+\.tsx?)"\s*\]/g;
  let changed = false;
  const next = raw.replace(reShort, (match, key, pkg, subpath, fileName) => {
    const baseName = fileName.split(".")[0];
    if (baseName !== subpath) return match;
    changed = true;
    const corrected = "./packages/ui/openbuddy-ui-" + pkg + "/src/" + fileName;
    return '"' + key + '": [\n        "' + corrected + '"\n      ]';
  });
  if (changed) writeFileSync(tsconfigPath, next);
  return changed;
}

// ----------------------------------------------------------------
// 源码层 lint:扫描 ui-* 包的 src/ 源码,禁止出现:
//   1. 形如 "../../../../../src/" 这类跨多层指向根 src/ 的相对路径
//   2. 形如 "@/foundation|lib|stores|types|components|hooks|utils|assets/" 
//      的别名引用(因为 ui-* 包的 tsconfig 用 baseUrl="../../..",会把 @/* 解析到根 src/)
// 违反则打印违规列表并退出码非零。
// 这是 "packages 不要依赖 src/" 的硬约束防线。
// ----------------------------------------------------------------
function lintUiPackageSrc(packages) {
  const violations = [];
  const forbiddenSubpaths = [
    "foundation/", "lib/", "stores/", "types/", "components/",
    "hooks/", "utils/", "assets/",
  ];
  // 子包 import 自身 @openbuddy/ui-* 不算违规
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
          // _foundation/ 是 ui-primitives 包内部资产目录,允许存在(它本身就是源)
          stack.push(full);
          continue;
        }
        if (!/\.(ts|tsx|mts|cts)$/.test(ent.name)) continue;
        const text = readFileSync(full, "utf8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // 规则 1:跨多层相对路径回到根 src/
          if (/from\s+['"](\.\.\/){3,}src\//.test(line)) {
            violations.push({ file: full, line: i + 1, text: line.trim(), rule: "deep-relative" });
            continue;
          }
          // 规则 2:别名 @/foundation|lib|stores|types|components|hooks|utils|assets/
          for (const sub of forbiddenSubpaths) {
            // sub 形如 "lib/" 或 "foundation/";构造正则 from\\s+['"]@/lib(?=/|"|'|;)
            const seg = sub.charAt(sub.length - 1) === "/" ? sub.slice(0, -1) : sub;
            const re = new RegExp("from\\s+['\"]@\\/" + seg + "(?=[\\s/'\"\\);,])", "");
            if (re.test(line)) {
              violations.push({ file: full, line: i + 1, text: line.trim(), rule: "alias-to-src:" + sub });
              break;
            }
          }
        }
      }
    }
  }
  return violations;
}

const packages = listUiPackages();
const desired = buildDesiredPaths(packages);

// ── 路径自愈 ────────────────────────────────────────────────────
const rootTsconfigPath = join(repoRoot, "tsconfig.json");
let repairNote = "";
if (repairBadPaths(rootTsconfigPath)) repairNote += " absolute/double-src";
if (repairShortPathEntries(rootTsconfigPath)) repairNote += " missing-package-prefix";
if (repairNote) console.log("[sync-ui-aliases] repaired root tsconfig.json:" + repairNote);

// ── 包级路径自愈:遍历所有 ui-* 包的 tsconfig.json ───────────────
let pkgRepairs = 0;
for (const dir of packages) {
  const p = join(uiDir, dir, "tsconfig.json");
  if (repairShortPathEntries(p)) pkgRepairs++;
}
if (pkgRepairs > 0) console.log("[sync-ui-aliases] repaired " + pkgRepairs + " ui-* tsconfig.json (missing-package-prefix)");

// ── 主同步流程 ──────────────────────────────────────────────────
patchRootTsconfig(desired);
patchPackageTsconfigs(packages);
writeAliasList(packages);

// ── bundle-desktop 组合包:把所有 ui-* alias 注入其 tsconfig ──────
{
  const bundleTsconfigPath = join(repoRoot, "packages/bundle/openbuddy-bundle-desktop/tsconfig.json");
  if (existsSync(bundleTsconfigPath)) {
    const desiredForBundle = [];
    for (const dir of packages) {
      const name = "@openbuddy/" + dir.replace(/^openbuddy-/, "");
      desiredForBundle.push([name, [srcEntry(dir)]]);
      desiredForBundle.push([name + "/client", [srcEntry(dir, "client")]]);
      desiredForBundle.push([name + "/invariant", [srcEntry(dir, "invariant")]]);
      const pkgPath = join(uiDir, dir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          const exports = pkg.exports || {};
          for (const [subpath, target] of Object.entries(exports)) {
            if (!subpath.startsWith(".")) continue;
            let seg = subpath.slice(1);
            if (seg.startsWith("/")) seg = seg.slice(1);
            if (seg === "" || seg === "package.json") continue;
            if (seg === "client" || seg === "invariant") continue;
            if (typeof target !== "string") continue;
            desiredForBundle.push([name + "/" + seg, [resolveExportPath(dir, target)]]);
          }
        } catch {}
      }
    }
    for (const [k, v] of Object.entries(workspacePackageAliases)) {
      desiredForBundle.push([k, ["./" + v]]);
    }
    const inserted = patchTsconfigPaths(bundleTsconfigPath, desiredForBundle.sort(([a],[b]) => a.localeCompare(b)), ".");
    if (inserted) {
      console.log("[sync-ui-aliases] bundle-desktop: +" + inserted + " entries");
    } else {
      console.log("[sync-ui-aliases] bundle-desktop already up to date.");
    }
  }
}
const violations = lintUiPackageSrc(packages);
const hardViolations = violations.filter((v) => v.rule === "deep-relative");
const softViolations = violations.filter((v) => v.rule.startsWith("alias-to-src:"));

if (softViolations.length > 0) {
  console.log("[sync-ui-aliases] ⚠️  共享代码引用报告(非阻塞):" + softViolations.length + " 处 ui-* 包通过 @/ 别名引用 root src/ 的 lib/stores/assets/。");
  console.log("    详见 packages/ui/MODULARIZATION_ANALYSIS.md §L3 路线 — 当前为前向共享,需逐步拆分。");
  // 按文件汇总,不打印每行,避免噪声
  const byFile = new Map();
  for (const v of softViolations) {
    const rel = v.file.replace(repoRoot + "/", "");
    byFile.set(rel, (byFile.get(rel) || 0) + 1);
  }
  for (const [f, n] of [...byFile.entries()].sort()) {
    console.log("      " + n + "× " + f);
  }
}

if (hardViolations.length > 0) {
  console.error("\n[sync-ui-aliases] ❌ 硬门禁失败:发现循环依赖式 src/ 耦合:");
  for (const v of hardViolations) {
    const rel = v.file.replace(repoRoot + "/", "");
    console.error("  " + rel + ":" + v.line + "  [" + v.rule + "]  " + v.text);
  }
  console.error("[sync-ui-aliases] 共 " + hardViolations.length + " 处硬违规。\n" +
    "  硬门禁约束:packages/ui/* 不允许跨多层相对路径回到 root src/。\n" +
    "  这是真循环依赖,必须立刻修。");
  process.exit(1);
}

console.log("[sync-ui-aliases] " + packages.length + " ui-* package(s) registered.");
for (const p of packages) console.log("  - " + packageName(p));
