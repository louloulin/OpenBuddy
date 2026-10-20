#!/usr/bin/env node
//====================================================================
// scripts/check-hardcoded-colors.mjs — 硬编码色值棘轮门禁
//
// 为什么需要它
//   深色主题会重新定义 `--wb-brand-primary`(tokens.css 里浅色指向
//   palette-brand-8 = #00C29A,深色指向 palette-brand-7 = 另一档亮度)。
//   所以 **CSS 变量是可切换主题的,字面量不是**。任何直接写
//   `color: #00c29a` 的地方,在深色下仍然显示浅色主题的品牌绿 —— 这类
//   缺陷不改变任何类型,现有测试也不会红,所以要有独立门禁。
//
// 判定规则:一个十六进制色值算"违规",当且仅当
//   1. 它不是 `var(--token, #hex)` 这种**有意保留的兜底值**
//      (变量未定义时的 fallback,这是仓库既有约定,不算违规);
//   2. 它所在文件不在下面的排除清单里。
//
// 排除清单(每条都有理由,不是"懒得改就排除")
//   src/styles/tokens.css                                  变量定义本身
//   packages/ui/openbuddy-ui-theme/src/themes.ts           主题真源
//   packages/ui/openbuddy-ui-settings/src/HomePage.tsx     首页示意图 SVG
//                                                            插画是内容,不是主题表面
//   packages/ui/openbuddy-ui-experts/src/data/*.ts         技能/连接器目录的
//                                                            品牌色是**数据**
//
// 关于棘轮
//   仓库当前有 ~700 处这样的字面量,一次性替换会牵动大量视觉回归,而门禁
//   无法替代肉眼比对。所以这里只做棘轮:基线记录当前数量,新增即失败,
//   存量靠逐步替换偿还。`--update-baseline` 只能往低压。
//
// 用法
//   node scripts/check-hardcoded-colors.mjs
//   node scripts/check-hardcoded-colors.mjs --update-baseline
//====================================================================
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const BASELINE_PATH = "scripts/colors/baseline.json";

const EXCLUDED = new Set([
  // 变量定义 / 主题真源 —— 这些地方必须写字面量。
  "src/styles/tokens.css",
  "packages/ui/openbuddy-ui-theme/src/themes.ts",
]);
/** 前缀排除:整类"颜色即数据"的资产文件。 */
const EXCLUDED_PREFIXES = [
  // 首页空状态插画:内联 SVG 的 fill 是插画内容,不随主题变化。
  "packages/ui/openbuddy-ui-settings/src/HomePage.tsx",
  // 技能 / 连接器 / 场景目录:每项的品牌色是数据字段。
  "packages/ui/openbuddy-ui-experts/src/data/",
];

const SKIP_DIRS = new Set([
  "node_modules", "dist", ".moon", ".git", "_archive", ".worktrees", "coverage", "release",
]);
const SCAN_ROOTS = ["src", "packages"];
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function excluded(rel) {
  return EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p));
}

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
    else if (/\.(css|ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) acc.push(path);
  }
  return acc;
}

/** 前面紧邻 `var(--token,` 的 hex 是有意保留的 fallback。 */
function isFallback(src, index) {
  return /var\(--[\w-]+\s*,\s*$/.test(src.slice(Math.max(0, index - 40), index));
}

const violations = new Map(); // rel -> [{ line, color }]
const colorCounts = new Map();
for (const abs of SCAN_ROOTS.flatMap((r) => walk(join(repoRoot, r)))) {
  const rel = relative(repoRoot, abs);
  if (excluded(rel)) continue;
  const src = readFileSync(abs, "utf8");
  const hits = [];
  for (const m of src.matchAll(HEX)) {
    if (isFallback(src, m.index)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    hits.push({ line, color: m[0].toLowerCase() });
    colorCounts.set(m[0].toLowerCase(), (colorCounts.get(m[0].toLowerCase()) || 0) + 1);
  }
  if (hits.length) violations.set(rel, hits);
}

const total = [...violations.values()].reduce((a, h) => a + h.length, 0);
const errors = [];
const updateBaseline = process.argv.includes("--update-baseline");
const baselineFile = join(repoRoot, BASELINE_PATH);
let baseline = { total: 0, files: {} };
if (existsSync(baselineFile)) {
  baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
} else if (!updateBaseline) {
  errors.push(`基线文件缺失:${BASELINE_PATH}(用 --update-baseline 生成)`);
}

if (updateBaseline) {
  const prevTotal = baseline.total ?? 0;
  if (total > prevTotal) {
    // 允许上浮 —— 别人可能刚删了文件又加了别的 —— 但必须显式,不能静默。
    console.error(
      `注意:基线从 ${prevTotal} 上浮到 ${total}。` +
      `这等于放弃 ${total - prevTotal} 处新债,确认是有意为之再提交。`,
    );
  }
  mkdirSync(dirname(baselineFile), { recursive: true });
  writeFileSync(
    baselineFile,
    `${JSON.stringify(
      {
        _comment:
          "棘轮基线,由 `node scripts/check-hardcoded-colors.mjs --update-baseline` 生成。" +
          "硬编码色值只能减少:新增即失败。上浮基线等于放弃这笔债,请单独评审。",
        total,
        files: Object.fromEntries(
          [...violations]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([f, hits]) => [f, hits.length]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`基线已更新:${total} 处 / ${violations.size} 个文件`);
} else {
  const allowed = baseline.total ?? 0;
  if (total > allowed) {
    const perFile = baseline.files ?? {};
    const grew = [];
    for (const [file, hits] of violations) {
      const before = perFile[file] ?? 0;
      if (hits.length > before) {
        grew.push(`  ${file}: ${before} → ${hits.length}`);
        for (const h of hits.slice(before)) grew.push(`      L${h.line} ${h.color}`);
      }
    }
    errors.push(
      `[hardcoded-color] 新增 ${total - allowed} 处不可主题化的字面色值。\n` +
      `深色主题会重定义 token,字面量不会跟着变 —— 请改用 var(--wb-*)。\n` +
      `若这处颜色确实是数据(插画/目录),请把文件加进脚本顶部的 EXCLUDED 并写明理由。\n` +
      grew.slice(0, 40).join("\n"),
    );
  } else if (total < allowed) {
    console.warn(
      `硬编码色值降到 ${total}(基线 ${allowed})—— ` +
      `跑 \`node scripts/check-hardcoded-colors.mjs --update-baseline\` 收紧棘轮。`,
    );
  }
}

for (const e of errors) console.error(`ERROR ${e}`);
if (errors.length > 0) {
  console.error(`\n硬编码色值门禁失败:${errors.length} 个错误。`);
  process.exit(1);
}
console.log(
  `硬编码色值门禁通过:${total} 处 / ${violations.size} 个文件 / ${colorCounts.size} 种颜色` +
  `(基线 ${baseline.total ?? total})。`,
);
