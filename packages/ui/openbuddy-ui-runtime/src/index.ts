/**
 * @openbuddy/ui-runtime — 统一对外入口
 *
 * UI 运行时层。提供 SlotProvider、SlotTree、Store 注入、PropsRuntime 装配与 ui-* 包的自动注册入口。
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
import type { SlotMap } from "@openbuddy/ui-slots";
import type { Context } from "@openbuddy/cordis";
import type { RendererPlugin } from "@openbuddy/renderer-host";
import type { SlotCoreLike, UiPlugin } from "@openbuddy/ui-slots";

export type { SlotCoreLike, UiPlugin, UiRuntimeContext } from "@openbuddy/ui-slots";
export type {
  RendererPlugin,
  RendererPluginEntry,
  RendererPluginStatus,
  HarnessTransport,
  ClientModuleSystem,
} from "@openbuddy/renderer-host";

/** Session record exposed by ui-runtime. Mirrors deepseek-harness SessionRecord. */
export interface SessionRecord {
  id: string;
  cwd: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  modelId?: string;
}

/** Workspace record. */
export interface WorkspaceRecord {
  id: string;
  cwd: string;
  name?: string;
}

/** A subscription / dispatch face for sessions / workspaces (mirrors HostObservable). */
export interface Observable<T> {
  getSnapshot(): T;
  subscribe(fn: () => void): () => void;
}

/** The runtime's session/workspace/theme/locale/slots surface. */
export interface UiRuntime {
  slots: SlotCoreLike;
  sessions: Observable<readonly SessionRecord[]>;
  workspaces: Observable<readonly WorkspaceRecord[]>;
  /** Resolve a SessionRecord by id (sync read; absent -> undefined). */
  session(id: string): SessionRecord | undefined;
  /** Load a builtin @openbuddy/ui-* plugin into the SlotProvider. */
  registerBuiltinUi(plugin: UiPlugin | RendererPlugin): Promise<() => Promise<void>>;
  /** Apply a discovered remote plugin (e.g. from dsh.client boot graph). */
  applyRemotePlugin(entry: RendererPlugin | UiPlugin): Promise<() => Promise<void>>;
  /** Tear down the runtime; safe to call on HMR. */
  dispose(): void;
}

declare module "@openbuddy/cordis" {
  interface Context {
    /** UI-tier runtime services aggregated into a single handle. */
    ui: UiRuntime;
  }
}

declare module "@openbuddy/ui-slots" {
  interface GlobalStandardProps {
    useUiRuntime(): UiRuntime;
    useSlot<K extends string>(name: K): {
      entries: readonly unknown[];
      spec: unknown;
    };
    useSession(): SessionRecord | undefined;
    useSessions(): readonly SessionRecord[];
    useWorkspaces(): readonly WorkspaceRecord[];
  }
}
