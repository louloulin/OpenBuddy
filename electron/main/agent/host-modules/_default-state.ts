/**
 * host-modules/_default-state.ts — Default AgentHostState factory.
 *
 * Phase 8.3 Architectural Refactor — 阶段 D:
 * 解决"host-modules 在 install() 之前被访问导致 TypeError"的问题.
 *
 * 背景:
 *   - 每个 host-module 用 `let state: AgentHostState;` 持有运行时状态.
 *   - install() 之前 state 是 undefined, 调用任何访问 state 的 getter 都会
 *     抛 TypeError: Cannot read properties of undefined.
 *   - 真实场景: agent-host.ts:initialize() 是异步启动的, 但 registerIpc()
 *     在 app.whenReady() 同步注册 handler (agentHost.getModel() 等).
 *     handler 被 renderer 调用时 initialize() 可能还没完成.
 *   - 测试场景: realserver 测试不跑 initialize(), 直接调 handler, 必须
 *     返回合理默认值而不是抛错.
 *
 * 设计:
 *   - createDefaultAgentHostState() 创建一个所有字段都是"安全空值"的
 *     AgentHostState, 满足类型检查 + 不抛错.
 *   - 11 个 host-module 在 module-load 时初始化 `let state = createDefaultAgentHostState()`.
 *   - install() 把 state 替换成 agent-host 的真实 state, 之后行为不变.
 *   - agent-host.ts 也复用这个工厂 (而不是 inline object literal), 避免
 *     两边代码不同步.
 *
 * 依赖方向:
 *   _default-state.ts  ←  (类型 + 工具函数, 无 agent-host 反向依赖)
 *       ↑
 *   host-modules/*.ts, agent-host.ts
 *
 * 注意:
 *   - 这里的 default state 不是"完整初始化", 只是兜底. 真正启动后会被
 *     install() 替换掉.
 *   - attachmentStore 和 remoteDispatcher 这种需要外部依赖的对象, 用
 *     最小 stub. 任何依赖 default state 的代码不应假设这些 stub 完整可用.
 */

import { join } from "node:path";

import type { AgentHostState, AgentHostEventHandler, AgentHostPluginEventHandler } from "./_state-shape";

/**
 * Build a safe-empty AgentHostState. All required fields populated with
 * neutral defaults so any getter that accidentally reads before install()
 * returns a documented value rather than crashing.
 */
export function createDefaultAgentHostState(): AgentHostState {
  const eventHandlers = new Set<AgentHostEventHandler>();
  const pluginEventHandlers = new Set<AgentHostPluginEventHandler>();

  // Minimal tool registry stub. The real one in agent-host.ts has revision
  // tracking; the default just needs to satisfy .list() / .listLocal() /
  // .registerTool() with safe no-op semantics for realserver tests.
  const tools = new Map<string, never>();
  const toolRegistry = {
    registerTool: (tool: { name: string }) => {
      if (!tool?.name) throw new Error("openbuddy-tool: name is required");
      return () => true;
    },
    list: () => [...tools.values()],
    listLocal: () => [...tools.values()],
  };

  const baseResourcePaths = { extensions: [], skills: [], prompts: [], themes: [] } as const;

  return {
    session: null,
    cwd: null,
    model: undefined,
    sessionUnsubscribe: null,
    eventHandlers,
    pluginEventHandlers,
    context: null,
    loader: null,
    deepSeekCordisRuntime: null,
    deepSeekCordisSnapshot: null,
    deepSeekPiToolSync: null,
    sessionEventLog: null,
    harnessCursorStore: undefined,
    scopeKey: undefined,
    sessionTenantBindings: undefined,
    eventSequence: 0,
    sessionSequences: new Map(),
    toolRegistry,
    pluginState: null,
    modelRuntime: null,
    piResourceLoader: null,
    piRefreshPromise: Promise.resolve(),
    profileWatchers: [],
    profileReloadTimer: null,
    profileReloadPromise: Promise.resolve(),
    profileArtifactGeneration: 0,
    activePluginTransactions: new Map(),
    rendererPluginManifestCache: null,
    profileOptions: null,
    profileBundle: null,
    activePluginProfile: null,
    profilePackageJson: undefined,
    profilePackagePaths: [],
    profilePiExtensions: [],
    profilePiPackagePaths: [],
    profilePiResourcePaths: { extensions: [], skills: [], prompts: [], themes: [] },
    piNativeResourcePaths: { skills: [], prompts: [], themes: [] },
    piMarketplaceResourcePaths: baseResourcePaths,
    piMarketplaceAgentFiles: [],
    piExtensionPaths: [],
    piExtensionFactories: [],
    hookConfigs: [],
    piExtensionStatuses: [],
    piExtensionOverrides: {},
    baseProfile: null,
    storedLayers: [],
    toolRegistryRevision: 0,
    pendingUiRequests: new Map(),
    hookPermissionSessionRules: new Map(),
    extensionEditorText: new Map(),
    extensionToolsExpanded: new Map(),
    runningTasks: new Map(),
    jobsRegistry: new Map(),
    continuableSubagents: new Map(),
    deepSeekAgents: new Map(),
    capabilityEventBridgeUnsubscribe: null,
    typertRegistryUnsubscribe: null,
    // remoteDispatcher is normally constructed with a discovery callback;
    // the default keeps an empty stub so type-checks pass and .register() /
    // .unregister() / .dispatch() are no-ops (any IPC that needs real
    // dispatch should have run install() first).
    remoteDispatcher: {
      register: () => {},
      unregister: () => {},
      dispatch: async () => null,
    } as unknown as AgentHostState["remoteDispatcher"],
    profileRemoteContributions: new Map(),
    profileTypertContributions: new Map(),
    pluginCommitGeneration: 0,
    lastPluginCommitTransactionId: undefined,
    lastPluginCommitMarker: undefined,
    pluginReadiness: { phase: "idle", generation: 0 },
    providerRegistry: new Map(),
    queueMirror: null,
    // attachmentStore is type SessionAttachmentStore. The default uses a
    // minimal stub: any operation against it before install() is a test
    // artifact, not real user data. We point it at a tmp-style path so
    // .add() / .read() never touch real user state.
    attachmentStore: {
      add: async () => ({}),
      read: async () => null,
      remove: async () => false,
    } as unknown as AgentHostState["attachmentStore"],
    presetSessionRuntime: null,
    terminalRuntime: null,
    subprocessRuntime: null,
  } as unknown as AgentHostState;
}
