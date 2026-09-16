/**
 * @openbuddy/ui-runtime/client — SlotProvider and runtime singleton.
 *
 * The runtime is a single browser-side singleton. <SlotProvider> mounts the
 * providers (theme + locale + i18n + runtime context) and starts the
 * renderer-host plugin bridge. After mount, `registerBuiltinUi(plugin)` and
 * `applyRemotePlugin(entry)` add plugins to the live SlotCore.
 */

import {
  createContext,
  createElement,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  RendererPluginLoader,
  type RendererPlugin,
  type RendererPluginEntry,
} from "@openbuddy/renderer-host";
import { Context as CordisContext } from "@openbuddy/cordis";
import { ThemeProvider, getOrCreateThemeService } from "@openbuddy/ui-theme/client";
import { I18nProvider, getOrCreateLocaleService } from "@openbuddy/ui-locale/client";
import type { SessionRecord, WorkspaceRecord, Observable, UiRuntime } from "./index";
import type { UiPlugin, SlotCoreLike, UiRuntimeContext, SlotKind, SlotScope } from "@openbuddy/ui-slots";
import { BUILTIN_UI_APPLIES } from "./builtin-applies";
import { serializeBuiltinUiSlotTrack } from "./slot-plugin-manifest";
import { createSlotCore, type SlotCoreHandle, type SlotEntry } from "./slot-core";

export type { SlotEntry, SlotCoreHandle, SlotRegistrationOptions } from "./slot-core";

// ---------- session/workspace store ---------------------------------------

function createSessionsStore(): Observable<readonly SessionRecord[]> & {
  list(): readonly SessionRecord[];
  get(id: string): SessionRecord | undefined;
  set(records: readonly SessionRecord[]): void;
} {
  const listeners = new Set<() => void>();
  let records: readonly SessionRecord[] = [];
  let byId = new Map<string, SessionRecord>();
  const update = (next: readonly SessionRecord[]) => {
    records = next;
    byId = new Map(next.map((r) => [r.id, r]));
    for (const fn of listeners) fn();
  };
  return {
    getSnapshot: () => records,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    list: () => records,
    get: (id) => byId.get(id),
    set: update,
  };
}

function createWorkspacesStore(): Observable<readonly WorkspaceRecord[]> & {
  set(records: readonly WorkspaceRecord[]): void;
} {
  const listeners = new Set<() => void>();
  let records: readonly WorkspaceRecord[] = [];
  const update = (next: readonly WorkspaceRecord[]) => {
    records = next;
    for (const fn of listeners) fn();
  };
  return {
    getSnapshot: () => records,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    set: update,
  };
}

// ---------- runtime singleton ---------------------------------------------

function buildUiRuntime(): UiRuntime {
  // Phase K.3 —— 微内核：SlotCore 是自持实现（见 ./slot-core）。
  // 它同时提供 register/entries/spec 与 subscribe/snapshot，既是插件装配总线，
  // 也是 UI 组合的订阅源。第三方 dsh.client 插件通过 ui.slots 走同一条注册路径。
  const slots: SlotCoreHandle = createSlotCore();

  const sessions = createSessionsStore();
  const workspaces = createWorkspacesStore();

  const runtime: UiRuntime = {
    slots,
    sessions,
    workspaces,
    session: (id) => sessions.get(id),
    registerBuiltinUi: async (plugin) => {
      return await applyOne(slots, plugin);
    },
    applyRemotePlugin: async (plugin) => {
      return await applyOne(slots, plugin);
    },
    dispose: () => {
      // No-op at the moment; plugin disposers live on the SlotCore.
    },
  };

  return runtime;
}

async function applyOne(slots: SlotCoreLike, plugin: UiPlugin | RendererPlugin): Promise<() => Promise<void>> {
  if (!plugin || typeof plugin !== "object") {
    throw new Error("ui-runtime: plugin must be an object with apply()");
  }
  const apply = (plugin as UiPlugin).apply;
  if (typeof apply !== "function") {
    throw new Error("ui-runtime: plugin.apply is not a function");
  }
  // 与内置包共用同一个 ctx:插件在 apply() 里能拿到 locale / theme / sessions,
  // 而不是只有 slots。以前这里另建一个 events 总线 + 没有服务,文档承诺的
  // 「apply 收到 ctx.locale / ctx.theme」对远程插件是空的。
  const ctx = getRuntimeContext();
  const disposer = await Promise.resolve(apply(ctx as never, undefined));
  return async () => { await Promise.resolve(disposer?.()); };
}

function makeEvents() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(name: string, listener: (...args: unknown[]) => void) {
      let s = listeners.get(name);
      if (!s) { s = new Set(); listeners.set(name, s); }
      s.add(listener);
      return () => { s!.delete(listener); };
    },
    emit(name: string, ...args: unknown[]) {
      const s = listeners.get(name);
      if (!s) return;
      for (const fn of s) try { fn(...args); } catch { /* swallow per-listener errors */ }
    },
  };
}

/**
 * 真实 SlotCore 由 `./slot-core` 提供（Phase K.3 微内核）。
 *
 * 历史包袱：这里曾经尝试从 `createDeepSeekClientCompatibilityModules()` 的返回值
 * 取 `DeepSeekSlotCore`，但那个函数把 class 放在模块名 key 下、顶层并没有该字段，
 * 于是每次都拿到 undefined 并静默回落到一个手写 stub。stub 既没有 subscribe，
 * 又要求调用方自己保证 entry 形状，导致 21 个内置包中 6 个在真实 core 上会直接
 * 抛错、而 stub 上则完全没有变更通知。现在统一走 `createSlotCore()`。
 */
function makeFallbackSlotCore(): SlotCoreHandle { return createSlotCore(); }

// ---------- React provider ------------------------------------------------

const RuntimeCtx = createContext<UiRuntime | null>(null);

let singleton: UiRuntime | null = null;
export function getOrCreateSingleton(): UiRuntime {
  if (!singleton) singleton = buildUiRuntime();
  return singleton;
}

let builtinRegistered = false;
let lastRegisteredCount = 0;

/** 单包装配结果 —— 供 e2e 探针 / 插件面板 / 单测观测内核真实装配情况。 */
export interface BuiltinUiPackageReport {
  /** 包 id，例如 `@openbuddy/ui-sidebar`。 */
  pkg: string;
  /** apply() 是否未抛错。 */
  ok: boolean;
  /** 本次 apply() 注册了几条 entry（含 children 声明）。 */
  slotsRegistered: number;
  /** 本次 apply() 注册到的 slot 名（去重）。 */
  slotNames: string[];
  /** 耗时（ms，保留 2 位）。 */
  durationMs: number;
  /** 失败原因（ok=false 时存在）。 */
  error?: string;
}

let lastReport: readonly BuiltinUiPackageReport[] = [];

/** 暴露给测试与集成代码,返回当前 runtime singleton。 */
export function getRuntime(): UiRuntime {
  return getOrCreateSingleton();
}

/** 上一次 registerAllBuiltinUis 注册成功的包数。 */
export function lastRegisteredPackageCount(): number {
  return lastRegisteredCount;
}

/** 上一次 registerAllBuiltinUis 的逐包结果。 */
export function lastRegisteredReport(): readonly BuiltinUiPackageReport[] {
  return lastReport;
}

/** 测试专用:返回一个全新的、与 runtime 单例隔离的 SlotCore。 */
export function __makeTestSlotCore(): SlotCoreHandle {
  return createSlotCore();
}

let builtinDisposer: (() => void) | null = null;

export function SlotProvider({ children }: { children: ReactNode }) {
  const runtime = useMemo(() => getOrCreateSingleton(), []);
  useEffect(() => {
    if (builtinRegistered) return;
    builtinRegistered = true;
    builtinDisposer = registerAllBuiltinUis();
    return () => {
      builtinDisposer?.();
      builtinDisposer = null;
      builtinRegistered = false;
    };
  }, []);
  return createElement(
    ThemeProvider,
    null,
    createElement(
      I18nProvider,
      null,
      createElement(RuntimeCtx.Provider, { value: runtime }, children)
    )
  );
}

export function useUiRuntime(): UiRuntime {
  const v = useContext(RuntimeCtx);
  if (!v) throw new Error("useUiRuntime must be used inside <SlotProvider>");
  return v;
}

/**
 * 宽松版 runtime 读取：不在 `<SlotProvider>` 内时返回 undefined。
 *
 * 为什么需要：消费面 hooks（useSlotEntries / useSlotComponents / useSlotPayloads）
 * 会被 HomePage、Composer 这类**叶子组件**调用，而这些组件经常在
 * SlotProvider 之外被渲染 —— 单元测试、Storybook、插件预览页都是这种情况。
 * 微内核不该让"没装内核"变成渲染崩溃：没有内核 = 没有插件贡献 = 渲染空集，
 * 这是合理的降级，不是错误。
 *
 * `useUiRuntime()` 保持抛错语义不变：直接要 runtime 句柄的代码确实装错了位置。
 */
export function useUiRuntimeOptional(): UiRuntime | undefined {
  return useContext(RuntimeCtx) ?? undefined;
}

// ---------- standard-kit hook bindings -----------------------------------

export function useUiRuntimeHook(): UiRuntime { return useUiRuntime(); }

export function useSessionHook(): SessionRecord | undefined {
  const rt = useUiRuntime();
  const id = useCurrentSessionId();
  const [snapshot, setSnapshot] = useState(() => rt.sessions.getSnapshot());
  useEffect(() => rt.sessions.subscribe(() => setSnapshot(rt.sessions.getSnapshot())), [rt]);
  if (!id) return undefined;
  return rt.session(id);
}

export function useSessionsHook(): readonly SessionRecord[] {
  const rt = useUiRuntime();
  return useSyncExternalStore(
    (fn) => rt.sessions.subscribe(fn),
    () => rt.sessions.getSnapshot(),
    () => rt.sessions.getSnapshot()
  );
}

export function useWorkspacesHook(): readonly WorkspaceRecord[] {
  const rt = useUiRuntime();
  return useSyncExternalStore(
    (fn) => rt.workspaces.subscribe(fn),
    () => rt.workspaces.getSnapshot(),
    () => rt.workspaces.getSnapshot()
  );
}

export function useSlotHook<K extends string>(name: K) {
  const rt = useUiRuntime();
  const entries = rt.slots.entries(name);
  const spec = rt.slots.spec(name);
  return { entries, spec };
}

// ---------- 微内核消费面：把 slot 变成 React 组件树 -------------------------
//
// 内核只负责「登记」；UI 组合需要「订阅 + 渲染」。下面这组 API 是消费面：
// 任何包（含第三方插件）都可以用 <SlotOutlet name="..."/> 把某个 slot 的
// 当前实现渲染出来，而不用 import 具体组件。

/**
 * 订阅一个 slot 的 entry 变化，返回当前的原始 entry 列表（含 options）。
 *
 * 用 state + subscribe 而不是 useSyncExternalStore：内核的 entriesOfSlot()
 * 每次调用都返回新数组，直接喂给 useSyncExternalStore 会因快照不稳定而
 * 触发 "getSnapshot should be cached" 的无限渲染。state 版本只在
 * 内核真正 emit 时更新一次。
 */
const EMPTY_SLOT_ENTRIES: readonly SlotEntry[] = Object.freeze([]);

export function useSlotEntries(name: string): readonly SlotEntry[] {
  const rt = useUiRuntimeOptional();
  const core = rt?.slots as SlotCoreHandle | undefined;
  const read = useCallback(
    () => (core?.entriesOfSlot?.(name) ?? EMPTY_SLOT_ENTRIES),
    [core, name],
  );
  const [entries, setEntries] = useState<readonly SlotEntry[]>(read);
  useEffect(() => {
    if (!core) return undefined;
    setEntries(read());
    // 内核缺失 subscribe（早期 fallback 实现）时至少保证初次挂载读到内容。
    return core.subscribe?.(name, () => setEntries(read())) ?? undefined;
  }, [core, name, read]);
  return entries;
}

/**
 * 订阅一个 slot，返回**按 kind 分派后**可渲染的组件列表。
 *
 * 与 useSlotEntries 的区别很关键：useSlotEntries 返回内核里的全部原始登记项
 * （用于诊断 / 插件面板），而这里返回的是「当前该渲染哪些」——single slot 只会
 * 给出 priority 最高的那一个，keyed 按 key 去重。消费方一律应该用这个。
 */
const EMPTY_COMPONENTS: readonly unknown[] = Object.freeze([]);

export function useSlotComponents(name: string): readonly unknown[] {
  const rt = useUiRuntimeOptional();
  const read = useCallback(
    () => (rt ? [...rt.slots.entries(name)] : EMPTY_COMPONENTS),
    [rt, name],
  );
  const [components, setComponents] = useState<readonly unknown[]>(read);
  useEffect(() => {
    if (!rt) return undefined;
    setComponents(read());
    return rt.slots.subscribe?.(name, () => setComponents(read())) ?? undefined;
  }, [rt, name, read]);
  return components;
}

/** 渲染单个 slot entry（函数组件 / 带 render() 的对象 / 已渲染节点都支持）。 */
export function renderSlotEntry(component: unknown, props?: Record<string, unknown>): ReactNode {
  if (component === null || component === undefined) return null;
  if (typeof component === "function") {
    return createElement(component as never, (props ?? {}) as never);
  }
  if (typeof component === "object" && "render" in (component as object)) {
    const render = (component as { render?: () => ReactNode }).render;
    if (typeof render === "function") return render();
  }
  return component as ReactNode;
}

export interface SlotOutletProps {
  /** slot 名，例如 "sidebar" / "shell.overlay" / "placeholder.my-files"。 */
  name: string;
  /** 传给 slot 组件的 owner props。 */
  props?: Record<string, unknown>;
  /** entries 为空时渲染（默认渲染 null）。 */
  fallback?: ReactNode;
  /** 只渲染第一个 entry（single / 需要唯一实现的场景）。 */
  first?: boolean;
  /** 额外包裹每一层的元素，便于加 class / key。 */
  wrap?: (node: ReactNode, index: number) => ReactNode;
}

/**
 * <SlotOutlet> —— 微内核的渲染出口。
 *
 * 消费者只声明「我要渲染哪个 slot」，具体渲染哪个组件由内核里当前登记的
 * 实现决定。第三方插件可以用更高 priority 注册同名字 slot 来整体替换某块 UI，
 * 也可以用 list slot 追加内容 —— 这正是「微内核 + 插件式」的可见收益。
 */
export function SlotOutlet({ name, props, fallback = null, first = false, wrap }: SlotOutletProps): ReactNode {
  // 用 kind-aware 的 components（single 已收敛为唯一赢家），而不是原始 entries。
  const components = useSlotComponents(name);
  if (components.length === 0) return fallback;
  const list = first ? components.slice(0, 1) : components;
  return createElement(
    Fragment,
    null,
    ...list.map((component, index) => {
      const node = renderSlotEntry(component, props);
      if (wrap) return createElement(Fragment, { key: index }, wrap(node, index));
      return createElement(Fragment, { key: index }, node);
    }),
  );
}

// ---------- session-id bridge --------------------------------------------

let currentSessionId: string | null = null;
const sessionIdListeners = new Set<() => void>();
function setCurrentSessionId(id: string | null) {
  currentSessionId = id;
  for (const fn of sessionIdListeners) fn();
}
export function useCurrentSessionId(): string | undefined {
  return useSyncExternalStore(
    (fn) => { sessionIdListeners.add(fn); return () => sessionIdListeners.delete(fn); },
    () => currentSessionId ?? undefined,
    () => currentSessionId ?? undefined
  );
}

/** Plugin apply(): wire ctx.ui into the renderer-host context. */
export function applyUiRuntime(ctx: { ui?: UiRuntime; slots?: SlotCoreLike; sessions?: Observable<readonly SessionRecord[]>; workspaces?: Observable<readonly WorkspaceRecord[]> } & Record<string, unknown>): () => void {
  const rt = getOrCreateSingleton();
  if (ctx && typeof ctx === "object") ctx.ui = rt;
  return () => {};
}

/**
 * registerAllBuiltinUis — 遍历 BUILTIN_UI_APPLIES,对每个内置 ui-* 包调用其
 * apply(ctx)。这是"包结构 -> 运行时装配"的桥梁;SlotProvider 挂载时同步触发。
 *
 * 返回的 disposer 数组按注册反序执行,HMR / teardown 时统一释放。
 *
 * 实现细节:
 *   - Phase K.2: 通过 `serializeBuiltinUiSlotTrack()` 把每个 builtin 表项
 *     投影成 OpenBuddyPlugin slot track (manifest schema `openbuddy.plugin.v1`),
 *     令 inventory / plugin panel / 动态加载场景共享同一份 metadata。
 *     实际 `apply()` 调用仍然走原本的 in-process reference —— v6 §3.4 把
 *     "实际装载依然走 PI loadExtensions()" 作为 Phase K 的不变式;这里
 *     的 `apply(ctx)` 已经是 in-process 装载,不需要再经过 PI。
 *   - ctx.ui / ctx.slots / ctx.events 由 getOrCreateSingleton() 提供
 *   - 失败的 apply 不影响后续包(per-listener error swallow,事件层同策略)
 *   - 包内 ctx.slots.register() 注册的内容会被 SlotCore 持有,dispose 由各包负责
 */
let runtimeCtx: UiRuntimeContext | null = null;

/**
 * 微内核给 apply(ctx) 的**完整**上下文。
 *
 * 为什么必须是一个共享对象而不是每次现造:
 *   - `ctx.locale` / `ctx.theme` 指向 React 树用的同一个 store —— 插件改语言 /
 *     改主题会立刻反映到界面(以前各建一个 store,改了没反应);
 *   - `ctx.slots` / `ctx.sessions` / `ctx.workspaces` 与 runtime singleton 一致。
 *
 * 单例语义与 `getOrCreateSingleton()` 相同:进程内一份,`registerAllBuiltinUis`
 * 与 `applyRemotePlugin` 都从这里取,因此插件与内置包看到的是同一个内核。
 */
export function getRuntimeContext(): UiRuntimeContext {
  if (runtimeCtx) return runtimeCtx;
  const rt = getOrCreateSingleton();
  runtimeCtx = {
    slots: rt.slots,
    events: makeEvents(),
    locale: getOrCreateLocaleService(),
    theme: getOrCreateThemeService(),
    sessions: rt.sessions,
    workspaces: rt.workspaces,
    ui: rt,
  };
  return runtimeCtx;
}

export function registerAllBuiltinUis(): () => void {
  const rt = getOrCreateSingleton();
  const core = rt.slots as SlotCoreHandle;
  const ctx = getRuntimeContext();
  const disposers: Array<() => void> = [];
  const report: BuiltinUiPackageReport[] = [];
  let okCount = 0;

  for (const { pkg, apply, ...rest } of BUILTIN_UI_APPLIES) {
    const started = Date.now();
    // 记录 apply() 前 core 的 slot 快照，apply() 后求差即可得到「这个包注册了什么」，
    // 不需要包自己上报 —— 这是 report 能零侵入的原因。
    // 注意必须比对 entry 数而不是 slot 名集合：多个包会注册进同一个 slot
    // （ui-settings / ui-workbench / ui-dialogs / ui-automation → shell.overlay），
    // 只看新增 slot 名会把它们误判成 0。
    const beforeCounts = new Map(core.snapshot().map((row) => [row.name, row.entries.length]));
    try {
      // Materialise the Phase K.1 SDK slot track row up front so any
      // manifest-level validation errors surface before the apply() call.
      // The serialised row is unused at runtime (the in-process apply()
      // is the source of truth) but the manifest gives inventory + plugin
      // panel a stable view of which packages are wired up.
      const track = serializeBuiltinUiSlotTrack({
        pkg,
        apply,
        ...(rest as { description?: string; configDefaults?: Record<string, unknown> }),
      });
      if (track.disabled) {
        report.push({ pkg, ok: true, slotsRegistered: 0, slotNames: [], durationMs: 0 });
        continue;
      }
      const dispose = apply(ctx as never, undefined);
      if (typeof dispose === "function") disposers.push(() => dispose());
      okCount++;

      const touched: string[] = [];
      let slotsRegistered = 0;
      for (const row of core.snapshot()) {
        const delta = row.entries.length - (beforeCounts.get(row.name) ?? 0);
        if (delta <= 0) continue;
        slotsRegistered += delta;
        touched.push(row.name);
      }
      report.push({
        pkg,
        ok: true,
        slotsRegistered,
        slotNames: touched,
        durationMs: Math.round((Date.now() - started) * 100) / 100,
      });
    } catch (err) {
      report.push({
        pkg,
        ok: false,
        slotsRegistered: 0,
        slotNames: [],
        durationMs: Math.round((Date.now() - started) * 100) / 100,
        error: err instanceof Error ? err.message : String(err),
      });
      // eslint-disable-next-line no-console
      console.error("[ui-runtime] apply() failed for " + pkg + ":", err);
    }
  }

  lastRegisteredCount = okCount;
  lastReport = report;
  // 暴露给 e2e 探针：Electron 里可以直接读 window.__ob_builtin_report 校验装配。
  if (typeof window !== "undefined") {
    (window as unknown as { __ob_builtin_report?: readonly BuiltinUiPackageReport[] }).__ob_builtin_report = report;
    // 内核快照：让 e2e 能断言「某个 slot 当前有几条 entry、由谁提供」，
    // 而不必从 DOM 反推。只读，不暴露 register（避免探针误改运行时状态）。
    (window as unknown as { __ob_slotcore?: unknown }).__ob_slotcore = {
      snapshot: () => core.snapshot().map((row) => ({
        name: row.name,
        kind: row.spec.kind,
        entries: row.entries.length,
        registrants: row.entries.map((e) => e.registrant ?? null),
        // 插件贡献的 payload 让 e2e 能断言"插件真的注册进来了什么"。
        payloadIds: row.entries.map((e) => {
          const payload = e.options.payload as { id?: unknown } | undefined;
          return payload && typeof payload.id === "string" ? payload.id : null;
        }),
      })),
      size: () => core.size(),
    };
  }
  // 单包失败静默会让 UI 悄悄退化成裸文本；这里统一告警，便于启动期发现问题。
  const failed = report.filter((row) => !row.ok);
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[ui-runtime] ${failed.length}/${report.length} 个内置 UI 包装配失败：` +
        failed.map((row) => `${row.pkg} (${row.error})`).join(", "),
    );
  }

  return () => {
    for (let i = disposers.length - 1; i >= 0; i--) {
      try { disposers[i](); } catch { /* swallow */ }
    }
  };
}

// ---------- 插件 SDK 桥接（Phase K.3）--------------------------------------
//
// `@openbuddy/plugin-sdk` 的 `defineExtension()` 通过派发 DOM CustomEvent
// （`openbuddy:register-slot` 等）来表达「我贡献了这些东西」。在这之前**没有任何
// 监听者**：三个示例插件（hello / toolbar / slash）的注册调用派发完事件就消失了，
// 插件作者看到的是"代码跑了、界面没变"。
//
// 本模块是那个缺失的 sink —— 把 SDK 事件接进微内核。分层考虑：
//   - SDK 保持零依赖（它不 import ui-runtime，第三方可以在任何 host 里复用）；
//   - 内核侧的命名/校验/去重全部由 ui-runtime 负责。
//
// 事件 → 内核 slot 的映射是 1:1 的：插件写的 slot 名就是内核里的 slot 名。
// payload 原样存进 entry.options.payload，消费方用 useSlotPayloads(name) 读取。

/** SDK 事件携带的 detail 形状。 */
interface PluginSdkSlotDetail {
  name?: string;
  kind?: "list" | "keyed";
  scope?: "root" | "session";
  payload?: unknown;
}

interface PluginSdkCommandDetail {
  id?: string;
  label?: string;
  onExecute?: (ctx?: { args?: string }) => void;
}

export interface PluginSdkBridgeOptions {
  /** 覆盖默认 window；测试用。 */
  target?: Window & typeof globalThis;
}

let pluginSdkBridgeInstalled = false;
let pluginSdkBridgeDisposer: (() => void) | null = null;

/**
 * 把 plugin-sdk 的 DOM 事件接进微内核。幂等：重复调用只装一次。
 *
 * 返回 disposer，卸载时同时摘除全部由插件注册的 entry（避免 HMR 后重复）。
 */
export function installPluginSdkBridge(options: PluginSdkBridgeOptions = {}): () => void {
  if (pluginSdkBridgeInstalled) return pluginSdkBridgeDisposer ?? (() => {});
  const target = options.target ?? (typeof window !== "undefined" ? window : undefined);
  if (!target) return () => {};

  const core = getOrCreateSingleton().slots as SlotCoreHandle;
  /** 记录插件注册过的东西，卸载时统一反注册。 */
  const disposers = new Map<string, () => void>();

  const slotsChanged = (name: string): void => {
    // 内核已经 emit 过，这里只是给需要一个统一事件名的消费者（如旧版
    // renderer-plugin-runtime 的贡献面板）留一个观察点。
    target.dispatchEvent(new CustomEvent("openbuddy:slot-changed", { detail: { name } }));
  };

  const onRegisterSlot = (event: Event): void => {
    const detail = (event as CustomEvent<PluginSdkSlotDetail>).detail ?? {};
    const name = detail.name;
    if (!name) return;
    const kind = detail.kind ?? "list";
    const id = `${name}::${String((detail.payload as { id?: unknown } | undefined)?.id ?? detail.payload ?? "")}`;
    // 同 id 重复注册时先摘掉旧的，保证插件重复 setup() 不会叠加两份。
    disposers.get(id)?.();
    const dispose = core.register(
      {
        name,
        kind: kind === "keyed" ? "keyed" : "list",
        scope: detail.scope === "session" ? "session" : "root",
        id: kind === "keyed" ? undefined : id,
        key: kind === "keyed" ? id : undefined,
        registrant: "@openbuddy/plugin-sdk",
        payload: detail.payload,
      },
      // 数据型贡献没有组件；消费者通过 useSlotPayloads() 读 payload。
      null,
    );
    disposers.set(id, () => { dispose(); disposers.delete(id); });
    slotsChanged(name);
  };

  const onUnregisterSlot = (event: Event): void => {
    const detail = (event as CustomEvent<{ name?: string }>).detail ?? {};
    const name = detail.name;
    if (!name) return;
    for (const [id, dispose] of [...disposers]) {
      if (id.startsWith(`${name}::`)) dispose();
    }
    slotsChanged(name);
  };

  /** 插件注册的命令：存进 `plugin.command` list slot，⌘K / SlashCommands 可消费。 */
  const commands = new Map<string, PluginSdkCommandDetail>();
  const onRegisterCommand = (event: Event): void => {
    const detail = (event as CustomEvent<PluginSdkCommandDetail>).detail ?? {};
    if (!detail.id) return;
    commands.set(detail.id, detail);
    const dispose = core.register(
      {
        name: "plugin.command",
        kind: "list",
        id: `command::${detail.id}`,
        registrant: "@openbuddy/plugin-sdk",
        payload: detail,
      },
      null,
    );
    disposers.set(`command::${detail.id}`, dispose);
  };
  const onUnregisterCommand = (event: Event): void => {
    const detail = (event as CustomEvent<{ id?: string }>).detail ?? {};
    if (!detail.id) return;
    commands.delete(detail.id);
    disposers.get(`command::${detail.id}`)?.();
  };

  target.addEventListener("openbuddy:register-slot", onRegisterSlot as EventListener);
  target.addEventListener("openbuddy:unregister-slot", onUnregisterSlot as EventListener);
  target.addEventListener("openbuddy:register-command", onRegisterCommand as EventListener);
  target.addEventListener("openbuddy:unregister-command", onUnregisterCommand as EventListener);

  pluginSdkBridgeInstalled = true;
  pluginSdkBridgeDisposer = () => {
    target.removeEventListener("openbuddy:register-slot", onRegisterSlot as EventListener);
    target.removeEventListener("openbuddy:unregister-slot", onUnregisterSlot as EventListener);
    target.removeEventListener("openbuddy:register-command", onRegisterCommand as EventListener);
    target.removeEventListener("openbuddy:unregister-command", onUnregisterCommand as EventListener);
    for (const dispose of [...disposers.values()]) {
      try { dispose(); } catch { /* swallow */ }
    }
    disposers.clear();
    commands.clear();
    pluginSdkBridgeInstalled = false;
    pluginSdkBridgeDisposer = null;
  };
  return pluginSdkBridgeDisposer;
}

/**
 * 读取一个 slot 里由插件注册的**数据型**贡献（payload）。
 *
 * 插件贡献有两类形态：
 *   - 组件型：payload 是 React 组件，用 useSlotComponents() 渲染；
 *   - 数据型：payload 是 `{ id, label, onActivate }` 这类描述，由宿主提供 UI，
 *     插件只提供数据。这个 hook 就是给后者用的。
 */
export function useSlotPayloads<T = unknown>(name: string): readonly T[] {
  const entries = useSlotEntries(name);
  return useMemo(
    () => entries
      .map((entry) => entry.options.payload as T | undefined)
      .filter((payload): payload is T => payload !== undefined),
    [entries],
  );
}
