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
 * 用法:
 *   node scripts/ui-slot-audit.mjs           # 人读表格
 *   node scripts/ui-slot-audit.mjs --json    # 逐槽结构化输出(kind/scope/状态/双方)
 *   node scripts/ui-slot-audit.mjs --md      # 生成 docs/EXTENSION_POINTS.md 的登记表区块
 *
 * `--md` 是 docs/EXTENSION_POINTS.md 里那段「自动生成」表格的唯一生产者:
 * 登记表不再手工维护,新增/删除槽位后重新跑一次即可,CI 侧由
 * packages/ui/openbuddy-ui-runtime/src/__tests__/extension-points.test.ts 校验新鲜度。
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
/** name -> { kind, scope, regKind, regScope, hasOwner }:登记表要公开的两个轴。 */
const meta = new Map();

const pkgOf = (file) => {
  const m = file.match(/\/packages\/ui\/(openbuddy-ui-[^/]+)\//);
  // 目录名 `openbuddy-ui-settings` 对应的包名是 `@openbuddy/ui-settings` ——
  // 少这一层转换的话,表里的注册方会和 package.json 里的真实包名对不上
  // (守卫测试拿 BUILTIN_UI_APPLIES 里的 `pkg` 去比,一比就红)。
  if (m) return "@openbuddy/" + m[1].replace(/^openbuddy-ui-/, "ui-");
  return file.startsWith(join(ROOT, "src")) ? "app(src)" : "host";
};

const metaOf = (name) => {
  if (!meta.has(name)) meta.set(name, {});
  return meta.get(name);
};

/**
 * 从 `{` 的下标出发做花括号配平,返回对象体(不含最外层花括号)。
 *
 * 为什么需要:kind 与 scope 是 slot 契约里最容易被插件作者搞错的两个轴,
 * 登记表必须公开它们。而声明体是多行对象字面量(还夹着注释),单个正则
 * 匹配不到闭合位置,只能配平扫描。
 */
function objectBody(src, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openBraceIndex + 1, i);
    }
  }
  return "";
}

/** 取对象体里某个字符串字段的第一处出现(`kind: "single"` → `single`)。 */
const fieldOf = (body, field) =>
  body.match(new RegExp(`\\b${field}\\s*:\\s*"([^"]+)"`))?.[1];

const SLOT_NAME_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/;

const DECL_RE = /^\s*"([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*)"\s*:\s*\{/gm;
// 两种登记形式都要认:register("name", impl) 与 register({ name: "..." }, impl)。
const REG_OBJ_RE = /\.register\(\s*\{/g;
const REG_STR_RE = /\.register\(\s*"([^"]+)"/g;
const CONS_RE = /useSlot(?:PayloadValues|Components|Entries|Payloads|Component|List)(?:<[^"]*?>)?\(\s*"([^"]+)"/g;
const OUTLET_RE = /<SlotOutlet[^>]*?name="([^"]+)"/g;
const GET_RE = /(?:slotCore|core)\.get\(\s*"([^"]+)"/g;

/**
 * 第二条总线:渲染端贡献(`useRendererContributions(kind)`)与渲染端字符串槽
 * (`useRendererSlot(name)`)。
 *
 * 它们**不是** SlotCore 槽:kind 是 `@openbuddy/renderer-host` 里的封闭联合,
 * 字符串槽走 Cordis 的 `slots` 服务,两者都没有 SlotMap 契约、也没有 kind
 * 一致性校验。但插件作者能看到的 UI 位置有一半在这里 —— 旧的登记表只写了
 * 6 个 SlotCore 槽,于是 `sidebar` / `settings` 这些**真实存在**的插入点
 * 全都没有登记。审计必须把它们一起扫出来,否则"登记表"是残缺的。
 */
const RENDERER_KIND_RE = /useRendererContributions\(\s*"([^"]+)"\s*\)/g;
const RENDERER_SLOT_RE = /useRendererSlot(?:Entries)?\(\s*"([^"]+)"\s*\)/g;
const rendererKindConsumers = new Map(); // kind -> Set(file)
const rendererSlotConsumers = new Map(); // name -> Set(file)

/** 渲染端 contribution 的合法 kind(从 renderer-host 的联合类型里读出来)。 */
function readRendererKinds() {
  const p = join(ROOT, "packages", "renderer", "openbuddy-renderer-host", "src", "index.ts");
  if (!existsSync(p)) return [];
  const src = readFileSync(p, "utf8");
  const m = src.match(/kind:\s*("(?:[a-z][a-z0-9-]*)"(?:\s*\|\s*"[a-z][a-z0-9-]*")+)/);
  if (!m) return [];
  return m[1]
    .split("|")
    .map((part) => part.trim().replace(/"/g, ""))
    .filter(Boolean);
}
const RENDERER_KINDS = readRendererKinds();

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
    for (const m of block.matchAll(DECL_RE)) {
      add(declared, m[1], file);
      // m[0] 以 `{` 结尾;从那里配平出声明体,抠出 kind/scope/是否有 owner。
      const body = objectBody(block, m.index + m[0].length - 1);
      const entry = metaOf(m[1]);
      entry.kind ??= fieldOf(body, "kind");
      entry.scope ??= fieldOf(body, "scope");
      entry.hasOwner ||= /^\s*owner\??\s*:/m.test(body);
    }
  }
  // register({ name, kind, scope }, impl) —— 选项体里同时带着两个轴。
  for (const m of src.matchAll(REG_OBJ_RE)) {
    const body = objectBody(src, m.index + m[0].length - 1);
    const name = fieldOf(body, "name");
    if (!name || !SLOT_NAME_RE.test(name)) continue;
    add(registered, name, pkgOf(file));
    const entry = metaOf(name);
    // 声明侧还没出现这两个轴时,用注册侧兜底(有些槽只注册、没写进 SlotMap)。
    entry.regKind ??= fieldOf(body, "kind");
    entry.regScope ??= fieldOf(body, "scope");
  }
  // register("name", impl) —— 不带元数据的老式登记,只贡献「谁注册了」。
  for (const m of src.matchAll(REG_STR_RE)) {
    if (!SLOT_NAME_RE.test(m[1])) continue;
    add(registered, m[1], pkgOf(file));
  }
  for (const m of src.matchAll(CONS_RE)) add(consumed, m[1], pkgOf(file));
  for (const m of src.matchAll(OUTLET_RE)) add(consumed, m[1], pkgOf(file));
  for (const m of src.matchAll(GET_RE)) add(consumed, m[1], pkgOf(file));
  for (const m of src.matchAll(RENDERER_KIND_RE)) add(rendererKindConsumers, m[1], pkgOf(file));
  for (const m of src.matchAll(RENDERER_SLOT_RE)) add(rendererSlotConsumers, m[1], pkgOf(file));
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

function statusOf(name) {
  const hasReg = (registered.get(name)?.size ?? 0) > 0;
  const hasCons = (consumed.get(name)?.size ?? 0) > 0;
  if (hasReg && hasCons) return "ok";
  if (!hasReg) {
    return INTENTIONAL_EXTENSION_POINTS.has(name) ||
      REFERENCE_ONLY_SLOTS.has(name) ||
      DEPRECATED_SLOTS.has(name) ||
      hasBuiltinDefault(name)
      ? "ext-default"
      : "no-impl";
  }
  return INTENTIONAL_EXTENSION_POINTS.has(name) ? "ext" : "dead";
}

/**
 * 非 ok 状态的「为什么」—— 登记表里最容易被反复追问的一列。
 *
 * 这些判断是人工知识(设计如此 ≠ 漏接线),所以从审计脚本里导出,而不是让
 * 文档另写一份:两份知识一旦分叉,读者就不知道该信哪个。
 */
function reasonOf(name, status) {
  if (REFERENCE_ONLY_SLOTS.has(name)) return "参考实现:声明包只导出组件,apply() 有意 no-op";
  if (DEPRECATED_SLOTS.has(name)) return "已废弃:仅为兼容旧插件的类型引用保留,不要再接线";
  if (INTENTIONAL_EXTENSION_POINTS.has(name)) {
    return "有意扩展点:留给本产品外壳之外的装配方(第三方外壳/插件可整块接管)";
  }
  if (status === "ext-default") return "内置即默认:消费方自带 fallback,插件注册同名单例槽即整体替换";
  return "";
}

const rows = names.map((name) => {
  const regs = [...(registered.get(name) ?? [])];
  const cons = [...(consumed.get(name) ?? [])];
  const abs = [...(declared.get(name) ?? [])];
  const entry = meta.get(name) ?? {};
  const status = statusOf(name);
  return {
    name,
    kind: entry.kind ?? entry.regKind ?? "—",
    scope: entry.scope ?? entry.regScope ?? "—",
    status,
    reason: reasonOf(name, status),
    declaredBy: [...new Set(abs.map(pkgOf))],
    declaredIn: abs.map((f) => f.replace(ROOT + "/", "")),
    registeredBy: regs,
    consumedBy: cons,
  };
});

const countBy = (list, status) => list.filter((r) => r.status === status).length;
const STATUS_BADGE = { ok: "✅ ok", ext: "🔌 ext", "ext-default": "🔌 ext-default", dead: "💀 dead", "no-impl": "⚠️ no-impl" };

/** 渲染端总线的一行:kind/槽名 -> 谁在消费。 */
function rendererBus() {
  const kinds = RENDERER_KINDS.map((name) => ({
    name,
    consumers: [...(rendererKindConsumers.get(name) ?? [])].sort(),
  }));
  return {
    kinds,
    unusedKinds: kinds.filter((k) => k.consumers.length === 0).map((k) => k.name),
    slots: [...rendererSlotConsumers.keys()].sort().map((name) => ({
      name,
      consumers: [...(rendererSlotConsumers.get(name) ?? [])].sort(),
    })),
  };
}

/**
 * `--md`:生成 docs/EXTENSION_POINTS.md 里那段自动区块。
 *
 * 输出必须**确定**(同一次扫描必然逐字节一致),否则新鲜度守卫会假红。
 */
function renderMarkdownBlock(list) {
  const dead = list.filter((r) => r.status === "dead");
  const noImpl = list.filter((r) => r.status === "no-impl");
  const ext = list.filter((r) => r.status === "ext" || r.status === "ext-default");
  const ok = list.length - dead.length - noImpl.length - ext.length;
  const lines = [];
  lines.push("<!-- BEGIN GENERATED: extension-points -->");
  lines.push("");
  lines.push("> 本区块由 `node scripts/ui-slot-audit.mjs --md` 生成,**请勿手改**。");
  lines.push("> 新增/删除槽位后重跑该命令;CI 由 `packages/ui/openbuddy-ui-runtime/src/__tests__/extension-points.test.ts` 校验新鲜度。");
  lines.push("");
  lines.push("### SlotCore 槽位总表");
  lines.push("");
  lines.push(
    `**共 ${list.length} 个槽位** — \`ok=${ok}\` · \`ext=${ext.length}\` · \`dead=${dead.length}\` · \`no-impl=${noImpl.length}\``,
  );
  lines.push("");
  lines.push("| Slot | Kind | Scope | 状态 | 声明于 | 注册方 | 消费方 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of list) {
    const cell = (v) => (v && v.length ? v.join(", ") : "—");
    lines.push(
      `| \`${r.name}\` | \`${r.kind}\` | \`${r.scope}\` | ${STATUS_BADGE[r.status] ?? r.status} | ${cell(r.declaredBy)} | ${cell(r.registeredBy)} | ${cell(r.consumedBy)} |`,
    );
  }
  lines.push("");
  lines.push("**状态含义**");
  lines.push("");
  lines.push("- `ok` — 有人注册、有人消费,插件注册同名单例槽即可替换。");
  lines.push("- `ext` / `ext-default` — 零注册是设计如此:前者留给本产品外壳之外的装配方,后者消费方自带内置 fallback。");
  lines.push("- `dead` — 有人注册但无人消费(能力不可见,属于 bug)。");
  lines.push("- `no-impl` — 有人消费但无人注册(插件替换收益为 0,属于接线缺口)。");
  // 只解释非 ok 的槽,并按判据归组 —— 18 条 ext-default 逐行展开会把登记表
  // 淹掉,读者需要的是"这几种情况是设计如此",不是 18 遍同一句话。
  const notes = new Map();
  for (const r of list) {
    if (r.status === "ok" || !r.reason) continue;
    if (!notes.has(r.reason)) notes.set(r.reason, []);
    notes.get(r.reason).push(r.name);
  }
  if (notes.size) {
    lines.push("");
    lines.push("**非 ok 槽位的判据**");
    lines.push("");
    for (const [reason, names] of notes) {
      lines.push(`- ${reason} — ${names.map((n) => `\`${n}\``).join(", ")}`);
    }
  }
  const bus = rendererBus();
  lines.push("");
  lines.push("### 渲染端贡献总线(第二条总线,与 SlotCore 并列)");
  lines.push("");
  lines.push("由 `@openbuddy/renderer-host` 的 `RendererContributionRegistry` 承载:插件以");
  lines.push("`{ kind, id, payload }` 注册,宿主按 `kind` 渲染。`kind` 是封闭联合,下面按代码核对");
  lines.push(`**声明 ${bus.kinds.length} 个 / 被消费 ${bus.kinds.length - bus.unusedKinds.length} 个**。`);
  lines.push("");
  lines.push("| Kind | 消费点 |");
  lines.push("|---|---|");
  for (const k of bus.kinds) {
    lines.push(`| \`${k.name}\` | ${k.consumers.length ? k.consumers.join(", ") : "⚠️ 无人消费"} |`);
  }
  lines.push("");
  lines.push(`**renderer 字符串槽(${bus.slots.length} 个)** —— 走 Cordis \`slots\` 服务,名字由插件自由起,`);
  lines.push("没有 SlotMap 契约;列在这里是为了让插件作者知道宿主**会**在哪些位置把它们渲染出来。");
  lines.push("");
  lines.push("| Slot | 消费点 |");
  lines.push("|---|---|");
  for (const s of bus.slots) {
    lines.push(`| \`${s.name}\` | ${s.consumers.length ? s.consumers.join(", ") : "—"} |`);
  }
  lines.push("");
  lines.push("<!-- END GENERATED: extension-points -->");
  return lines.join("\n");
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else if (process.argv.includes("--json-renderer")) {
  console.log(JSON.stringify(rendererBus(), null, 2));
} else if (process.argv.includes("--md")) {
  console.log(renderMarkdownBlock(rows));
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
