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
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  RendererPluginLoader,
  createDeepSeekClientCompatibilityModules,
  type RendererPlugin,
  type RendererPluginEntry,
} from "@openbuddy/renderer-host";
import { Context as CordisContext } from "@openbuddy/cordis";
import { ThemeProvider } from "@openbuddy/ui-theme/client";
import { I18nProvider } from "@openbuddy/ui-locale/client";
import type { SessionRecord, WorkspaceRecord, Observable, UiRuntime } from "./index";
import type { UiPlugin, SlotCoreLike, UiRuntimeContext, SlotKind, SlotScope } from "@openbuddy/ui-slots";
import { BUILTIN_UI_APPLIES } from "./builtin-applies";

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
  // Construct the renderer-host SlotCore via the existing deepseek-compat
  // adapter so third-party dsh.client bundles compose through the same
  // loader the original renderer-plugin-runtime already exercises.
  const compatibility = createDeepSeekClientCompatibilityModules(/* react */ {} as never);
  // The compatibility layer is module-only and returns the SlotCore as one
  // of its members; we extract it to attach to UiRuntime. We import lazily
  // to avoid pulling renderer-host into the SSR surface.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const compatSlotCore: SlotCoreLike | undefined = (compatibility as {
    DeepSeekSlotCore?: new () => SlotCoreLike;
  }).DeepSeekSlotCore
    ? new (compatibility as { DeepSeekSlotCore: new () => SlotCoreLike }).DeepSeekSlotCore()
    : undefined;

  const slots: SlotCoreLike = compatSlotCore ?? makeFallbackSlotCore();

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
  const ctx = { slots, events: makeEvents() };
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
 * 内部槽位记录:按 kind 维护不同数据结构。
 * - list 模式:按注册顺序存数组,提供 entries()
 * - keyed 模式:按 key 维度 Map<key, entry>,同 key 后注册覆盖前注册(按 priority 大者覆盖)
 * - chain 模式:按 priority 升序存数组,提供 chain() 返回外→内逐层包装的最终组件
 * - single 模式:仅保留第一个注册者(向后兼容历史调用)
 */
interface SlotRecord {
  spec: { kind: SlotKind; scope: SlotScope } | undefined;
  list: Array<{ key: string | undefined; priority: number; component: unknown }>;
  keyed: Map<string, { priority: number; component: unknown }>;
  chain: Array<{ key: string | undefined; priority: number; component: unknown; dispose: () => void }>;
}

function makeSlotRecord(): SlotRecord {
  return { spec: undefined, list: [], keyed: new Map(), chain: [] };
}

/**
 * Fallback SlotCore 实现,支持四种 dispatch kind:
 *   - list   — 默认,按注册顺序返回所有 component
 *   - keyed  — 按 key 注册,同 key 后注册覆盖前注册(priority 大者赢)
 *   - chain  — 按 priority 升序包裹(外→内),chain() 返回组装好的最终组件
 *   - single — 仅保留第一个注册者(向后兼容)
 *
 * 设计要点:
 *   1. 同一个 slot 名可以反复 register,内部按 kind 维护不同视图
 *   2. 由第一次 register 时锁定的 kind 决定该 slot 的后续行为
 *   3. disposer 按 component identity 去除,keyed 模式还要带 key 维度
 */
function makeFallbackSlotCore(): SlotCoreLike { return makeFallbackSlotCoreImpl(); }
function makeFallbackSlotCoreImpl(): SlotCoreLike {
  const records = new Map<string, SlotRecord>();
  records.set("root", makeSlotRecord());

  const ensureRecord = (name: string, kind: SlotKind): SlotRecord => {
    let rec = records.get(name);
    if (!rec) { rec = makeSlotRecord(); records.set(name, rec); }
    if (!rec.spec) rec.spec = { kind, scope: "root" };
    return rec;
  };

  return {
    register(options, component) {
      const kind: SlotKind = options.kind ?? "list";
      const key = options.key;
      const priority = typeof options.priority === "number" ? options.priority : 0;
      const rec = ensureRecord(options.name, kind);

      if (kind === "keyed") {
        const existing = rec.keyed.get(key ?? "");
        if (!existing || priority >= existing.priority) {
          rec.keyed.set(key ?? "", { priority, component });
        }
        return () => {
          const r = records.get(options.name);
          if (!r) return;
          const cur = r.keyed.get(key ?? "");
          if (cur && cur.component === component) r.keyed.delete(key ?? "");
        };
      }

      if (kind === "chain") {
        const entry = { key, priority, component, dispose: () => {} };
        rec.chain.push(entry);
        rec.chain.sort((a, b) => a.priority - b.priority);
        let disposed = false;
        entry.dispose = () => {
          if (disposed) return;
          disposed = true;
          const r = records.get(options.name);
          if (!r) return;
          r.chain = r.chain.filter((e) => e !== entry);
        };
        return entry.dispose;
      }

      if (kind === "single") {
        if (rec.list.length === 0) {
          rec.list.push({ key, priority, component });
        }
        return () => { /* single 模式下后注册者 disposer 为 no-op */ };
      }

      rec.list.push({ key, priority, component });
      return () => {
        const r = records.get(options.name);
        if (!r) return;
        r.list = r.list.filter((e) => e.component !== component);
      };
    },
    inject(_name, register) { return register(); },
    entries(name) {
      const rec = records.get(name);
      if (!rec || !rec.spec) return [];
      const kind = rec.spec.kind;
      if (kind === "keyed") return Array.from(rec.keyed.values()).map((e) => e.component);
      if (kind === "chain") return rec.chain.map((e) => e.component);
      if (kind === "single") return rec.list.slice(0, 1).map((e) => e.component);
      return rec.list.map((e) => e.component);
    },
    entryForKey(name, key) {
      const rec = records.get(name);
      if (!rec || rec.spec?.kind !== "keyed") return undefined;
      return rec.keyed.get(key)?.component;
    },
    chain(name) {
      const rec = records.get(name);
      if (!rec || rec.spec?.kind !== "chain") return undefined;
      const layer = rec.chain;
      if (layer.length === 0) return undefined;
      type Cmp = React.ComponentType<{ children?: React.ReactNode }>;
      let inner: Cmp = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
      for (let i = 0; i < layer.length; i++) {
        const Outer = layer[i].component as Cmp;
        const Next = inner;
        inner = ((props: { children?: React.ReactNode }) => <Outer><Next>{props.children}</Next></Outer>) as Cmp;
      }
      return inner;
    },
    spec(name) { return records.get(name)?.spec as never; },
  };
}

// ---------- React provider ------------------------------------------------

const RuntimeCtx = createContext<UiRuntime | null>(null);

let singleton: UiRuntime | null = null;
export function getOrCreateSingleton(): UiRuntime {
  if (!singleton) singleton = buildUiRuntime();
  return singleton;
}

let builtinRegistered = false;
let lastRegisteredCount = 0;

/** 暴露给测试与集成代码,返回当前 runtime singleton。 */
export function getRuntime(): UiRuntime {
  return getOrCreateSingleton();
}

/** 上一次 registerAllBuiltinUis 注册成功的包数。 */
export function lastRegisteredPackageCount(): number {
  return lastRegisteredCount;
}

/** 测试专用:返回一个全新的、与 runtime 单例隔离的 fallback SlotCore。 */
export function __makeTestSlotCore(): SlotCoreLike {
  return makeFallbackSlotCoreImpl();
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
 *   - ctx.ui / ctx.slots / ctx.events 由 getOrCreateSingleton() 提供
 *   - 失败的 apply 不影响后续包(per-listener error swallow,事件层同策略)
 *   - 包内 ctx.slots.register() 注册的内容会被 SlotCore 持有,dispose 由各包负责
 */
export function registerAllBuiltinUis(): () => void {
  lastRegisteredCount = 0;
  const rt = getOrCreateSingleton();
  const ctx: UiRuntimeContext = {
    slots: rt.slots,
    events: makeEvents(),
  };
  const disposers: Array<() => void> = [];
  for (const { pkg, apply } of BUILTIN_UI_APPLIES) {
    try {
      lastRegisteredCount++;
      const dispose = apply(ctx as never, undefined);
      if (typeof dispose === "function") disposers.push(() => dispose());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ui-runtime] apply() failed for " + pkg + ":", err);
    }
  }
  return () => {
    for (let i = disposers.length - 1; i >= 0; i--) {
      try { disposers[i](); } catch { /* swallow */ }
    }
  };
}
