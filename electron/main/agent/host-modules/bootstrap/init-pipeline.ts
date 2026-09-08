/**
 * host-modules/bootstrap/init-pipeline.ts
 *
 * v6-E — Orchestrator for agent-host.ts:initialize() 8-stage bootstrap.
 *
 * 背景:
 *   agent-host.ts:initialize() 在 v5 终点仍有 ~100 行 8-stage 编排:
 *     1. bootstrapSessionEventLog (disk replay)
 *     2. bootstrapModelRuntime (auth + provider tracker)
 *     3. installMicrokernelHost (35 个 host-module install)
 *     4. new Context() + wireContextServices + wireDshServices + wireForwardedEvents + context.start()
 *     5. setupProfileOptions + (optional) installDefaultPiPackages
 *     6. initProfile + initPluginLoader + initDeepSeek
 *     7. computeActiveAdapterIds + injectSystemPromptSections + initSession
 *     8. emitPluginEvent("plugin/ready")
 *
 *   这些步骤分散在 agent-host.ts 顶部 ~30 个 import + 100 行函数体内,
 *   不利于:
 *     - 阅读 (要追 8 个 stage 调用, 跨越 import 块)
 *     - 测试 (orchestrator logic 不可单独测试)
 *     - 修改 (新增 stage 需要修改 agent-host.ts 顶部 import + 函数体 2 处)
 *
 * 设计:
 *   - `runInitPipeline(deps)` 接受 30+ 参数, 内部按 8 stage 顺序执行
 *   - deps 通过 DI 注入 (而不是 module-level singleton), 保持 reverse-dep invariant
 *   - agent-host.ts:initialize() 改为 5 行 wrapper (early-return + dispose + runInitPipeline)
 *
 * v6-E 收益: agent-host.ts -100 行, 编排逻辑独立可测试.
 */

import type { Context } from "@openbuddy/cordis";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentHostState } from "../_state-shape";
import type { InstallHostModuleDeps } from "./install-host-modules";
import type { ElectronHarnessPluginLoader } from "../profile/loader";
import type { PluginStateStore } from "@openbuddy/plugin-host";
import type { PiToolRegistry } from "../_state-shape";

export interface InitPipelineDeps {
  // State + path helpers
  state: AgentHostState;
  cwd: () => string;
  piHome: () => string;
  isPathWithin: (root: string, candidate: string) => boolean;
  piSessionDir: (cwd: string) => string;
  // Event emitters
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  // Lifecycle
  getMicrokernelHostDeps: () => Record<string, unknown>;
  installMicrokernelHost: (deps: InstallHostModuleDeps) => void;
  // Stage helpers
  bootstrapSessionEventLog: (state: AgentHostState, cwd: string) => Promise<void>;
  bootstrapModelRuntime: (state: AgentHostState) => Promise<void>;
  createToolRegistry: (onChange?: () => void) => unknown;
  createPiRuntime: () => unknown;
  createPiSessionFacade: () => unknown;
  refreshPiExtensions: () => void;
  createJobsRegistry: (deps: { state: AgentHostState; emitPluginEvent: (type: string, payload: unknown) => void }) => unknown;
  wireContextServices: (deps: unknown) => void;
  wireDshServices: (deps: unknown) => void;
  wireForwardedEvents: (deps: { state: AgentHostState; context: Context; emitRendererEvent: (channel: string, payload: unknown) => void; emitPluginEvent: (type: string, payload: unknown) => void }) => void;
  setupProfileOptions: (deps: { env: NodeJS.ProcessEnv }) => Promise<{ resolvedProfile: unknown; profileOptions: unknown }>;
  ensureDefaultPiPackages?: (deps: { profileDir: string }) => Promise<Array<{ status: string; spec?: string; error?: string }>>;
  initProfile: (deps: unknown) => Promise<{ profileBundle: unknown; profilePackageJson: string }>;
  initPluginLoader: (deps: unknown) => Promise<{ loader: { list(): unknown[] }; pluginState: unknown }>;
  initDeepSeek: (deps: unknown) => Promise<void>;
  computeActiveAdapterIds: (deps: { state: AgentHostState }) => string[];
  injectSystemPromptSections: (deps: unknown) => Promise<void>;
  initSession: (deps: unknown) => Promise<void>;
  // Session-specific helpers
  prompt: (text: string, options?: unknown) => Promise<unknown>;
  steer: (text: string, options?: unknown) => Promise<unknown>;
  followUp: (text: string, options?: unknown) => Promise<unknown>;
  abort: (options?: unknown) => Promise<unknown>;
  getModel: () => unknown;
  setModel: (modelId: string, options?: unknown) => Promise<unknown>;
  newSession: (cwd: string, modelId?: string, options?: unknown) => Promise<unknown>;
  loadSession: (sessionId: string, cwd: string, options?: unknown) => Promise<void>;
  listSessions: (cwd: string) => Promise<unknown>;
  listAllPiSessions: () => Promise<unknown>;
  listPersistedSessionHeadersImpl: () => Promise<unknown>;
  appendPersistedSessionEntriesImpl: (sessionId: string, entries: unknown[]) => Promise<unknown>;
  appendLifecycleSessionEntryImpl: (sessionId: string, entry: unknown) => Promise<unknown>;
  reserveDeepSeekPreparation: (deps: unknown) => Promise<unknown>;
  reserveDeepSeekAgent: (deps: unknown) => Promise<unknown>;
  createDeepSeekAgent: (options: unknown) => Promise<unknown>;
  resumeDeepSeekAgent: (options: unknown) => Promise<unknown>;
  createTeamRunner: (modelRuntime: ModelRuntime, cwd: string, getModel: () => unknown) => unknown;
  openBuddyCorePlugin: unknown;
  listSubagentChildren: (parentSessionId: string) => Promise<unknown>;
  listCommands: () => unknown[];
  listPluginInventory: () => Promise<unknown>;
  listPlugins: () => unknown[];
  listDshFileReferences: () => Promise<unknown>;
  listRunningTasks: () => unknown[];
  killTask: (taskId: string) => Promise<void>;
  remoteServiceContext: () => unknown;
  transitionDshGoal: (deps: unknown) => Promise<unknown>;
  resolveDeepSeekModule: unknown;
  openBuddyCapabilityPluginIndex: unknown;
  baseUrl: string;
  describeCompatibilityAdapterCommandsMarkdown: () => string;
  emitPiSessionEvent: (channel: string, payload: unknown) => void;
  captureFileSnapshot: (sessionId: string, toolCallId: string, toolName: string, args: unknown) => Promise<unknown>;
  sessionPresetSelection: (sessionPath?: string | null) => Promise<string | null | undefined>;
  mountConfiguredAgentPreset: (deps: unknown) => Promise<unknown>;
  startProfileWatchers: () => Promise<void>;
  refreshMarketplacePiResourcePaths: () => Promise<void>;
  configurePiExtensions: (deps: unknown) => Promise<unknown>;
  reportPiExtensionErrors: (deps: unknown) => Promise<unknown>;
  syncMarketplacePiExtensionStatuses: () => Promise<unknown>;
  nativePiResourcePaths: () => unknown;
  persistPiSessionHeaderImpl: (deps: unknown) => Promise<void>;
  piSessionRuntime: unknown;
  publicQueueItems: (activeSession: unknown) => readonly unknown[];
  eventNamespace: string;
  canonicalEventNamespace: string;
  createOpenBuddyRpcUiContext: () => unknown;
  questionAnswer: (value: unknown, questionKey?: string) => string | undefined;
  piResources: unknown;
  refreshPiExtensionsFn: () => void;
  sessionPath?: string;
  // Optional helpers supplied by agent-host.ts when wiring profile stages.
  setProfilePiResourcePaths?: (paths: unknown) => void;
  reconcileProfileArtifacts?: () => Promise<void>;
  // Stage 8 (emit plugin ready)
  emitPluginReadyEvent: (payload: { count: number }) => void;
}

/**
 * 8-stage bootstrap orchestrator. Returns the freshly-created Cordis Context
 * so the caller can attach extra services or call .start() with custom timing.
 */
export async function runInitPipeline(deps: InitPipelineDeps): Promise<Context> {
  // DIAG: stage marker
  console.log("[openbuddy-diag] init-pipeline stage=1 ENTER (SessionEventLog)");
  // Stage 1: SessionEventLog hydration (disk replay required for harness
  // server's `since=` query across Electron restarts).
  await deps.bootstrapSessionEventLog(deps.state, deps.cwd());
  console.log("[openbuddy-diag] init-pipeline stage=1 DONE");

  console.log("[openbuddy-diag] init-pipeline stage=2 ENTER (ModelRuntime)");
  // Stage 2: ModelRuntime + auth sync + provider registry tracker.
  await deps.bootstrapModelRuntime(deps.state);
  console.log("[openbuddy-diag] init-pipeline stage=2 DONE");
  const modelRuntime = deps.state.modelRuntime as ModelRuntime;

  // Stage 3: Install all 35 host-modules via the microkernel host.
  console.log("[openbuddy-diag] init-pipeline stage=3 ENTER (installMicrokernelHost)");
  deps.installMicrokernelHost({
    ...deps.getMicrokernelHostDeps(),
    state: deps.state,
  } as unknown as InstallHostModuleDeps);
  console.log("[openbuddy-diag] init-pipeline stage=3 DONE");

  // Stage 4: Create Cordis Context + wire core services.
  console.log("[openbuddy-diag] init-pipeline stage=4 ENTER (Context)");
  const context = new (await import("@openbuddy/cordis")).Context();
  deps.state.toolRegistry = deps.createToolRegistry(deps.refreshPiExtensionsFn) as PiToolRegistry;
  deps.state.toolRegistryRevision = 0;
  const piRuntime = deps.createPiRuntime();
  const piSession = deps.createPiSessionFacade();
  context.provide("eventLog", {
    list: (query?: { sessionId?: string; sinceSequence?: number; limit?: number }) =>
      deps.state.sessionEventLog?.snapshot(query) ?? [],
    lastSequence: () => deps.state.sessionEventLog?.lastSequence() ?? deps.state.eventSequence,
  });
  const jobs = deps.createJobsRegistry({ state: deps.state, emitPluginEvent: deps.emitPluginEvent });
  deps.wireContextServices({
    cwd: deps.cwd(), state: deps.state, context, modelRuntime, piRuntime, piSession, jobs,
    prompt: deps.prompt, steer: deps.steer, followUp: deps.followUp, abort: deps.abort,
    getModel: deps.getModel, setModel: deps.setModel,
    newSession: deps.newSession, loadSession: deps.loadSession,
    listSessions: deps.listSessions, listAllPiSessions: deps.listAllPiSessions,
    listPersistedSessionHeadersImpl: deps.listPersistedSessionHeadersImpl,
    appendPersistedSessionEntriesImpl: deps.appendPersistedSessionEntriesImpl,
    appendLifecycleSessionEntryImpl: deps.appendLifecycleSessionEntryImpl,
    reserveDeepSeekPreparation: deps.reserveDeepSeekPreparation,
    reserveDeepSeekAgent: deps.reserveDeepSeekAgent,
    createDeepSeekAgent: deps.createDeepSeekAgent, resumeDeepSeekAgent: deps.resumeDeepSeekAgent,
    createTeamRunner: deps.createTeamRunner,
    openBuddyCorePlugin: deps.openBuddyCorePlugin,
    listSubagentChildren: deps.listSubagentChildren,
  });
  deps.wireDshServices({
    context, state: deps.state, cwd: deps.cwd(),
    listCommands: deps.listCommands, listPluginInventory: deps.listPluginInventory, listPlugins: deps.listPlugins,
    listDshFileReferences: deps.listDshFileReferences,
    listSessions: deps.listSessions, listRunningTasks: deps.listRunningTasks, killTask: deps.killTask,
    remoteServiceContext: deps.remoteServiceContext, transitionDshGoal: deps.transitionDshGoal,
  });
  deps.state.context = context;
  deps.wireForwardedEvents({ state: deps.state, context, emitRendererEvent: deps.emitRendererEvent, emitPluginEvent: deps.emitPluginEvent });
  await context.start();
  console.log("[openbuddy-diag] init-pipeline stage=4 DONE");

  // Stage 5: Profile options + opt-in default Pi package install.
  console.log("[openbuddy-diag] init-pipeline stage=5 ENTER (ProfileOptions)");
  let profilePackageJson: string | undefined;
  const { resolvedProfile, profileOptions } = await deps.setupProfileOptions({ env: process.env });
  if (process.env.OPENBUDDY_INSTALL_DEFAULT_PI === "1" && (profileOptions as { profileDir?: string })?.profileDir) {
    void deps.ensureDefaultPiPackages?.({ profileDir: (profileOptions as { profileDir: string }).profileDir })
      .then((results) => {
        const failed = results.filter((r) => r.status === "failed");
        const installed = results.filter((r) => r.status === "installed");
        if (installed.length || failed.length) {
          console.log(
            `[openbuddy] default Pi bundle: installed=${installed.length} skipped=${results.filter((r) => r.status === "skipped").length} failed=${failed.length}`,
            failed.map((r) => `${r.spec}: ${r.error}`),
          );
        }
      })
      .catch((error) => {
        console.warn("[openbuddy] default Pi bundle install failed:", error);
      });
  }

  // Stage 6: Materialize profile + load plugin loader + init DeepSeek bridge.
  console.log("[openbuddy-diag] init-pipeline stage=5 DONE");
  console.log("[openbuddy-diag] init-pipeline stage=6 ENTER (initProfile)");
  const { profileBundle, profilePackageJson: materializedProfilePackageJson } = await deps.initProfile({
    state: deps.state, resolvedProfile, profileOptions,
    piHome: deps.piHome, emitPluginEvent: deps.emitPluginEvent,
    setProfilePiResourcePaths: deps.setProfilePiResourcePaths,
    startProfileWatchers: deps.startProfileWatchers,
  });
  profilePackageJson = materializedProfilePackageJson;
  const { loader, pluginState } = await deps.initPluginLoader({
    state: deps.state, cwd: deps.cwd(), context, baseUrl: deps.baseUrl,
    emitPluginEvent: deps.emitPluginEvent,
    resolveDeepSeekModule: deps.resolveDeepSeekModule,
    openBuddyCorePlugin: deps.openBuddyCorePlugin,
    openBuddyCapabilityPluginIndex: deps.openBuddyCapabilityPluginIndex,
  });
  deps.state.loader = loader as ElectronHarnessPluginLoader;
  deps.state.pluginState = pluginState as PluginStateStore;
  console.log("[openbuddy-diag] init-pipeline stage=6.5 ENTER (initDeepSeek)");
  await deps.initDeepSeek({
    state: deps.state, context, loader, profileBundle, baseUrl: deps.baseUrl,
    emitPluginEvent: deps.emitPluginEvent, emitRendererEvent: deps.emitRendererEvent,
    remoteServiceContext: deps.remoteServiceContext, reconcileProfileArtifacts: deps.reconcileProfileArtifacts,
  });

  // Stage 7: Compute active adapter IDs + inject system prompt + init session.
  console.log("[openbuddy-diag] init-pipeline stage=6.5 DONE");
  console.log("[openbuddy-diag] init-pipeline stage=7 ENTER (computeActiveAdapterIds + initSession)");
  const activeAdapterIds = deps.computeActiveAdapterIds({ state: deps.state });
  await deps.injectSystemPromptSections({
    cwd: deps.cwd(), context: deps.state.context!, piResources: deps.piResources,
    describeCompatibilityAdapterCommandsMarkdown: deps.describeCompatibilityAdapterCommandsMarkdown,
    activeAdapterIds,
  });
  await deps.initSession({
    state: deps.state, context, loader, cwd: deps.cwd(), modelRuntime, sessionPath: deps.sessionPath,
    emitPluginEvent: deps.emitPluginEvent, emitRendererEvent: deps.emitRendererEvent,
    emitPiSessionEvent: deps.emitPiSessionEvent, captureFileSnapshot: deps.captureFileSnapshot,
    sessionPresetSelection: deps.sessionPresetSelection,
    mountConfiguredAgentPreset: deps.mountConfiguredAgentPreset,
    startProfileWatchers: deps.startProfileWatchers,
    refreshMarketplacePiResourcePaths: deps.refreshMarketplacePiResourcePaths,
    configurePiExtensions: deps.configurePiExtensions,
    reportPiExtensionErrors: deps.reportPiExtensionErrors,
    syncMarketplacePiExtensionStatuses: deps.syncMarketplacePiExtensionStatuses,
    nativePiResourcePaths: deps.nativePiResourcePaths,
    persistPiSessionHeaderImpl: deps.persistPiSessionHeaderImpl,
    piSessionRuntime: deps.piSessionRuntime,
    publicQueueItems: deps.publicQueueItems,
    eventNamespace: deps.eventNamespace,
    canonicalEventNamespace: deps.canonicalEventNamespace,
    createOpenBuddyRpcUiContext: deps.createOpenBuddyRpcUiContext,
    questionAnswer: deps.questionAnswer,
    piHome: deps.piHome, piSessionDir: deps.piSessionDir,
    createTeamRunner: deps.createTeamRunner,
  });

  // Stage 8: emit plugin/ready event so renderer can subscribe.
  console.log("[openbuddy-diag] init-pipeline stage=7 DONE");
  console.log("[openbuddy-diag] init-pipeline stage=8 ENTER (emitPluginReadyEvent)");
  deps.emitPluginReadyEvent({ count: loader.list().length });
  console.log("[openbuddy-diag] init-pipeline stage=8 DONE");

  return context;
}
