#!/usr/bin/env node
/**
 * ui-slot-audit.mjs — 微内核槽位「注册 vs 消费」对照表。
 *
 * 高内聚低耦合的微内核里,最有价值的一类回归是:某个包把 UI 注册进了 slot,
 * 但**没有任何地方消费它** —— 功能看起来"有",用户永远看不到。这个脚本把
 * 三个数字拉到一起:
 *
 *   声明(declare module SlotMap)  →  谁契约上有这块位置
 *   注册(ctx.slots.register)       →  谁真的往里放实现
 *   消费(useSlotXX / SlotOutlet)      →  谁真的把它渲染出来
 *
 * 「注册了但零消费」= 死能力(要么接线漏了,要么 slot 名拼错)。
 *
 * 已知盲区(静态扫描的边界,不是漏报):
 *   - 泛型里带函数类型的调用(`useSlotPayloads<{ onClick?: () => void }>("x")`)一度
 *     被漏掉过 —— 泛型匹配现在允许引号以外的任意字符,别改回 `[^(]*`。
 *   - 用变量注册的槽名(例如 ui-dialogs 里的 `dialog.named`)扫不到,会显示成
 *     no-impl;核对时用真实 Electron 探针(_probe-slot-assembly.mjs)兜底。
 * 「消费了但零注册」= 靠 fallback 活着(内核里没有实现,插件化收益为 0)。
 * 其中有一类**是设计如此**,单列成 ext-default:声明包自己消费、并且自带
 * 内置默认实现(例如 ui-editor 的 `editor.toolbar` —— 内置按钮写在组件里,
 * 槽位只承载"插件增量")。判据是自动推导的,不用手工维护白名单:
 *   声明于包 P + 被包 P 消费 + 零注册者 ⇒ ext-default。
 *
 * 用法:node scripts/ui-slot-audit.mjs [--json]
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const UI_DIR = join(ROOT, "packages", "ui");
const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".git", ".worktrees"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * 剥掉 `/* … *\/` 与 `// …` 注释。
 *
 * 故意做得很朴素(不处理正则字面量 / 模板串里的 `//`):这个脚本只需要"注释里
 * 的示例代码不参与匹配",而不是一个准确的 JS 词法分析器。真要处理模板串反而
 * 会引入新的误判面(例如 markdown 里的 URL)。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const files = [];
for (const root of ["packages/ui", "src", "packages/bundle", "packages/runtime"]) {
  const p = join(ROOT, root);
  if (existsSync(p)) {
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else files.push(p);
  }
}

const declared = new Map(); // name -> Set(declaring file)
const registered = new Map(); // name -> Set(package)
const consumed = new Map(); // name -> Set(file)

const pkgOf = (file) => {
  const m = file.match(/\/packages\/ui\/(openbuddy-ui-[^/]+)\//);
  if (m) return "@" + m[1];
  return file.startsWith(join(ROOT, "src")) ? "app(src)" : "host";
};

const DECL_RE = /^\s*"([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*)"\s*:\s*\{/gm;
// 两种登记形式都要认:register("name", impl) 与 register({ name: "..." }, impl)。
const REG_RES = [
  /slots\.register\(\s*"([^"]+)"/g,
  /\.register\(\s*\n?\s*"([^"]+)"/g,
  /\.register\(\s*\{[^}]*?name:\s*"([^"]+)"/gs,
];
const CONS_RE = /useSlot(?:PayloadValues|Components|Entries|Payloads|Component|List)(?:<[^"]*?>)?\(\s*"([^"]+)"/g;
const OUTLET_RE = /<SlotOutlet[^>]*?name="([^"]+)"/g;
const GET_RE = /(?:slotCore|core)\.get\(\s*"([^"]+)"/g;

for (const file of files) {
  if (/\.test\.(ts|tsx|mjs|js)$/.test(file)) continue;
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  // 先去掉注释再扫描。
  //
  // 为什么必要:`ui-runtime/src/client.tsx` 的文档注释里写着
  // `<SlotOutlet name="..."/>`,它被 OUTLET_RE 当成真消费点匹配到,于是审计表
  // 里多出一行槽名叫 `...` 的幽灵 no-impl —— 每次看表都要重新判断一遍"这是
  // 不是漏接线"。注释里的示例代码不是契约,扫描前必须剥掉。
  // (先剥注释也让下面 `declare module` 的定位不会被注释里的同名文本干扰。)
  src = stripComments(src);
  const add = (map, name, value) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(value);
  };
  // 只把 SlotMap 声明算数:限定在 declare module 块附近。
  if (/declare module "@openbuddy\/ui-slots"/.test(src)) {
    const block = src.slice(src.indexOf('declare module "@openbuddy/ui-slots"'));
    for (const m of block.matchAll(DECL_RE)) add(declared, m[1], file);
  }
  for (const re of REG_RES) {
    for (const m of src.matchAll(re)) {
      // 排除测试/无关 register(只留看起来像 slot 名的)。
      if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/.test(m[1])) continue;
      add(registered, m[1], pkgOf(file));
    }
  }
  for (const m of src.matchAll(CONS_RE)) add(consumed, m[1], pkgOf(file));
  for (const m of src.matchAll(OUTLET_RE)) add(consumed, m[1], pkgOf(file));
  for (const m of src.matchAll(GET_RE)) add(consumed, m[1], pkgOf(file));
}

// 有意的扩展点:注册进去是给「本产品外壳之外的消费者」用的(ui-layout 的
// AppFrame / 第三方外壳),当前 AppShell 走命名 slot 路径。单列出来,免得每次
// 审计都要重新判断一遍是不是接线漏了。
const INTENTIONAL_EXTENSION_POINTS = new Set(["shell.overlay", "notifications", "details"]);

/**
 * 只提供**参考实现**的槽:声明它们的包既不注册、也不在本产品外壳渲染。用途是
 * 给第三方插件一个可复用的组件底座(插件 import 本包组件,注册到别的槽或自己
 * 渲染)。
 *
 * \`modules.marketplace\` / \`modules.marketplace.item\` 属于这一类:ui-modules 导出
 * \`MarketplaceTab\` / \`MarketplaceCard\` 作为市场页的参考实现,apply() 是有意的
 * no-op(内置市场页走 ui-mcp 的 \`MarketplacePanel\`,自带 IPC 取数据;两套数据
 * 模型不同,强行接线只会造出第二份实现)。
 */
const REFERENCE_ONLY_SLOTS = new Set(["modules.marketplace", "modules.marketplace.item"]);

/**
 * 已废弃、仅为兼容保留的槽。
 *
 * \`home.page\` 与 \`home\` 描述的是同一块 UI(首页整页),而 \`home\` 才是本产品
 * 外壳真正消费的那个。留着声明是为了不破坏已有第三方插件的类型引用,但**不应**
 * 再去接线它 —— 两个名字指向同一块区域只会误导插件作者。审计把它单列,免得每次
 * 都重新判断一遍"这是不是漏接线"。
 */
const DEPRECATED_SLOTS = new Set(["home.page"]);

const names = [...new Set([...declared.keys(), ...registered.keys(), ...consumed.keys()])].sort();

/**
 * 这个槽是不是「内置即默认插件」(零注册是设计如此,不是漏接线)。
 *
 * 判据只用一条:**有人消费它**。有消费者就意味着那块 UI 一定渲染出来了 ——
 * 消费者必然带一个内置 fallback(否则是空白),那个 fallback 就是"默认实现"。
 *
 * 早期版本还要求"声明者 == 消费者",那是过窄的启发式:跨包默认同样成立
 * (ui-modules 声明 \`modules.marketplace\`、ui-experts 消费、以 ui-mcp 的
 * \`MarketplacePanel\` 兜底),这种槽会被误报成"靠 fallback 活着"。反过来也成立:
 * 一个槽**没有**消费者时,零注册才是真问题(声明了但没人读)—— 那正是 no-impl
 * 要抓的东西。
 */
function hasBuiltinDefault(name) {
  return (consumed.get(name)?.size ?? 0) > 0;
}

const rows = names.map((name) => {
  const regs = [...(registered.get(name) ?? [])];
  const cons = [...(consumed.get(name) ?? [])];
  return {
    name,
    declaredIn: [...(declared.get(name) ?? [])].map((f) => f.replace(ROOT + "/", "")),
    registeredBy: regs,
    consumedBy: cons,
    status: regs.length && cons.length
      ? "ok"
      : !regs.length
        ? INTENTIONAL_EXTENSION_POINTS.has(name) ||
          REFERENCE_ONLY_SLOTS.has(name) ||
          DEPRECATED_SLOTS.has(name) ||
          hasBuiltinDefault(name)
          ? "ext-default"
          : "no-impl"
        : INTENTIONAL_EXTENSION_POINTS.has(name)
          ? "ext"
          : "dead",

  };
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("slot", 30), pad("status", 8), pad("registered by", 34), "consumed by");
  console.log("-".repeat(110));
  for (const r of rows) {
    const icon =
      r.status === "ok"
        ? "✅"
        : r.status === "dead"
          ? "💀"
          : r.status === "ext" || r.status === "ext-default"
            ? "🔌"
            : "⚠️ ";
    console.log(
      pad(r.name, 30),
      pad(icon + " " + r.status, 8),
      pad(r.registeredBy.join(",") || "-", 34),
      r.consumedBy.join(",") || "-",
    );
  }
  const dead = rows.filter((r) => r.status === "dead");
  const ext = rows.filter((r) => r.status === "ext" || r.status === "ext-default");
  const noImpl = rows.filter((r) => r.status === "no-impl");
  console.log("-".repeat(110));
  console.log(
    `总共 ${rows.length} 个槽位; ok=${rows.length - dead.length - noImpl.length - ext.length} dead=${dead.length} ext=${ext.length} no-impl=${noImpl.length}`,
  );
  if (noImpl.length > 0) {
    console.log(
      `no-impl(消费方靠 fallback 活着,插件替换收益为 0): ${noImpl.map((r) => r.name).join(", ")}`,
    );
  }
  if (dead.length > 0) {
    console.log(`dead(注册了但零消费,能力不可见): ${dead.map((r) => r.name).join(", ")}`);
  }
}
