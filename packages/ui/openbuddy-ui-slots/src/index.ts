/**
 * @openbuddy/ui-slots — 统一对外入口
 *
 * 槽位系统类型契约层。声明 SlotMap、UiPlugin、PropsRuntime 等核心类型,并通过声明合并让所有 ui-* 包自动获得槽位注册能力。是整个 UI 插件体系的根基。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染
 *   - 公共工具 (Utilities)    → 函数 / 常量 / hooks,无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
export type SlotKind = "single" | "list" | "keyed" | "chain";
export type SlotScope = "root" | "session-maybe" | "session";

/** SlotMap — owners extend via `declare module "@openbuddy/ui-slots"`. */
export interface SlotMap {}

/** LocaleNamespaceMap — mirrors SlotMap for i18n dictionaries. */
export interface LocaleNamespaceMap {
  common: string;
}

/** A registered SlotMap entry: kind/scope axes + optional owner/inject faces. */
export interface SlotEntryDef {
  kind: SlotKind;
  scope: SlotScope;
  owner?: object;
  /** Optional keyed-entry prop table (for kind="keyed" slots). */
  keyProps?: Record<string, object>;
  /** Optional opaque per-render occurrence context. */
  hookContext?: unknown;
  /** Optional slot-level inject face (all registered entries receive it). */
  inject?: object;
}

/** Runtime dispatch spec recorded from a register() children value. */
export type SlotSpec<E extends SlotEntryDef = SlotEntryDef> = {
  kind: E["kind"];
  scope: E["scope"];
} & ("inject" extends keyof E
  ? E extends { inject: infer Injected extends object }
    ? { inject: Injected }
    : { inject?: object }
  : { inject?: never });

/** Child-slot declaration table for register(): keys are declared slot names. */
export type ChildrenDecl = {
  [P in string]?: SlotSpec;
};

/** Owner-supplied props share (a slot key's SlotMap entry). Defaults to empty object. */
export type OwnerOf<_K extends string = string> = object;

/** Registration/dispatch key domain of one keyed slot. Defaults to string. */
export type EntryKeyOf<_K extends string = string> = string;

/** Key-dependent props supplied by the owner at one keyed dispatch site. Defaults to empty object. */
export type KeyPropsOf<_K extends string = string, _EntryKey extends string = string> = object;

/** Scope axis of a slot key's SlotMap entry. Defaults to "root". */
export type ScopeOf<_K extends string = string> = SlotScope;

/**
 * Standard kit delivered to every session-scope slot component. Empty here;
 * the runtime package merges the real members.
 */
export interface SessionStandardProps {}

/** Standard kit delivered to current-session-optional slots. */
export interface SessionMaybeStandardProps {}

/** Standard kit delivered to EVERY slot component (the global seat). */
export interface GlobalStandardProps {}

/** Standard kit merged into PropsRuntime: session kit if scope is session or session-maybe; global kit always. */
export type StandardKit<S extends SlotScope> =
  S extends "session" ? SessionStandardProps :
  S extends "session-maybe" ? SessionMaybeStandardProps :
  GlobalStandardProps;

/** Children-render share: a typed renderSlot helper. */
export interface PropsRenderSlots {
  /** Render the named child slot. Typed against the declared children set. */
  renderSlot(key: string, props: object): unknown;
  /** Chain-routing helper for chain-kind slots (selector dispatch). */
  renderSlotChain?(opts: { ownerProps?: object }): unknown;
}

/**
 * Store seat declaration shape. The actual create()/getSnapshot()/actions
 * implementation lives in @openbuddy/ui-runtime (which wires to
 * renderer-host SlotCore). This is the type-only contract.
 */
export interface StoreDecl<S = unknown, A = unknown> {
  init: () => S;
  persist?: string;
  actions: A;
}

/** Draft-stripped callback form of an actions table. */
export type BakedActions<_T, A extends Record<string, (...args: never[]) => void>> = {
  [K in keyof A]: A[K] extends (...params: infer P) => void
    ? (...params: P) => void
    : never;
};

/** Store handle: spec + state types + instance factory in one value. */
export interface StoreHandle<T, A extends Record<string, (...args: never[]) => void>> {
  readonly spec: StoreDecl<T, A>;
  readonly actions: BakedActions<T, A>;
  getSnapshot(): T;
  subscribe(fn: () => void): () => void;
}

/** UseStore props the renderer binds from a StoreHandle. */
export interface PropsStore<H> {
  useStore: <S>(selector: (state: unknown) => S, eq?: (a: S, b: S) => boolean) => S;
  actions: H extends StoreHandle<unknown, infer A> ? BakedActions<unknown, A> : never;
}

/** Hooks compartment: registrants may contribute use<Name> selector hooks. */
export interface HooksCompartment {
  [name: string]: <S>(selector: (state: unknown) => S, eq?: (a: S, b: S) => boolean) => S;
}

/** Host-side observable API for standard-kit data sources. */
export interface HostObservable<T> {
  getSnapshot(): T;
  subscribe(fn: () => void): () => void;
}

/** Per-session standard props resolved per session id. */
export interface SessionProvideInfo {
  sessionId: string | undefined;
  hooks: Record<string, HostObservable<unknown> | undefined>;
  props: Record<string, unknown>;
}

/** Per-workspace standard props. */
export interface WorkspaceProvideInfo {
  workspaceId: string | undefined;
  hooks: Record<string, HostObservable<unknown> | undefined>;
  props: Record<string, unknown>;
}

/**
 * PropsRuntime: owner props + standard kit + session id (when applicable).
 * The four shares intersect to form a component's props:
 *   ComposedProps<K, EntryKey, D, H, I> =
 *     PropsRuntime<K> & PropsRenderSlots & PropsStore<H> & I
 */
export type PropsRuntime<K extends string = string> =
  OwnerOf<K> & StandardKit<ScopeOf<K>> & {
    /** Current session id when scope is "session" or "session-maybe"; undefined for "root". */
    sessionId?: ScopeOf<K> extends "root" ? never : string | undefined;
    /** Current workspace id when scope includes workspace binding. */
    workspaceId?: string | undefined;
  };

/**
 * ComposedProps — the intersection of the four shares.
 */
export type ComposedProps<
  K extends string = string,
  EntryKey = string,
  _D extends string = string,
  H = unknown,
  I extends object = object
> =
  PropsRuntime<K>
  & PropsRenderSlots
  & (H extends StoreHandle<unknown, infer _A>
      ? PropsStore<H> & { matched?: EntryKey }
      : object)
  & I;

/**
 * The dispatch interface a slot renderer's runtime-side SlotCore exposes
 * (this is a type contract; the real implementation lives in renderer-host).
 */
export interface SlotCoreLike {
  register(options: {
    name: string;
    /** Slot dispatch kind. Defaults to "single". */
    kind?: SlotKind;
    /** Slot scope axis. Defaults to "root". */
    scope?: SlotScope;
    /** Keyed entry key (kind="keyed" 时必填,作为 Map 的 key)。 */
    key?: string;
    /** 优先级;list kind 下数字大者后渲染,keyed kind 下数字大者覆盖低优先级。 */
    priority?: number;
    children?: ChildrenDecl;
    store?: StoreDecl | (() => StoreHandle<unknown, Record<string, (...args: never[]) => void>>);
    inject?: (ctx: unknown) => object;
    locale?: string;
    registrant?: string;
  }, component: unknown): () => void;
  inject(name: string, register: () => () => void): () => void;
  /** 默认 entries:按 kind 返回单组件 / 列表 / Map。 */
  entries(name: string): readonly unknown[];
  /** keyed 模式下按 key 查单个组件。 */
  entryForKey?(name: string, key: string): unknown | undefined;
  /** chain 模式下返回包装后的最终组件(从外到内逐层包)。 */
  chain?(name: string): unknown | undefined;
  spec(name: string): SlotSpec | undefined;
  /**
   * 订阅指定 slot 的 entries 变化。监听函数在 slot 注册 / 注销时被调用一次,
   * 返回 disposer 用于取消订阅。可选方法;兼容现有实现,AppFrame 等消费者
   * 用它替代 setInterval 轮询来减少空载时的重渲染。
   */
  subscribe?(name: string, listener: () => void): () => void;
}

/** A plugin's apply() receives a renderer context with at least these services. */
export interface UiRuntimeContext {
  slots: SlotCoreLike;
  events: { on(name: string, listener: (...args: unknown[]) => void): () => void };
}

/** Standard plugin shape for every @openbuddy/ui-* package. */
export interface UiPlugin {
  name?: string;
  /** Apply the plugin to the runtime. Returns a disposer. */
  apply: (ctx: UiRuntimeContext, config?: unknown) => () => void | Promise<() => void>;
}

export type { SlotCoreLike as SlotCore };

export {};
