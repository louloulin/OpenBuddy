#!/usr/bin/env node
//====================================================================
// scripts/check-ipc-stubs.mjs — IPC 桩门禁
//
// 为什么需要它
//
//   这个仓库反复出现同一类缺陷,而且每次都是靠人工审计才发现的:
//     "UI 在调用一个通道,而那个通道的实现是 `async () => null`。"
//   最近的三个实例:
//     • 邮件「采纳行动项为任务」→ `tasks:add` 是空桩,UI 把 null 当成功、
//       自己造一个 `email-task-<ts>` id,然后弹「已将 N 个行动项加入任务」。
//     • 统一搜索的「任务」作用域 → `tasks:list` 是空桩,结果恒为空。
//     • 计划模式开关 → `togglePlanMode()` 是空实现,按钮照样弹「已进入计划模式」。
//   三者都不是崩溃,而是**假成功**:用户以为做了,其实什么都没发生。这比缺功能
//   更伤,因为用户会在错误的前提下继续操作。
//
//   为什么现有的守护拦不住:`channel-allowlist-parity.test.ts` 只校验
//   main ↔ preload 的**通道集合**一致,不校验实现在做什么。于是"注册一个返回
//   null 的桩"是最省事的过闸方式 —— 守护在生产里制造了死接口。
//
// 判定规则(三类)
//
//   1. UI 引用 + 空桩            → 失败。这是本门禁存在的理由(假成功)。
//   2. UI 引用 + 显式"已移除"抛出 → 必须登记在 scripts/ipc-stub-baseline.json,
//                                  且要写清原因。没登记=失败;登记了但代码里已经
//                                  没有该通道=失败(防止基线腐烂成永久豁免)。
//   3. 无 UI 引用的空桩           → 只报告,不失败(死面,清理是另一件事)。
//
//   分类依据是**实现体本身**:在同一文件里从注册处截取到下一个注册之前的文本,
//   含 `throw new Error(` → 显式移除;含 `return null`/`return undefined` 且既无
//   `await` 也无 `throw` → 空桩;其余 → 真实实现。
//
// 用法
//   node scripts/check-ipc-stubs.mjs            # 门禁
//   node scripts/check-ipc-stubs.mjs --list     # 顺带列出所有空桩(含无引用者)
//   OPENBUDDY_IPC_GATE_ROOT=<dir> node ...      # 测试用:指向 fixture 树
//====================================================================
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = process.env.OPENBUDDY_IPC_GATE_ROOT
  ? resolve(process.env.OPENBUDDY_IPC_GATE_ROOT)
  : resolve(scriptDir, "..");

const MAIN_DIR = join(repoRoot, "electron", "main");
const PRELOAD_FILE = join(repoRoot, "electron", "preload", "index.ts");
const BASELINE_FILE = join(repoRoot, "scripts", "ipc-stub-baseline.json");
const UI_DIRS = ["src", "packages/ui", "packages/bundle"].map((d) => join(repoRoot, d));

const LIST_ALL = process.argv.includes("--list");

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------- 1. main 侧:注册了哪些通道、实现是什么 ----------

/**
 * 分类实现体。注意"含 throw"不等于"已移除"——真实处理器里到处是校验用的
 * `if (!x) throw new Error("...")`。只有抛出**移除类文案**才算显式移除,
 * 否则会把 `shellfs:read-text` 这种真实现误判成死接口(第一版就踩了这个坑)。
 */
const REMOVAL_MESSAGE = /throw\s+new\s+Error\(\s*[`"'][^)]*(?:removed|retired|已移除|已下线|has been retired)/i;
/** `throw new Error(someConst)` —— 文案在常量里,要回文件里查这个常量。 */
const INDIRECT_THROW = /throw\s+new\s+Error\(\s*([A-Za-z_$][\w$]*)\s*\)/;

function classifyBody(body, fileSource) {
  const hasThrow = /throw\s+new\s+Error\(/.test(body);
  const returnsEmpty = /return\s+(?:null|undefined)\s*;/m.test(body);
  const hasAwait = /\bawait\b/.test(body);
  if (REMOVAL_MESSAGE.test(body)) return "removed";
  const indirect = body.match(INDIRECT_THROW);
  if (indirect && fileSource) {
    const definition = new RegExp(`const\\s+${indirect[1]}\\s*=\\s*[\\s\\S]{0,200}?(?:removed|retired|已移除|已下线)`);
    if (definition.test(fileSource)) return "removed";
  }
  if (returnsEmpty && !hasAwait && !hasThrow) return "stub";
  return "real";
}

/**
 * 通道名出现在**注释里**不算实现。第二版就栽在这上面:`dialog:save` 在
 * `ipc/validation.ts:144` 的一行文档注释里被提到(讲 defaultPath 语义),
 * 紧随其后的是一段"无效提示返回 null"的代码,于是被误判成空桩。
 */
function isCommentLine(lineText) {
  return /^\s*(?:\*|\/\/|\/\*)/.test(lineText);
}

// 真正像个处理器注册点的形态:字面量作为某个 register…/wrap…/ipcMain.handle 调用的首参。
// 注意 prefix 是**到引号之前**的文本,所以这里以 '(' 结尾,而不是以引号结尾。
const REGISTRATION_SITE = /(?:register\w*|wrapIpcHandler|ipcMain\s*\.\s*(?:handle|on))\s*\(\s*$/;

/**
 * 通道在哪里"被实现",权威判据是 **electron/main 下出现过这个字面量**,
 * 而不是"有没有被某个注册函数包住"。原因是注册方式不止一种:
 * `wrapIpcHandler(...)` / `ipcMain.handle(...)` 之外还有包装函数
 * (如 `registerPluginHashIpc(hashPluginContent)`,它住在
 * `electron/main/plugin-hash.ts`,不在 `ipc/` 目录下)。第一版只扫
 * `electron/main/ipc/*.ts` 并只认那两种注册函数,于是把 `plugin:hash-content`
 * 误报成了"无处理器"。
 */
function readMainHandlers() {
  if (!existsSync(MAIN_DIR)) fail(`找不到 main 目录:${MAIN_DIR}`);
  const handlers = new Map(); // channel → { kind, file, line }
  const rank = { real: 0, stub: 1, removed: 2 };
  for (const file of walk(MAIN_DIR)) {
    const source = readFileSync(file, "utf8");
    // 不过滤 allowlist:处理器存不存在,与 preload 是否放行是两件事。
    // (第一版过滤了,于是"不在 allowlist 的通道"会被同时报成"无处理器"。)
    const matches = [...source.matchAll(CHANNEL_LITERAL)];
    matches.forEach((match, i) => {
      const start = match.index ?? 0;
      const linePrefix = source.slice(source.lastIndexOf("\n", start) + 1, start);
      if (isCommentLine(linePrefix)) return; // 注释里提到通道名 ≠ 实现了它
      // 注册点形态要看**跨行**的前文:`wrapIpcHandler(\n  "channel", …)` 这种
      // 换行写法(plugin-hash.ts 就是)只看当前行会漏掉。回看 120 字符足够覆盖
      // 一次调用头,配合"函数名必须是 register*/wrap*/ipcMain.handle"的约束,
      // 不会把处理器体内的普通字符串误收进来。
      const lookback = source.slice(Math.max(0, start - 120), start);
      // 只认"注册点形态"的字面量:main 里还有大量别的字符串(错误码、事件名、
      // i18n key),不过滤会把它们全算成"已注册通道"(实测虚增到 2890 条)。
      if (!REGISTRATION_SITE.test(lookback)) return;
      const nextStart = i + 1 < matches.length ? matches[i + 1].index ?? source.length : source.length;
      const body = source.slice(start, Math.min(nextStart, start + 800));
      const line = source.slice(0, start).split("\n").length;
      const kind = classifyBody(body, source);
      const atRegistrationSite = true; // 上面已经强制要求
      const prev = handlers.get(match[1]);
      // 注册点优先:index.ts 里那种"通道清单数组"和真实处理器的判据不同,
      // 真实处理器要能盖过清单(反之不成立)。
      if (
        !prev
        || (atRegistrationSite && !prev.atRegistrationSite)
        || (atRegistrationSite === prev.atRegistrationSite && rank[kind] > rank[prev.kind])
      ) {
        handlers.set(match[1], { kind, file: relative(repoRoot, file), line, atRegistrationSite });
      }
    });
  }
  return handlers;
}

// ---------- 2. preload 侧:allowlist(渲染进程"能调到什么") ----------

const CHANNEL_LITERAL = /["'`]([A-Za-z][A-Za-z0-9_:.\-/]{2,80})["'`]/g;

function readAllowlist() {
  if (!existsSync(PRELOAD_FILE)) fail(`找不到 preload:${PRELOAD_FILE}`);
  const source = readFileSync(PRELOAD_FILE, "utf8");
  const block = source.match(/allowedInvokeChannels[^=]*=\s*new Set\(\[([\s\S]*?)\]/);
  if (!block) fail("在 preload/index.ts 里找不到 allowedInvokeChannels 数组");
  const channels = new Set();
  for (const match of block[1].matchAll(CHANNEL_LITERAL)) channels.add(match[1]);
  if (channels.size === 0) fail("allowedInvokeChannels 解析出 0 条 —— 解析坏了(测试 fixture 也要求非空)");
  return channels;
}

// ---------- 3. UI 侧:谁在真的调这些通道 ----------

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__fixtures__" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx", ".mts", ".mjs"].includes(extname(full)) && !/\.test\.[cm]?tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// `invoke("channel")` / `invoke<Result>("channel")` 是渲染层真正的调用形态。
// 只按字面量比对会把"恰好同名的展示文案"也算进来,按调用形态比对才不会。
const INVOKE_CALL = /\.?invoke(?:<[^>()]*>)?\s*\(\s*["'`]([A-Za-z][A-Za-z0-9_:.\-/]{2,80})["'`]/g;

function readReferencedChannels(allowlist) {
  const referenced = new Map(); // channel → { where, viaCall }
  const uiFiles = UI_DIRS.flatMap((d) => walk(d));
  for (const file of uiFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CHANNEL_LITERAL)) {
      const channel = match[1];
      if (!allowlist.has(channel) || referenced.has(channel)) continue;
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      referenced.set(channel, { where: `${relative(repoRoot, file)}:${line}`, viaCall: false });
    }
    for (const match of source.matchAll(INVOKE_CALL)) {
      const channel = match[1];
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      const where = `${relative(repoRoot, file)}:${line}`;
      // 真正的调用点优先(它比"某处提到过这个名字"强得多)。
      referenced.set(channel, { where, viaCall: true });
    }
  }
  return referenced;
}

/** 调用了但没进 allowlist 的通道:preload 会在运行时直接拒绝。 */
function readCallsOutsideAllowlist(allowlist) {
  const outside = new Map();
  for (const file of UI_DIRS.flatMap((d) => walk(d))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(INVOKE_CALL)) {
      const channel = match[1];
      if (allowlist.has(channel) || outside.has(channel)) continue;
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      outside.set(channel, `${relative(repoRoot, file)}:${line}`);
    }
  }
  return outside;
}

// ---------- 4. 基线(只允许"显式移除且已登记"的通道) ----------

function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return { removedButReferenced: {} };
  const parsed = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  return { removedButReferenced: parsed.removedButReferenced ?? {} };
}

// ---------- 主流程 ----------

const allowlist = readAllowlist();
const handlers = readMainHandlers();
const referenced = readReferencedChannels(allowlist);
const outsideAllowlist = readCallsOutsideAllowlist(allowlist);
const baseline = readBaseline();

const fakeSuccess = [];   // UI 引用 + 空桩 → 失败
const unregistered = [];  // UI 引用 + 没有处理器 → 失败
const removedReferenced = []; // UI 引用 + 显式移除 → 需登记
const deadStubs = [];     // 无引用 + 空桩 → 仅报告

for (const [channel, ref] of referenced) {
  const handler = handlers.get(channel);
  if (!handler) { unregistered.push({ channel, where: ref.where }); continue; }
  if (handler.kind === "stub") fakeSuccess.push({ channel, where: ref.where, ...handler });
  else if (handler.kind === "removed") removedReferenced.push({ channel, where: ref.where, ...handler });
}

for (const [channel, handler] of handlers) {
  if (handler.kind === "stub" && !referenced.has(channel)) deadStubs.push({ channel, ...handler });
}

const problems = [];

for (const [channel, where] of outsideAllowlist) {
  problems.push(
    `[通道不在 allowlist] ${channel} — UI 在 ${where} 调用它,但 electron/preload/index.ts 没放行,` +
    `运行时会被 preload 直接拒绝(preload-not-loaded)。要么把通道接回来(处理器 + allowlist),要么删掉调用点。`,
  );
}
for (const item of fakeSuccess) {
  problems.push(
    `[假成功] ${item.channel} — UI 在 ${item.where} 调用它,但 ${item.file}:${item.line} 是空桩。` +
    `UI 会拿到 null 并当作成功。要么接真实实现,要么让 UI 停止调用。`,
  );
}
for (const item of unregistered) {
  problems.push(`[无处理器] ${item.channel} — UI 在 ${item.where} 调用它,但 electron/main 里没有注册。`);
}

const declared = baseline.removedButReferenced;
for (const item of removedReferenced) {
  if (!(item.channel in declared)) {
    problems.push(
      `[未登记的显式移除] ${item.channel} — UI 在 ${item.where} 调用它,实现是"已移除"抛出。` +
      `若知情保留,请把原因写进 scripts/ipc-stub-baseline.json 的 removedButReferenced。`,
    );
  }
}
const stillReferenced = new Set(removedReferenced.map((i) => i.channel));
for (const channel of Object.keys(declared)) {
  if (!stillReferenced.has(channel)) {
    problems.push(
      `[基线腐烂] ${channel} 登记在 baseline 里,但已经没有 UI 引用它了(或实现变了)。请从 ${relative(repoRoot, BASELINE_FILE)} 删除该条。`,
    );
  }
}

console.log(
  `IPC 桩门禁:扫描 ${handlers.size} 个已注册通道 / ${allowlist.size} 条 allowlist / ` +
  `${referenced.size} 个被 UI 引用的通道。`,
);
console.log(
  `  UI 引用+空桩 ${fakeSuccess.length} · UI 引用+无处理器 ${unregistered.length} · ` +
  `显式移除(已登记 ${Object.keys(declared).length}) ${removedReferenced.length} · 无引用空桩 ${deadStubs.length}`,
);

if (LIST_ALL && deadStubs.length > 0) {
  console.log("\n无 UI 引用的空桩(死面,建议清理但不阻塞):");
  for (const item of deadStubs) console.log(`  ${item.channel}  ${item.file}:${item.line}`);
}
if (LIST_ALL && removedReferenced.length > 0) {
  console.log("\n显式移除但 UI 仍引用(需按阶段偿还):");
  for (const item of removedReferenced) console.log(`  ${item.channel}  ← ${item.where}  ${item.file}:${item.line}`);
}

if (problems.length > 0) {
  console.error(`\n发现 ${problems.length} 个问题:\n`);
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error("\n这类缺陷的共同后果是「用户以为做成了,其实没发生」——不要用注释或 toast 文案绕过它。");
  process.exit(1);
}

console.log("\nIPC 桩门禁通过:没有被 UI 引用的空桩,也没有未登记的显式移除。");
