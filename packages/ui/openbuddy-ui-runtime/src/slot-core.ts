/**
 * packages/ui/openbuddy-ui-runtime/src/slot-core.ts
 *
 * Phase K.3 —— UI 微内核（Microkernel Slot Core）。
 *
 * ## 为什么需要这一层
 *
 * Phase K 之前的装配链有三个断点，导致 SlotCore 名义上存在、实际上不生效：
 *
 *   1. `buildUiRuntime()` 通过 `createDeepSeekClientCompatibilityModules()` 的
 *      返回值取 `DeepSeekSlotCore`，但那个函数把 class 挂在
 *      `"@deepseek-ai/dsh-client-ui-slots"` 这个 **模块名 key** 下面，顶层
 *      并没有 `DeepSeekSlotCore` 字段。于是每次都 `undefined`，静默回落到
 *      一个手写的 fallback core。
 *   2. 即便用上真实 core，它要求 `kind:"list"` 的注册必须带 `id`、`keyed`
 *      必须带 `key`，而 6 个内置包（ui-settings / ui-workbench / ui-dialogs /
 *      ui-automation / ui-primitives / ui-settings-models）注册 list slot 时
 *      没给 id → 真实 core 直接抛错，这些包全部注册失败。
 *   3. 真实 core 用 `subscribe(name, listener)` 做变更通知，而 fallback core
 *      根本没有 `subscribe`。AppFrame 等消费者只能退化成轮询或干脆不刷新。
 *
 * 本模块把上面三件事一次性收敛：一个**自持的** SlotCore 实现，语义对齐
 * `DeepSeekSlotRegistry`（双写：保留原始 entry 供消费者读 options，同时维护
 * 按 kind 分派的索引），但不依赖 Cordis context 的启动顺序。
 *
 * ## 行为契约
 *
 * - `register(options, component)` 把 options **归一化**后登记：list 缺 `id`
 *   时自动派生（`<registrant>#<seq>`），因此任何包都不会因为漏写 id 抛错。
 * - 同一 cell（keyed→key / list→id / single→唯一）重复注册按「后写覆盖」处理，
 *   而不是抛错。这让 HMR / 重复 apply 天然幂等，也让插件可以按优先级覆盖内置实现。
 * - `subscribe(name, listener)` 在该 slot 的 entries 变化时同步触发，消费者
 *   （AppFrame / SlotOutlet）据此重渲染，不再轮询。
 * - `snapshot()` / `reports()` 暴露内核状态，供插件面板与 e2e 探针观测。
 *
 * ## 四种 dispatch kind
 *
 * - `single`  —— 只保留一个（优先级高者胜；同优先级后写覆盖）
 * - `list`    —— 多值追加，按 (priority, order, 插入序) 排序
 * - `keyed`   —— 按 key 寻址，同 key 高优先级覆盖
 * - `chain`   —— 按 priority 升序由外向内包裹，`chain()` 返回组装后的组件
 */

import { createElement, type ReactNode } from "react";
import type { ChildrenDecl, SlotCoreLike, SlotKind, SlotScope } from "@openbuddy/ui-slots";

/** 内核侧记录的 registration 原始形状（对齐 renderer-host `DeepSeekSlotOptions`）。 */
export interface SlotRegistrationOptions {
  name: string;
  kind?: SlotKind;
  scope?: SlotScope;
  /** keyed 维度。 */
  key?: string;
  /** list 维度。缺省时由内核派生。 */
  id?: string;
  order?: number;
  priority?: number;
  label?: string | (() => string);
  registrant?: string;
  children?: ChildrenDecl;
  select?: (owner: unknown) => unknown | null;
  inject?: unknown;
  store?: unknown;
  locale?: string;
  [key: string]: unknown;
}

/** 一条 slot entry：options 供消费者读 label/id，component 供渲染。 */
export interface SlotEntry {
  options: SlotRegistrationOptions;
  component: unknown;
  registrant?: string;
}

/** 每个 slot 的运行时记录。 */
interface SlotRecord {
  spec: { kind: SlotKind; scope: SlotScope; parent?: string };
  entries: SlotEntry[];
}

/** 一次 register() 的返回值：disposer + 内核认定的 entry。 */
export interface SlotCoreHandle extends SlotCoreLike {
  /** 声明一个 slot（不注册实现）。重复声明同 kind/scope 幂等。 */
  declare(name: string, spec: { kind: SlotKind; scope: SlotScope }, parent?: string): void;
  /** 原始 entry 列表（含 options），对齐 renderer-host 的 entriesOfSlot。 */
  entriesOfSlot(name: string): SlotEntry[];
  /** 全部 slot 的快照，供插件面板 / e2e 探针读取。 */
  snapshot(): Array<{ name: string; spec: { kind: SlotKind; scope: SlotScope }; entries: SlotEntry[]; children: string[] }>;
  /** 反注册所有 entry（配合 re-apply 实现幂等重挂载）。 */
  clear(): void;
  /** 已登记 slot 数（不含隐式 root）。 */
  size(): number;
}

/**
 * 归一化 options：给 list slot 派生稳定 id，给缺失的 kind/scope 补默认值。
 * 归一化是「任何包都不会因为漏写 id 而注册失败」的关键。
 */
function normalizeOptions(
  raw: SlotRegistrationOptions,
  seq: number,
): SlotRegistrationOptions {
  const kind: SlotKind = raw.kind ?? "list";
  const scope: SlotScope = raw.scope ?? "root";
  const registrant = raw.registrant;
  const out: SlotRegistrationOptions = { ...raw, kind, scope };
  if (kind === "keyed") {
    // keyed 必须可寻址：显式 key > id > 派生的 registrant#seq
    out.key = raw.key ?? raw.id ?? `${registrant ?? "@anonymous"}#${seq}`;
  } else if (kind === "list") {
    // list 必须有稳定 id 去重：显式 id > key > 派生的 registrant#seq
    out.id = raw.id ?? raw.key ?? `${registrant ?? "@anonymous"}#${seq}`;
  }
  return out;
}

/** 两个 options 是否指向同一个 cell（同 keyed key / 同 list id / single 恒真）。 */
function sameCell(kind: SlotKind, left: SlotRegistrationOptions, right: SlotRegistrationOptions): boolean {
  if (kind === "keyed") return (left.key ?? "") === (right.key ?? "");
  if (kind === "list") return (left.id ?? "") === (right.id ?? "");
  return true;
}

function orderOf(entry: SlotEntry): number {
  return entry.options.order ?? 0;
}

function priorityOf(entry: SlotEntry): number {
  return typeof entry.options.priority === "number" ? entry.options.priority : 0;
}

/**
 * single slot 的赢家：priority 高者胜；同 priority 后注册者胜。
 * 后注册者胜让插件可以「就地接管」内置实现，而不必去猜内置用了什么 priority。
 */
function singleWinner(entries: SlotEntry[]): SlotEntry | undefined {
  let winner: SlotEntry | undefined;
  for (const entry of entries) {
    if (!winner || priorityOf(entry) >= priorityOf(winner)) winner = entry;
  }
  return winner;
}

/** 默认排序：priority 升序 → order 升序 → 保持插入顺序（Array.sort 稳定）。 */
function sortEntries(entries: SlotEntry[]): SlotEntry[] {
  return entries.sort((left, right) => {
    const byPriority = priorityOf(left) - priorityOf(right);
    if (byPriority !== 0) return byPriority;
    return orderOf(left) - orderOf(right);
  });
}

/**
 * 创建内核实例。每次调用都是全新的、互相隔离的 core —— 单例由 client.tsx 持有，
 * 测试可以自由创建隔离实例。
 */
export function createSlotCore(): SlotCoreHandle {
  const records = new Map<string, SlotRecord>();
  const listeners = new Map<string, Set<() => void>>();
  /** 全局 registration 序号：给派生 id 用，保证同一 pass 内唯一。 */
  let seq = 0;

  records.set("root", { spec: { kind: "single", scope: "root" }, entries: [] });

  const ensure = (name: string, kind: SlotKind, scope: SlotScope, parent?: string): SlotRecord => {
    let rec = records.get(name);
    if (!rec) {
      rec = { spec: { kind, scope, ...(parent ? { parent } : {}) }, entries: [] };
      records.set(name, rec);
    }
    return rec;
  };

  const emit = (name: string): void => {
    const set = listeners.get(name);
    if (!set) return;
    // 复制一份再遍历：listener 里可能同步反注册。
    for (const fn of [...set]) {
      try { fn(); } catch { /* per-listener error swallow，与 events 层同策略 */ }
    }
  };

  const registerImpl = (raw: SlotRegistrationOptions, component: unknown): (() => void) => {
    if (!raw?.name) throw new Error("slot-core: registration name is required");
    const options = normalizeOptions(raw, seq++);
    const kind = options.kind as SlotKind;
    const scope = options.scope as SlotScope;
    const rec = ensure(options.name, kind, scope);

    // 首次注册锁定 kind。后续注册若声明了不同的 kind，说明调用方对同一个 slot
    // 有两套理解（例如内置按 single 提供、插件却按 list 追加）——继续注册只会
    // 得到一个语义混乱的混合列表。这里选择**明确拒绝**并告警，而不是静默接受：
    //   - 不抛错：插件作者的一次误用不应该让整个包 apply() 失败；
    //   - 不静默：告警里带 slot 名与双方 kind，问题一眼可见。
    if (raw.kind !== undefined && raw.kind !== rec.spec.kind) {
      // eslint-disable-next-line no-console
      console.warn(
        `[slot-core] slot "${options.name}" 已声明为 ${rec.spec.kind}，` +
          `忽略来自 ${options.registrant ?? "@anonymous"} 的 ${raw.kind} 注册。`,
      );
      return () => {};
    }

    const entry: SlotEntry = {
      options,
      component,
      ...(options.registrant ? { registrant: options.registrant } : {}),
    };

    if (kind === "single") {
      // single 保留**全部**注册者（按插入序），读取时才挑赢家。
      // 保留栈而不是「后写覆盖前写」，是为了让插件卸载后内置实现能自动回来：
      // 覆盖方 dispose 时只摘掉自己那一条，前一条自然重新生效。
      rec.entries.push(entry);
    } else if (kind === "keyed") {
      const existing = rec.entries.find((e) => sameCell("keyed", e.options, options));
      if (existing && priorityOf(existing) > priorityOf(entry)) {
        // 已有更高优先级的实现：忽略本次注册（返回 no-op disposer）。
        return () => {};
      }
      if (existing) rec.entries.splice(rec.entries.indexOf(existing), 1);
      rec.entries.push(entry);
    } else if (kind === "chain") {
      rec.entries.push(entry);
      sortEntries(rec.entries);
    } else {
      const existing = rec.entries.find((e) => sameCell("list", e.options, options));
      if (existing) rec.entries.splice(rec.entries.indexOf(existing), 1);
      rec.entries.push(entry);
      sortEntries(rec.entries);
    }

    // children 声明：把子 slot 登记进 registry，供 snapshot / 类型检查使用。
    if (options.children) {
      for (const [childName, childSpec] of Object.entries(options.children)) {
        if (!childSpec) continue;
        ensure(childName, childSpec.kind, childSpec.scope, options.name);
      }
    }

    emit(options.name);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = records.get(options.name);
      if (!current) return;
      const index = current.entries.indexOf(entry);
      if (index >= 0) current.entries.splice(index, 1);
      emit(options.name);
    };
  };

  const core: SlotCoreHandle = {
    register: registerImpl,
    declare(name, spec, parent) {
      ensure(name, spec.kind, spec.scope, parent);
      emit(name);
    },
    inject(_name, callback) {
      return callback();
    },
    entries(name) {
      const rec = records.get(name);
      if (!rec) return [];
      if (rec.spec.kind === "keyed") {
        // keyed：同 key 只暴露优先级最高的一个。
        const best = new Map<string, SlotEntry>();
        for (const entry of rec.entries) {
          const key = entry.options.key ?? "";
          const prev = best.get(key);
          if (!prev || priorityOf(entry) >= priorityOf(prev)) best.set(key, entry);
        }
        return [...best.values()].map((e) => e.component);
      }
      if (rec.spec.kind === "single") {
        const winner = singleWinner(rec.entries);
        return winner ? [winner.component] : [];
      }
      return rec.entries.map((e) => e.component);
    },
    entriesOfSlot(name) {
      const rec = records.get(name);
      return rec ? [...rec.entries] : [];
    },
    entryForKey(name, key) {
      const rec = records.get(name);
      if (!rec || rec.spec.kind !== "keyed") return undefined;
      let winner: SlotEntry | undefined;
      for (const entry of rec.entries) {
        if ((entry.options.key ?? "") !== key) continue;
        if (!winner || priorityOf(entry) >= priorityOf(winner)) winner = entry;
      }
      return winner?.component;
    },
    chain(name) {
      const rec = records.get(name);
      if (!rec || rec.spec.kind !== "chain") return undefined;
      // priority 升序 = 由外向内包裹，与 renderer-host 的 selectChain 语义一致。
      const layer = [...rec.entries].sort((a, b) => priorityOf(a) - priorityOf(b));
      if (layer.length === 0) return undefined;
      type Cmp = (props: { children?: ReactNode }) => ReactNode;
      let inner: Cmp = ({ children }) => children ?? null;
      for (const entry of layer) {
        const Outer = entry.component as Cmp;
        const Next = inner;
        inner = ((props: { children?: ReactNode }) =>
          createElement(Outer as never, null, createElement(Next as never, null, props.children))) as Cmp;
      }
      return inner;
    },
    spec(name) {
      const rec = records.get(name);
      return rec ? ({ kind: rec.spec.kind, scope: rec.spec.scope } as never) : undefined;
    },
    subscribe(name, listener) {
      const set = listeners.get(name) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(name);
      };
    },
    snapshot() {
      return [...records.entries()].map(([name, rec]) => ({
        name,
        spec: { kind: rec.spec.kind, scope: rec.spec.scope },
        entries: [...rec.entries],
        children: [...records.entries()]
          .filter(([, child]) => child.spec.parent === name)
          .map(([childName]) => childName),
      }));
    },
    clear() {
      const names = [...records.keys()];
      for (const name of names) {
        if (name === "root") continue;
        records.delete(name);
      }
      records.get("root")!.entries.length = 0;
      for (const name of names) emit(name);
    },
    size() {
      return records.size - 1;
    },
  };

  return core;
}
