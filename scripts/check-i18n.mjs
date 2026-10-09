#!/usr/bin/env node
//====================================================================
// scripts/check-i18n.mjs — i18n 词表一致性与未国际化文案扫描
//
// 背景(为什么需要它)
//   运行时已经统一:`src/lib/platform/i18n.ts` 把产品词表 merge 进
//   `@openbuddy/ui-locale` 的单一 service,插件与 React 树看到同一份语言状态。
//   但词表本身长期失修 —— 2026-09-06 全仓审查记录"i18n 名存实亡",至今仍成立:
//     * 词表里 110 个 key 有 81 个从未被任何 t()/useT() 读取(UI 直接写死中文);
//     * 两套词表(src/locales 与内核 dictionaries)有 12 个重复 key,其中 2 个
//       取值不一致,同一句话在不同渲染路径下会显示不同文案;
//     * `skill.bar.title` 被引用但两套词表都没有 —— t() 缺 key 时返回 key 本身,
//       所以用户会直接在界面上看到 "skill.bar.title"。
//   这些都不会让任何现有测试变红,所以需要一个独立的门禁。
//
// 检查项
//   [错误] 1. 同套词表内,所有 locale 的 key 集合必须一致(缺一个语言 = 漏翻)
//   [错误] 2. 同一 key 在不同 locale 之间的 {占位符} 集合必须一致
//   [错误] 3. 跨词表重复 key(产品 src/locales 与内核 dictionaries)的取值必须相同
//   [错误] 4. 非中文 locale 的取值里不得残留 CJK(未翻译)
//   [错误] 5. 代码里 t()/useT() 字面量引用的 key 必须存在于某套词表
//   [错误] 6. 硬编码 CJK 文案不得超过基线(scripts/i18n/baseline.json)
//
// 关于基线(第 6 项)
//   仓库当前有 ~1292 处硬编码中文,分布在 157 个文件里 —— 一次性迁移不现实,
//   直接开红会阻塞所有人。所以这里是**棘轮**:基线记录当前数量,新增即失败,
//   存量通过减少基线逐步偿还。`--update-baseline` 用于主动下调。
//
// 用法
//   node scripts/check-i18n.mjs                 # 门禁(默认)
//   node scripts/check-i18n.mjs --update-baseline
//====================================================================
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");

const PRODUCT_LOCALES = ["zh-CN", "en-US"];
const KERNEL_DICT_DIR = "packages/ui/openbuddy-ui-locale/src/dictionaries";
const BASELINE_PATH = "scripts/i18n/baseline.json";

/** 每套词表:名字 + 每个 locale 的文件路径。 */
const DICTIONARIES = [
  {
    name: "product",
    files: Object.fromEntries(PRODUCT_LOCALES.map((l) => [l, `src/locales/${l}.json`])),
  },
  {
    name: "kernel",
    files: Object.fromEntries(
      PRODUCT_LOCALES.map((l) => [l, `${KERNEL_DICT_DIR}/${l}.json`]),
    ),
  },
];

const SKIP_DIRS = new Set([
  "node_modules", "dist", ".moon", ".git", "_archive", ".worktrees", "coverage", "release",
]);
const SCAN_ROOTS = ["src", "packages", "electron"];
const CJK = /[㐀-䶿一-鿿豈-﫿]/;
const PLACEHOLDER = /\{(\w+)\}/g;

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ─── 词表加载 ────────────────────────────────────────────────────────

/** 把嵌套 JSON 摊平成 `"a.b.c" -> "value"`,顺带抓非字符串叶子。 */
function flatten(node, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else if (typeof v === "string") out[key] = v;
    else fail(`${key}: 词表叶子必须是字符串,收到 ${typeof v}`);
  }
  return out;
}

function loadDict(path) {
  if (!existsSync(join(repoRoot, path))) {
    fail(`词表文件缺失:${path}`);
    return {};
  }
  try {
    return flatten(JSON.parse(readFileSync(join(repoRoot, path), "utf8")));
  } catch (err) {
    fail(`词表不是合法 JSON:${path} — ${err.message}`);
    return {};
  }
}

const loaded = DICTIONARIES.map((d) => ({
  name: d.name,
  byLocale: Object.fromEntries(
    Object.entries(d.files).map(([locale, path]) => [locale, loadDict(path)]),
  ),
}));

// ─── 1/2. 同套词表内的 key 与占位符一致性 ────────────────────────────

for (const dict of loaded) {
  const [ref, ...rest] = Object.keys(dict.byLocale);
  for (const locale of rest) {
    const a = dict.byLocale[ref];
    const b = dict.byLocale[locale];
    for (const key of Object.keys(a)) {
      if (!(key in b)) fail(`[${dict.name}] ${locale} 缺少 key "${key}"(${ref} 里有)`);
    }
    for (const key of Object.keys(b)) {
      if (!(key in a)) fail(`[${dict.name}] ${ref} 缺少 key "${key}"(${locale} 里有)`);
    }
    for (const key of Object.keys(a)) {
      if (!(key in b)) continue;
      const pa = [...a[key].matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(",");
      const pb = [...b[key].matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(",");
      if (pa !== pb) {
        fail(`[${dict.name}] "${key}" 占位符不一致:${ref}={${pa}} vs ${locale}={${pb}}`);
      }
    }
  }
}

// ─── 3. 跨词表重复 key 取值必须一致 ─────────────────────────────────

for (const locale of Object.keys(loaded[0].byLocale)) {
  const product = loaded[0].byLocale[locale] ?? {};
  const kernel = loaded[1].byLocale[locale] ?? {};
  for (const key of Object.keys(kernel)) {
    if (!(key in product)) continue;
    if (product[key] !== kernel[key]) {
      fail(
        `[duplicate] "${key}" 在 ${locale} 下两套词表取值不一致:` +
        `product=${JSON.stringify(product[key])} kernel=${JSON.stringify(kernel[key])}`,
      );
    }
  }
}

// ─── 4. 非中文 locale 不得残留 CJK ──────────────────────────────────

for (const dict of loaded) {
  for (const [locale, entries] of Object.entries(dict.byLocale)) {
    if (locale.startsWith("zh")) continue;
    for (const [key, value] of Object.entries(entries)) {
      if (CJK.test(value)) fail(`[untranslated] [${dict.name}] ${locale} "${key}" 仍是中文:${value}`);
    }
  }
}

// ─── 代码扫描 ────────────────────────────────────────────────────────

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) acc.push(path);
  }
  return acc;
}

const sourceFiles = SCAN_ROOTS.flatMap((r) => walk(join(repoRoot, r)));

const knownKeys = new Set();
for (const dict of loaded) {
  for (const entries of Object.values(dict.byLocale)) {
    for (const key of Object.keys(entries)) knownKeys.add(key);
  }
}

// ─── 5. 引用的 key 必须存在 ─────────────────────────────────────────

const referenced = new Set();
for (const abs of sourceFiles) {
  const src = readFileSync(abs, "utf8");
  const rel = relative(repoRoot, abs);
  for (const m of src.matchAll(/\b(?:t|useT|translate|tIn)\(\s*"([a-zA-Z0-9_.-]+)"/g)) {
    referenced.add(m[1]);
    if (!knownKeys.has(m[1])) {
      fail(`[missing-key] ${rel} 引用了 "${m[1]}",但任何词表里都没有这个 key(t() 会把 key 原文渲染到界面上)`);
    }
  }
}

// ─── 6. 硬编码 CJK 文案(棘轮基线) ──────────────────────────────────

// 只取 JSX 文本节点与常见展示属性 —— 注释、console、错误信息里的中文
// 是开发语言,不算未国际化文案。
const HARDCODE_PATTERNS = [
  />([^<>{}\n]*[一-鿿][^<>{}\n]*)</g,          // JSX 文本节点
  /\b(?:title|label|placeholder|aria-label|alt|description|heading)\s*=\s*"([^"]*[一-鿿][^"]*)"/g,
];

const hardcoded = new Map(); // relpath -> count
for (const abs of sourceFiles) {
  const src = readFileSync(abs, "utf8");
  let count = 0;
  for (const re of HARDCODE_PATTERNS) {
    for (const _ of src.matchAll(re)) count += 1;
  }
  if (count > 0) hardcoded.set(relative(repoRoot, abs), count);
}
const hardcodedTotal = [...hardcoded.values()].reduce((a, b) => a + b, 0);

// 未被引用的词表 key —— 是线索不是错误:词表允许先于使用存在。
const unusedKeys = [...knownKeys].filter((k) => !referenced.has(k)).sort();
if (unusedKeys.length > 0) {
  warn(
    `词表里有 ${unusedKeys.length} 个 key 没有被任何 t()/useT() 字面量引用` +
    `(UI 可能仍在写死中文):${unusedKeys.slice(0, 8).join(", ")}${unusedKeys.length > 8 ? " …" : ""}`,
  );
}

// ─── 基线棘轮 ────────────────────────────────────────────────────────

const updateBaseline = process.argv.includes("--update-baseline");
const baselineFile = join(repoRoot, BASELINE_PATH);
let baseline = { hardcodedTotal: 0, files: {} };
if (existsSync(baselineFile)) {
  baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
} else if (!updateBaseline) {
  fail(`基线文件缺失:${BASELINE_PATH}(用 --update-baseline 生成)`);
}

if (updateBaseline) {
  const next = {
    _comment:
      "棘轮基线,由 `node scripts/check-i18n.mjs --update-baseline` 生成。" +
      "硬编码文案只能减少:新增即失败。刻意调高基线等于放弃这笔债,请单独评审。",
    hardcodedTotal,
    files: Object.fromEntries([...hardcoded].sort(([a], [b]) => a.localeCompare(b))),
  };
  mkdirSync(dirname(baselineFile), { recursive: true });
  writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`基线已更新:${hardcodedTotal} 处 / ${hardcoded.size} 个文件`);
} else {
  const allowed = baseline.hardcodedTotal ?? 0;
  if (hardcodedTotal > allowed) {
    const perFile = baseline.files ?? {};
    const grew = [];
    for (const [file, count] of hardcoded) {
      if (count > (perFile[file] ?? 0)) grew.push(`  ${file}: ${perFile[file] ?? 0} → ${count}`);
    }
    fail(
      `[hardcoded-cjk] 硬编码中文 ${hardcodedTotal} 处,超过基线 ${allowed}。\n` +
      `新增的部分要改成 t("key") + 词表条目;若确实要保留,先想清楚为什么。\n` +
      (grew.length ? `增长的文件:\n${grew.slice(0, 20).join("\n")}` : ""),
    );
  } else if (hardcodedTotal < allowed) {
    warn(
      `硬编码中文降到 ${hardcodedTotal}(基线 ${allowed})—— ` +
      `跑 \`node scripts/check-i18n.mjs --update-baseline\` 收紧棘轮。`,
    );
  }
}

// ─── 汇总 ────────────────────────────────────────────────────────────

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

if (errors.length > 0) {
  console.error(`\ni18n 门禁失败:${errors.length} 个错误,${warnings.length} 个警告。`);
  process.exit(1);
}
console.log(
  `i18n 门禁通过:${knownKeys.size} 个 key / ${PRODUCT_LOCALES.length} 个 locale / ` +
  `${sourceFiles.length} 个源文件,硬编码中文 ${hardcodedTotal} 处(基线 ${baseline.hardcodedTotal ?? hardcodedTotal})。`,
);
