#!/usr/bin/env node
/**
 * scripts/ui-slot-coverage.mjs — 槽位三态审计(声明 / 注册 / 消费)。
 *
 * 为什么需要这个脚本
 * ------------------
 * OpenBuddy 的 UI 是「微内核 + 插件」:每个 ui-* 包通过 `ctx.slots.register()`
 * 往内核注册实现,页面通过 `useSlotComponent()` 消费。三种状态各自存在于
 * 不同文件里,**没有编译器能同时看到它们**:
 *
 *   - 声明(`declare module "@openbuddy/ui-slots"`)—— 类型契约,防止拼错
 *   - 注册(`ctx.slots.register`)—— 谁提供了实现
 *   - 消费(`useSlotComponent` / `SlotView` / …)—— 谁在渲染
 *
 * 于是出现了三种只有静态扫描才能发现的坏味道:
 *
 *   1. **声明了但没人注册** —— 页面调用 `useSlotComponent("x")` 时拿到兜底
 *      组件。开发者以为"插件会填进来",实际上是死声明。
 *   2. **声明了但没人消费** —— 注册了实现但页面从不渲染它。插件作者照着
 *      文档注册,用户却永远看不到(踩过:placeholder.* 曾大面积如此)。
 *   3. **注册/消费了但没声明** —— `SlotMap` 里没有这个 key,类型系统看不见,
 *      拼错也不会报错(R92 补了 11 个 placeholder.* 的声明,就是这类)。
 *
 * 用法:
 *   node scripts/ui-slot-coverage.mjs            # 人类可读报告
 *   node scripts/ui-slot-coverage.mjs --json     # JSON(给 CI / 探针)
 *   node scripts/ui-slot-coverage.mjs --check    # 有「类型漏洞」时退出 1
 *
 * `--check` 只把第 3 类(注册/消费但未声明)当失败 —— 前两类是**待办**,
 * 不是错误:一个包可以先声明槽位(契约先行),也可以暂时没有消费者。
 * 但「用了却没声明」永远是 bug:那是类型系统该拦住却拦不住的地方。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(["node_modules", "__tests__", "out", "dist", ".turbo", ".git"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SCAN_ROOTS = ["packages/ui", "src"];
const files = SCAN_ROOTS.flatMap((dir) => {
  try {
    return walk(join(root, dir));
  } catch {
    return [];
  }
});

const rel = (file) => file.slice(root.length + 1);

/**
 * 跳过一段可能**嵌套**的泛型实参,返回其后第一个非空白字符的下标。
 *
 * 为什么不能用正则:消费点的写法是
 *   `useSlotComponent<ComponentType<Record<string, unknown>>>("a.b", Fallback)`
 * 泛型里有两层 `>`。`(?:<[^>]*>\s*)?` 会在**第一个** `>` 处收尾,随后要求
 * 紧跟字符串字面量,于是匹配失败 —— 这些调用被误判成"没有消费方"。
 * 审计曾经因此少报了一批真实消费(onboarding.* 全系列),直接误导了改造
 * 优先级。这里改成按 `<>` 深度配对,`string` 字面量与注释跳过。
 */
function skipGenerics(source, startIndex) {
  let i = startIndex;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== "<") return i;
  let depth = 0;
  let inString = null;
  let escape = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "<") depth++;
    else if (ch === ">") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return startIndex;
}

/** 从 `(` 开始做括号配对,返回整段调用参数的文本。 */
function balancedRegion(source, openParenIndex) {
  let depth = 0;
  let inString = null;
  let escape = false;
  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openParenIndex, i + 1);
    }
  }
  return source.slice(openParenIndex, Math.min(source.length, openParenIndex + 4000));
}

const declared = new Map();
const registered = new Map();
const consumed = new Map();

function note(map, key, file) {
  if (!key || key === "root") return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(rel(file));
}

/** 只认 `a.b` 形状的 key —— 单段名(sidebar / conversation / home)是早期
 *  未命名空间的遗留,单独统计,不算"类型漏洞"。 */
const NAMESPACED = /^[a-z][a-zA-Z0-9-]*\.[a-zA-Z0-9.*_-]+$/;

for (const file of files) {
  const source = readFileSync(file, "utf8");

  // ---- 声明 ----
  const declIndex = source.indexOf('declare module "@openbuddy/ui-slots"');
  if (declIndex >= 0) {
    const region = source.slice(declIndex);
    for (const match of region.matchAll(/^\s{4,}"([^"]+)"\s*:/gm)) note(declared, match[1], file);
  }

  // ---- 注册 ----
  //
  // 两种写法都要认:
  //   a. 直接传字面量 —— `ctx.slots.register({ name: "overlay.settings", … })`
  //   b. 数组 + map  —— `PANELS.map((p) => ctx.slots.register({ name: p.name, … }))`,
  //      此时字面量在上方的 `const PANELS = [{ name: "placeholder.my-files", … }]`
  //      里,`register` 附近反而看不到名字。
  //
  // 对 (b) 的判定取自「文件里出现了 `.slots.register(` 且这个文件是 apply()
  // 注册入口」这一事实:client.tsx 是注册文件,里面出现的 namespaced `name:`
  // 字面量就是槽位名。不作为通用规则推广到业务组件 —— 那里 `name:` 可能属于
  // 别的语义。
  const hasRegisterCall = source.includes(".slots.register(");
  if (hasRegisterCall) {
    for (const name of source.matchAll(/\bname:\s*["']([a-z][a-zA-Z0-9.*_-]*\.[a-zA-Z0-9.*_-]+)["']/g)) {
      note(registered, name[1], file);
    }
  }
  for (const match of source.matchAll(/\.slots\.register\(/g)) {
    const region = balancedRegion(source, match.index + match[0].length - 1);
    for (const name of region.matchAll(/\bname:\s*["']([^"']+)["']/g)) note(registered, name[1], file);
  }

  // ---- 消费 ----
  const CONSUMERS = ["useSlotComponent", "useSlotComponents", "useSlotEntries", "useSlotPayloads", "useSlotHook", "renderSlotEntry"];
  for (const fn of CONSUMERS) {
    // 函数名之后可能是泛型实参而不是 `(`:
    //   `useSlotComponent<ComponentType<Record<string, unknown>>>("onboarding.data-dir", …)`
    // 旧的正则要求 `(` 紧跟函数名,于是**所有带泛型的消费点都被漏掉**
    // (onboarding.* 全系列),审计把"真有人消费"报成"注册了也不会渲染"。
    for (const match of source.matchAll(new RegExp(`\\b${fn}\\b`, "g"))) {
      const openParen = skipGenerics(source, match.index + match[0].length);
      if (source[openParen] !== "(") continue;
      const region = balancedRegion(source, openParen);
      // 消费点允许一个(可嵌套的)泛型实参出现在字符串字面量之前。
      const afterGenerics = skipGenerics(source, openParen + 1);
      const literal = source.slice(afterGenerics).match(/^["'`]([^"'`]+)["'`]/);
      if (literal) note(consumed, literal[1], file);
    }
  }
}

const keys = (map) => [...map.keys()].sort();
const pct = (part, whole) => (whole === 0 ? 100 : Math.round((part / whole) * 100));

const declaredOnly = keys(declared).filter((k) => !registered.has(k));
const declaredNotConsumed = keys(declared).filter((k) => !consumed.has(k));
const registeredUndeclared = keys(registered).filter((k) => !declared.has(k) && NAMESPACED.test(k));
const consumedUndeclared = keys(consumed).filter((k) => !declared.has(k) && NAMESPACED.test(k));
const legacySingleSegment = [...new Set([...keys(registered), ...keys(consumed)])].filter((k) => !NAMESPACED.test(k)).sort();
const wired = keys(declared).filter((k) => registered.has(k) && consumed.has(k));

const report = {
  totals: {
    declared: declared.size,
    registered: registered.size,
    consumed: consumed.size,
    /** 声明 + 注册 + 消费三者齐备 —— 真正"活的"槽位。 */
    wired: wired.length,
    filesScanned: files.length,
  },
  coverage: {
    registeredPct: pct(keys(declared).filter((k) => registered.has(k)).length, declared.size),
    consumedPct: pct(keys(declared).filter((k) => consumed.has(k)).length, declared.size),
    wiredPct: pct(wired.length, declared.size),
  },
  wired,
  /** 声明了但没人注册 —— 消费方会拿到兜底组件。 */
  declaredOnly,
  /** 声明了但没人消费 —— 注册了也不会渲染。 */
  declaredNotConsumed,
  /** 用了但没声明 —— 类型系统看不见的洞(`--check` 视为失败)。 */
  typeHoles: [...new Set([...registeredUndeclared, ...consumedUndeclared])].sort(),
  /** 单段槽位名(sidebar / conversation / home / details / notifications)。 */
  legacySingleSegment,
  evidence: {
    declaredOnly: Object.fromEntries(declaredOnly.map((k) => [k, [...declared.get(k)]])),
    declaredNotConsumed: Object.fromEntries(declaredNotConsumed.map((k) => [k, [...declared.get(k)]])),
    typeHoles: Object.fromEntries(
      [...new Set([...registeredUndeclared, ...consumedUndeclared])]
        .sort()
        .map((k) => [k, { declaredBy: [], registeredBy: [...(registered.get(k) ?? [])], consumedBy: [...(consumed.get(k) ?? [])] }]),
    ),
  },
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const t = report.totals;
  console.log("槽位三态审计(声明 / 注册 / 消费)\n");
  console.log(`  扫描文件   ${t.filesScanned}`);
  console.log(`  声明       ${t.declared}`);
  console.log(`  注册       ${t.registered}`);
  console.log(`  消费       ${t.consumed}`);
  console.log(`  三态齐备   ${t.wired}  (${report.coverage.wiredPct}% of declared)`);
  console.log();
  const section = (title, list) => {
    console.log(`${title}  (${list.length})`);
    if (list.length === 0) console.log("  — 无");
    else for (const k of list) console.log(`  ${k}`);
    console.log();
  };
  section("三态齐备 —— 真正活的槽位", wired);
  section("声明了但没人注册 —— 消费方会拿到兜底组件", declaredOnly);
  section("声明了但没人消费 —— 注册了也不会渲染", declaredNotConsumed);
  section("⚠ 类型漏洞(用了但没声明)", report.typeHoles);
  section("遗留单段槽位名(未命名空间)", legacySingleSegment);
}

if (process.argv.includes("--check") && report.typeHoles.length > 0) {
  console.error(`\n✗ ${report.typeHoles.length} 个槽位被注册/消费但未在 SlotMap 声明 —— 类型系统看不见它们。`);
  process.exit(1);
}
