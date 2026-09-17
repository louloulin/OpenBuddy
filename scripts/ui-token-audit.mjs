#!/usr/bin/env node
/**
 * scripts/ui-token-audit.mjs —— `--wb-*` 设计令牌的「定义 vs 使用」审计。
 *
 * 为什么需要它
 * ------------
 * OpenBuddy 的视觉层有两套并存的令牌来源,第二套是历史遗留:
 *
 *   1. `src/styles/tokens.css`          —— 从 WorkBuddy 移植的语义令牌
 *      (326 个 `--wb-*`),经 `globals.css` 在 app 入口加载。
 *   2. `packages/ui/openbuddy-ui-theme/src/styles/index.css` —— OKLCh 基线
 *      (25 个),由 `src/main.tsx` 先 import。
 *
 * 两套**都**定义 `--wb-bg-primary` / `--wb-bg-secondary` / `--wb-accent` 等,
 * 且 ui-theme 的 store 还在运行时往 `:root` 写 inline 变量。于是出现三种失效
 * 形态,没有编译器能发现:
 *
 *   A. **用了但从未定义** —— `color: var(--wb-text-primary)` 里变量为空,
 *      该声明被浏览器丢弃,元素回退到继承色。在深色主题上表现为「字看不见」。
 *   B. **定义了但从未使用** —— 死令牌,文档会说"有这个变量"但没人消费。
 *   C. **两套都定义** —— 谁赢取决于加载顺序 + `!important`。`tokens.css` 里
 *      确实有一处 `!important`(默认暗色主题的兜底,注释解释过原因),但
 *      任何**新增**的双定义都可能无声地压掉主题色。
 *
 * 用法:
 *   node scripts/ui-token-audit.mjs           # 人类可读
 *   node scripts/ui-token-audit.mjs --json    # JSON
 *   node scripts/ui-token-audit.mjs --check   # 有「用了但未定义且无 fallback」时退出 1
 *
 * `--check` 只把 A 类当失败:那会让声明被静默丢弃,是**可见的视觉错误**。
 * B / C 类是技术债快照,不阻断(死令牌可以留着,双定义有些是刻意的)。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(["node_modules", "out", "dist", ".turbo", ".git", "coverage"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 只扫**会被 app 加载**的样式:`src/styles/**` 与 `packages/ui/**`。
 *  `apps/admin-portal` 是独立站点,自己的令牌表,混进来会产生假阳性。 */
const STYLE_ROOTS = [
  join(root, "src", "styles"),
  join(root, "packages", "ui"),
  join(root, "packages", "renderer"),
];
const STYLE_FILES = STYLE_ROOTS.flatMap((dir) => walk(dir)).filter((f) => f.endsWith(".css"));

const TSCONFIG_PATHS = [
  join(root, "tsconfig.json"),
];
const EXTRA_TOKEN_SOURCES = [
  // 运行时写入的令牌(theme store / inline style)也算"已定义",否则会误报。
  ...walk(join(root, "packages", "ui", "openbuddy-ui-theme", "src")).filter((f) => /\.tsx?$/.test(f)),
  ...walk(join(root, "src", "lib")).filter((f) => /\.tsx?$/.test(f)),
  ...walk(join(root, "src", "stores")).filter((f) => /\.tsx?$/.test(f)),
];

const rel = (file) => relative(root, file).split(sep).join("/");

/** 定义处:`.foo {` 块顶层的 `--wb-x:`。同时接受 CSS 与 TS 里的
 *  `setProperty("--wb-x", …)` / 对象字面量 `"--wb-x": …`。 */
const defined = new Map(); // token -> Set<file>
const used = new Map(); // token -> Array<{file, line, hasFallback, raw}>

/**
 * 把 CSS 注释剥成等长空白(保留行号与列偏移)。
 *
 * 为什么必须剥:注释里会**描述**变量用法,例如 base.css 的
 * `Token-based durations (var(--wb-motion-duration-*)) are already zeroed`。
 * 不剥的话审计会把它当成一次真实引用并报"未定义"—— 一个由文档措辞触发的
 * 假阳性。等长替换是关键:直接删注释会让后续所有行号错位,证据里的
 * `file:line` 就指不准了。
 */
function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

function note(map, key, file) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(rel(file));
}

for (const file of STYLE_FILES) {
  const source = stripCssComments(readFileSync(file, "utf8"));
  const lines = source.split("\n");

  for (const match of source.matchAll(/(^|[\s;{])(--wb-[a-z0-9-]+)\s*:/gm)) note(defined, match[2], file);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const match of line.matchAll(/var\(\s*(--wb-[a-z0-9-]+)\s*(,)?/g)) {
      const token = match[1];
      if (!used.has(token)) used.set(token, []);
      used.get(token).push({ file: rel(file), line: i + 1, hasFallback: Boolean(match[2]), raw: line.trim().slice(0, 120) });
    }
  }
}

for (const file of EXTRA_TOKEN_SOURCES) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const match of source.matchAll(/["'`](--wb-[a-z0-9-]+)["'`]\s*[,:)]/g)) note(defined, match[1], file);
  for (const match of source.matchAll(/setProperty\(\s*["'`](--wb-[a-z0-9-]+)["'`]/g)) note(defined, match[1], file);
}

// tsconfig 里也可能通过 `paths` 指向别的 CSS 入口 —— 只用来提示,不参与判定。
void TSCONFIG_PATHS;

const usedTokens = [...used.keys()].sort();
const definedTokens = [...defined.keys()].sort();

/** A 类:使用了、从未定义、且**没有 fallback** —— 声明会被静默丢弃。 */
const broken = usedTokens
  .filter((token) => !defined.has(token))
  .map((token) => ({
    token,
    sites: used.get(token).filter((site) => !site.hasFallback),
    fallbackOnly: used.get(token).every((site) => site.hasFallback),
  }))
  .filter((entry) => entry.sites.length > 0)
  .sort((a, b) => b.sites.length - a.sites.length);

/** A' 类:未定义但有 fallback —— 不会坏,只是永远走 fallback(等于常量)。 */
const fallbackOnly = usedTokens
  .filter((token) => !defined.has(token))
  .filter((token) => used.get(token).every((site) => site.hasFallback))
  .sort();

/** B 类:定义了但没人用 —— 死令牌。 */
const dead = definedTokens.filter((token) => !used.has(token));

/** C 类:被多个文件定义 —— 谁赢取决于加载顺序。 */
const multiplyDefined = definedTokens
  .map((token) => ({ token, files: [...defined.get(token)].sort() }))
  .filter((entry) => entry.files.length > 1)
  .sort((a, b) => b.files.length - a.files.length);

/** 定义了全部 `--wb-*` 的"权威"文件(定义数最多者)。 */
const byFile = new Map();
for (const [token, files] of defined) for (const file of files) byFile.set(file, (byFile.get(file) ?? 0) + 1);
const topDefiners = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

const report = {
  totals: {
    styleFiles: STYLE_FILES.length,
    definedTokens: definedTokens.length,
    usedTokens: usedTokens.length,
    /** 定义 + 使用都有的"活令牌"。 */
    live: definedTokens.filter((t) => used.has(t)).length,
  },
  /** ⚠ 失败项:声明会被浏览器丢弃。 */
  broken,
  /** 未定义但调用处都带 fallback —— 不坏,但比真正的令牌弱。 */
  fallbackOnly,
  /** 定义了但没人用。 */
  dead,
  /** 被多个文件定义。 */
  multiplyDefined,
  topDefiners,
  evidence: {
    broken: Object.fromEntries(broken.map((e) => [e.token, e.sites])),
    dead: dead.map((token) => ({ token, files: [...defined.get(token)] })),
    multiplyDefined: Object.fromEntries(multiplyDefined.map((e) => [e.token, e.files])),
  },
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const t = report.totals;
  console.log("`--wb-*` 令牌审计(定义 vs 使用)\n");
  console.log(`  样式文件        ${t.styleFiles}`);
  console.log(`  已定义令牌      ${t.definedTokens}`);
  console.log(`  被使用令牌      ${t.usedTokens}`);
  console.log(`  活的(两者都有) ${t.live}`);
  console.log();
  console.log(`⚠ 用了但未定义且无 fallback  (${broken.length})  —— 声明会被静默丢弃`);
  if (broken.length === 0) console.log("  — 无");
  else for (const e of broken) {
    console.log(`  ${e.token}  (${e.sites.length} 处)`);
    for (const site of e.sites) console.log(`      ${site.file}:${site.line}  ${site.raw}`);
  }
  console.log();
  console.log(`未定义但有 fallback  (${fallbackOnly.length})`);
  console.log(fallbackOnly.length ? `  ${fallbackOnly.join(", ")}` : "  — 无");
  console.log();
  console.log(`定义了但没人用(死令牌)  (${dead.length})`);
  console.log(dead.length ? `  ${dead.slice(0, 40).join(", ")}${dead.length > 40 ? ` … 等 ${dead.length} 个` : ""}` : "  — 无");
  console.log();
  console.log(`被多个文件定义  (${multiplyDefined.length}) —— 谁赢取决于加载顺序`);
  for (const e of multiplyDefined.slice(0, 12)) console.log(`  ${e.token}  ← ${e.files.join("  |  ")}`);
  console.log();
  console.log("定义令牌最多的文件:");
  for (const [file, count] of topDefiners) console.log(`  ${String(count).padStart(4)}  ${file}`);
}

if (process.argv.includes("--check") && broken.length > 0) {
  const sites = broken.reduce((sum, e) => sum + e.sites.length, 0);
  console.error(`\n✗ ${broken.length} 个令牌被使用但从未定义(${sites} 处声明会被浏览器丢弃)。`);
  process.exit(1);
}
