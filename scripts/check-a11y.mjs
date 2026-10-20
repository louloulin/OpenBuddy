#!/usr/bin/env node
//====================================================================
// scripts/check-a11y.mjs — 无障碍门禁
//
// 为什么需要它(而不是"在 eslint.config.mjs 里把规则打开"就够了)
//
//   1. eslint 插件装了、规则也注册了,但此前**只开了 media-has-caption 一条**。
//      文件里 12+ 条 `eslint-disable jsx-a11y/*` 注释指向的规则根本没启用 ——
//      disable 一条不存在的规则不会报错,于是它只是安静地掩盖了一个空壳。
//      打开 recommended 后立刻暴露 210 处真实缺陷,其中绝大多数是
//      `<span role="button" onClick>` / `<div onClick>` 这类**键盘不可达**的
//      假按钮:鼠标能点,Tab 键永远到不了,读屏软件也不会播报它可激活。
//      这是实打实的 WCAG 失败,不是 lint 洁癖。
//   2. 就算规则全开,CI 的 `lint-tools` job 是 `continue-on-error: true`
//      (它同时跑 Sheriff 和 Prettier,整体是 report-only 的)。也就是说
//      **eslint 红了也拦不住任何 PR**。所以需要这个独立、阻塞、只做一件事的门禁。
//
// 判定规则
//   对 src/ 与 packages/ 下的 .tsx 跑 eslint,只取 jsx-a11y/* 的结果。
//   只要有一条 error 就失败,并按 规则 → 文件 聚合输出。
//
//   注意这个门禁**没有棘轮基线**。i18n(2046 处)和硬编码色(666 处)是还不起
//   的大债,只能棘轮;无障碍的 210 处已经全部修完,所以按零容忍处理 ——
//   新增一条就是回归。
//
//   唯一关闭的规则是 no-autofocus,理由记在 eslint.config.mjs 里:那 15 处
//   全部挂在条件渲染的抽屉/对话框上,是用户自己刚点出来的,焦点落在那里是
//   期望行为;该规则针对的是页面加载时抢焦点。
//
// 用法
//   node scripts/check-a11y.mjs
//====================================================================
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");

/**
 * 用仓库本地的 eslint,不用 `npx eslint`。
 * npx 在本地没装或版本不匹配时会去下载/回退到别的版本 —— 实测在临时目录里
 * 跑就拉到了 ESLint 10,而 package.json 钉的是 9.39.5。门禁必须是可复现的:
 * 它报的"零告警"必须来自 CI 装的那一份 eslint,而不是当时恰好能拿到的最新版。
 * OPENBUDDY_A11Y_ESLINT 是给测试用的注入口(测试的 fixture 在临时目录里,
 * 那里没有 node_modules)。
 */
const eslintBin =
  process.env.OPENBUDDY_A11Y_ESLINT ?? join(repoRoot, "node_modules", ".bin", "eslint");

if (!existsSync(eslintBin)) {
  console.error(`找不到本地 eslint:${eslintBin}\n先跑 \`pnpm install\`。`);
  process.exit(1);
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const targets = files.length ? files : ["src", "packages"];

// eslint 遇到不存在的 pattern 会直接退出码 2。只扫真实存在的路径,否则一个人
// 删掉某个顶层目录就会让整个门禁变成"无文件可扫"然后假绿。
// 传进来的既可能是目录(默认的 src/packages)也可能是具体文件(手动排查时),
// 两种都要按存在性过滤。
const existing = targets.filter((t) => existsSync(join(repoRoot, t)));
if (existing.length === 0) {
  console.error(
    `指定的路径一个都不存在:${targets.join("、")} —— 门禁拒绝空跑。\n` +
      `（若这是 CI,请检查工作目录与上面的路径是否被重命名/移动。）`,
  );
  process.exit(1);
}

const eslint = spawnSync(eslintBin, [...existing, "--no-warn-ignored", "-f", "json"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (eslint.error) {
  console.error(`无法启动 eslint:${eslint.error.message}`);
  process.exit(1);
}

// eslint 用退出码 1 表示"有 lint 错误",这在我们要的场景里是预期的,
// 不是脚本失败。退出码 2 才是脚本/配置本身出了问题(例如 flat config 语法
// 错误、或者下面的目标目录不存在)—— 那种情况必须硬失败,否则门禁会因为
// "没扫到任何文件"而变成永远为真的装饰。
if (eslint.status === 2) {
  console.error("eslint 自身执行失败(退出码 2),门禁无法判断,按失败处理:");
  console.error((eslint.stderr || eslint.stdout).slice(0, 2000));
  process.exit(1);
}

let report;
try {
  report = JSON.parse(eslint.stdout);
} catch {
  console.error("无法解析 eslint 的 JSON 输出:");
  console.error(eslint.stdout.slice(0, 2000) || eslint.stderr.slice(0, 2000));
  process.exit(1);
}

const byRule = new Map();
for (const file of report) {
  for (const msg of file.messages) {
    if (!msg.ruleId?.startsWith("jsx-a11y/")) continue;
    const rule = msg.ruleId;
    if (!byRule.has(rule)) byRule.set(rule, []);
    // eslint 报的是绝对路径;CI 日志里只关心仓库内相对位置。
    byRule.get(rule).push({
      path: relative(repoRoot, file.filePath),
      line: msg.line,
      column: msg.column,
    });
  }
}

const total = [...byRule.values()].reduce((a, list) => a + list.length, 0);

if (total === 0) {
  console.log("无障碍门禁通过:jsx-a11y 零告警。");
  process.exit(0);
}

console.error(`[a11y] ${total} 处 jsx-a11y 告警,分布在 ${byRule.size} 条规则:\n`);
for (const [rule, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  console.error(`  ${list.length} 处  ${rule}`);
  for (const hit of list.slice(0, 10)) {
    console.error(`      ${hit.path}:${hit.line}:${hit.column}`);
  }
  if (list.length > 10) console.error(`      ... 另有 ${list.length - 10} 处`);
}
console.error(
  "\n请修真正的缺陷,不要加 eslint-disable-next-line jsx-a11y/*。\n" +
    "本仓库曾有 12+ 条这样的注释指向当时根本没启用的规则 —— 那不是修复,是掩盖。\n" +
    "如果某条确实是误报,把理由写进 eslint.config.mjs 并在那里关闭该规则。",
);
process.exit(1);