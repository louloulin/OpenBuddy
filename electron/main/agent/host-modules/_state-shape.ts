/**
 * host-modules/_state-shape.ts — AgentHostState 接口 (纯类型).
 *
 * Phase 8.3 Architectural Refactor — 阶段 A1: 解决 26 个 host-modules
 * 对 agent-host.ts 的反向依赖.
 *
 * 为什么独立成文件:
 *   - AgentHostState 是一个 ~150 字段的 interface, 被 19 个 host-modules
 *     通过 `import { state } from "../agent-host"` 间接引用, 形成循环依赖.
 *   - 把 interface 单独提出来后, host-modules 可以只 import 这个 shape 而
 *     不需要 agent-host 的运行时代码 (state 单例留在 agent-host.ts 里).
 *   - 纯类型文件, 在 vitest / tsc 编译时会被擦除, 不会有运行时循环.
 *
 * 依赖方向 (修复后):
 *   host-modules/_state-shape.ts  ←  (零运行时依赖, 仅 type-only 导入)
 *       ↑                              ↑
 *   agent-host.ts                host-modules/*.ts (间接通过 state 引用)
 *
 * 设计原则:
 *   - 只放 interface / type, 不放 const / function / class.
 *   - 所有 type-only 导入 (使用 `import type` 或 `type {}` 内联),
 *     确保编译后是空模块, 不会触发运行时副作用.
 *   - 字段命名/类型完全照搬 agent-host.ts 第 193-326 行, 一字不改,
 *     保证 move-only refactor 不会引入行为差异.
 */

import type { FSWatcher } from "node:fs";

import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionFactory,
  ModelRuntime,
  DefaultResourceLoader,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { Context } from "@openbuddy/cordis";
import type {
  HarnessPluginLoader,
  PluginProfile,
  PluginPatch,
  OpenBuddyProfileOptions,
  OpenBuddyPiExtensionSpec,
  PluginCommitMarker,
  PluginReadinessPhase,
  RendererPluginManifestEntry,
  TypertHostContribution,
  PluginStateStore,
  DeepSeekCordisRuntime,
  DeepSeekCordisRuntimeSnapshot,
} from "@openbuddy/plugin-host";
import type { HarnessCursorStore } from "@openbuddy/storage";
import type {
  HookPermissionDecision,
  HookPermissionRequest,
  HookRuntimeConfig,
  HookShellRunner,
} from "../agent-hooks";
import type { PermissionRule } from "@openbuddy/auth-permission";
import type { PiExtensionStatus } from "../pi-extensions";
import type {
  ProviderRegistryRecord,
  ProviderRegistrySource,
} from "../agent-host-provider-registry";
import type { PluginTransactionContext } from "../plugin-lifecycle";
import type {
  RemoteDispatcher,
  RemoteContribution,
} from "../../harness/remote-dispatch";
import type { DeepSeekPiAgentRuntime } from "../../deepseek/deepseek-runtime";
import type {
  SessionEventLog,
  SessionEventRecord,
} from "../../session/session-event-log";
import type { SessionAttachmentStore } from "../../session/session-attachments";
import type { PresetSessionRuntime } from "../preset-session-runtime";
import type { TerminalRuntime } from "../../deepseek/terminal-runtime";
import type { SubprocessRuntime } from "../../deepseek/subprocess-runtime";

// Local-type re-exports so feature modules can `import type` from this
// single file without pulling in @openbuddy/plugin-host or pi-coding-agent.
// Mirrors the shapes originally declared inline in agent-host.ts so existing
// call sites that did `import type { Foo } from "../agent-host"` can switch
// to `import type { Foo } from "../host-modules/_state-shape"`.
export type AgentHostEventHandler = (event: AgentSessionEvent) => void;
export type AgentHostPluginEventHandler = (event: SessionEventRecord & { eventVersion: 1 }) => void;
export type {
  HookPermissionDecision,
  HookPermissionRequest,
  HookRuntimeConfig,
  HookShellRunner,
} from "../agent-hooks";
export type { PermissionRule } from "@openbuddy/auth-permission";
export type { PiExtensionStatus } from "../pi-extensions";
export type {
  ProviderRegistryRecord,
  ProviderRegistrySource,
} from "../agent-host-provider-registry";
export type { RemoteContribution } from "../../harness/remote-dispatch";
export type { RemoteDispatcher } from "../../harness/remote-dispatch";
export type { DeepSeekPiAgentRuntime } from "../../deepseek/deepseek-runtime";
export type { SessionEventLog } from "../../session/session-event-log";
export type { SessionAttachmentStore } from "../../session/session-attachments";
export type { PresetSessionRuntime } from "../preset-session-runtime";
export type { TerminalRuntime } from "../../deepseek/terminal-runtime";
export type { SubprocessRuntime } from "../../deepseek/subprocess-runtime";
export type { PluginTransactionContext } from "../plugin-lifecycle";

// PiToolRegistry is declared inline in agent-host.ts; mirror the structure
// here so host-modules can reference it via the single source of truth.
export interface PiToolRegistry {
  registerTool: (tool: ToolDefinition) => () => void;
  list: () => ToolDefinition[];
  listLocal?: () => ToolDefinition[];
}

/**
 * Discriminated union for a single piece of content sent to the Pi
 * `prompt()` API. Originally defined inline in agent-host.ts line 179;
 * promoted to a primitive type here so any feature module can import it
 * without going through agent-host.
 */
export type PiPromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; name?: string };

// PendingUiRequest + UiRequestValue used by question/permission IPC plumbing.
export type AgentHostPendingUiRequest = {
  kind: "question" | "permission";
  sessionId: string;
  resolve: (value: AgentHostUiRequestValue) => void;
  permission?: HookPermissionRequest;
};

export type AgentHostQuestionResponse = {
  answers: Record<string, string | string[]>;
  annotations: Record<string, { preview?: string; notes?: string }>;
};

export type AgentHostUiRequestValue =
  | string
  | boolean
  | AgentHostQuestionResponse
  | { decision: HookPermissionDecision }
  | undefined;

/**
 * The single source of truth for everything the agent host needs to
 * remember across `initialize()` / `dispose()` cycles.
 *
 * Field ownership is split:
 *   - "session-lifecycle" (session, model, cwd, …): reset by `dispose()`
 *   - "profile-load" (loader, profileBundle, …): reset on profile reload
 *   - "long-lived" (pluginReadiness, providerRegistry, …): persist across
 *     reloads so the UI does not flicker
 *
 * This interface is exported so that feature modules can type their
 * state accessors without re-declaring the shape. Concrete values live
 * in `state` (agent-host.ts). DO NOT add non-optional initializers
 * here — the runtime initializes them in `initialize()`.
 */
export interface AgentHostState {
  session: AgentSession | null;
  cwd: string | null;
  model: Model<any> | undefined;
  sessionUnsubscribe: (() => void) | null;
  /**
   * Phase 5 — Promise that resolves when `session.bindExtensions()` has
   * finished. Mutating IPC handlers (`agent:prompt`, `agent:set-model`,
   * …) must `await` this before issuing their RPC so they don't race
   * with the bind. `agent:new-session` does NOT await — it returns the
   * sessionId the moment `rebindSession` swaps the AgentSession, then
   * the bind runs in the background. The first `agent:prompt` after
   * a new-session naturally awaits `extensionsBound` so the user
   * sees a ~200ms earlier "new session created" toast with no behavioral
   * difference.
   */
  extensionsBound: Promise<void> | null;
  eventHandlers: Set<AgentHostEventHandler>;
  pluginEventHandlers: Set<AgentHostPluginEventHandler>;
  context: Context | null;
  loader: HarnessPluginLoader | null;
  deepSeekCordisRuntime: DeepSeekCordisRuntime | null;
  deepSeekCordisSnapshot: DeepSeekCordisRuntimeSnapshot | null;
  deepSeekPiToolSync: (() => void) | null;
  sessionEventLog: SessionEventLog | null;
  harnessCursorStore: HarnessCursorStore | undefined;
  scopeKey?: string;
  sessionTenantBindings?: Map<string, { tenantId: string; subject: string; boundAt: string }>;
  eventSequence: number;
  sessionSequences: Map<string, number>;
  toolRegistry: PiToolRegistry;
  pluginState: PluginStateStore | null;
  modelRuntime: ModelRuntime | null;
  piResourceLoader: DefaultResourceLoader | null;
  piRefreshPromise: Promise<void>;
  profileWatchers: FSWatcher[];
  profileReloadTimer: ReturnType<typeof setTimeout> | null;
  profileReloadPromise: Promise<void>;
  profileArtifactGeneration: number;
  activePluginTransactions: Map<string, PluginTransactionContext>;
  rendererPluginManifestCache: {
    generation: number;
    promise: Promise<RendererPluginManifestEntry[]>;
  } | null;
  profileOptions: OpenBuddyProfileOptions | null;
  profileBundle: PluginProfile | null;
  activePluginProfile: PluginProfile | null;
  profilePackageJson: string | undefined;
  profilePackagePaths: string[];
  profilePiExtensions: readonly OpenBuddyPiExtensionSpec[];
  profilePiPackagePaths: string[];
  profilePiResourcePaths: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  piNativeResourcePaths: {
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  piMarketplaceResourcePaths: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  piMarketplaceAgentFiles: Array<{ path: string; content: string }>;
  piExtensionPaths: string[];
  piExtensionFactories: Array<{ name: string; factory: ExtensionFactory; hidden: true }>;
  hookConfigs: HookRuntimeConfig[];
  piExtensionStatuses: PiExtensionStatus[];
  piExtensionOverrides: Record<string, { enabled?: boolean; config?: unknown }>;
  baseProfile: PluginProfile | null;
  storedLayers: PluginPatch[][];
  toolRegistryRevision: number;
  pendingUiRequests: Map<string, AgentHostPendingUiRequest>;
  hookPermissionSessionRules: Map<string, PermissionRule[]>;
  extensionEditorText: Map<string, string>;
  extensionToolsExpanded: Map<string, boolean>;
  runningTasks: Map<string, {
    id: string;
    kind: string;
    description: string;
    status: "running" | "completed" | "failed";
    sessionId?: string;
    startedAt: number;
    abortController?: AbortController;
  }>;
  jobsRegistry: Map<string, HostJobRecord>;
  continuableSubagents: Map<string, {
    id: string;
    parentSessionId: string;
    session: AgentSession;
    role: string;
    mode: "one-shot" | "continuable";
    startedAt: number;
    controller: AbortController;
    unsubscribe: () => void;
  }>;
  deepSeekAgents: Map<string, DeepSeekPiAgentRuntime>;
  capabilityEventBridgeUnsubscribe: (() => void) | null;
  typertRegistryUnsubscribe: (() => void) | null;
  remoteDispatcher: RemoteDispatcher;
  profileRemoteContributions: Map<string, RemoteContribution>;
  profileTypertContributions: Map<string, {
    contribution: TypertHostContribution;
    dispose: () => void;
    remoteDispose?: () => void;
  }>;
  pluginCommitGeneration: number;
  lastPluginCommitTransactionId?: string;
  lastPluginCommitMarker?: PluginCommitMarker;
  pluginReadiness: {
    phase: PluginReadinessPhase;
    generation: number;
    transaction?: { id: string; kind: string; target: string; phase?: string; surface?: string };
    error?: string;
  };
  /**
   * Tracks every provider id the active Pi runtime has registered. Each row
   * records whether the provider came from a profile-installed Pi extension
   * (and which extension path registered it), from `models.json`, or from
   * a built-in. The map is drained whenever `initialize()` resets the
   * runtime; otherwise entries survive `AgentSession.reload()` so the UI
   * does not lose attribution across reloads.
   */
  providerRegistry: Map<string, ProviderRegistryRecord>;
  queueMirror: Array<{
    content: Array<
      { type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }
    >;
    mode: "queue" | "steer";
  }> | null;
  attachmentStore: SessionAttachmentStore;
  presetSessionRuntime: PresetSessionRuntime | null;
  terminalRuntime: TerminalRuntime | null;
  subprocessRuntime: SubprocessRuntime | null;
}

/**
 * One job record surfaced via the `jobs` Cordis service. Mirrors the
 * shape registered by `state.jobsRegistry.set(...)` in initialize().
 */
export interface HostJobRecord {
  id: string;
  sessionId?: string;
  startedAt: number;
  finishedAt?: number;
  kind: string;
  description: string;
  status: "running" | "completed" | "failed";
  controller?: AbortController;
  stop?: () => void | Promise<void>;
  output?: string;
  error?: string;
}