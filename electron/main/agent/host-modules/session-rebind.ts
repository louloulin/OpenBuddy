/**
 * host-modules/session-rebind.ts — session 热重绑定 (warm-host rebind).
 *
 * Phase 8.3 Batch D-14: 提取 agent-host.ts:1944-2008 中的
 *   - `rebindSession` (~65 行)
 *
 * rebindSession 是 warm-host 路径的核心 — 当用户从 "新建会话" 按钮或 IPC
 * 切到一个已存在的会话文件时, 如果 cwd/preset/context 与当前一致, 我们
 * 不再走 ~2-5s 的完整 `initialize()`, 而是直接用现有 resourceLoader + context
 * 快速替换 session (~50ms).
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 InstallSessionRebindDeps 参数注入
 *
 * 设计: 沿用 module-level singleton + install pattern — 与 plugin-mutations,
 * profile-reload-transaction, pi-extension-configure 保持一致.
 */

import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

let initializeImpl: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void> = async () => undefined;
let sessionPresetSelectionImpl: (sessionPath?: string | null) => Promise<string | null | undefined> = async () => undefined;
let replaceSessionImpl: (opts: any) => Promise<any> = async () => undefined;
let sessionManagerOpenImpl: (sessionPath: string, options: any, cwd: string) => any = () => ({});
let agentHomeImpl: () => string = () => "";
let provideRpcUiContextImpl: (deps: any) => any = () => undefined;
let emitPluginEventImpl: (type: string, payload: unknown) => void = () => undefined;
let emitRendererEventImpl: (channel: string, payload: unknown) => void = () => undefined;
let questionAnswerImpl: (value: any, questionKey?: string) => string | undefined = () => undefined;
let createOpenBuddyRpcUiContextImpl: (deps: any) => any = () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallSessionRebindDeps {
  state: AgentHostState;
  initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void>;
  sessionPresetSelection: (sessionPath?: string | null) => Promise<string | null | undefined>;
  /**
   * PiSessionRuntime.replace — returns a new AgentSession with the same
   * resource loader / context as the current one.
   */
  replaceSession: (opts: any) => Promise<any>;
  /**
   * SessionManager.open factory — wrapped to allow tests to stub fs
   * operations that would otherwise mkdir real directories.
   */
  sessionManagerOpen: (sessionPath: string, options: any, cwd: string) => any;
  agentHome: () => string;
  provideRpcUiContext: (deps: any) => any;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  questionAnswer: (value: any, questionKey?: string) => string | undefined;
  createOpenBuddyRpcUiContext: (deps: any) => any;
}

/**
 * 一次性 install 所有 session-rebind 依赖.
 *
 * 必须在 `agent-host.ts:initialize()` 早期 (state 已初始化, piSessionRuntime
 * 已构造) 调用.
 */
export function installSessionRebind(deps: InstallSessionRebindDeps): void {
  state = deps.state;
  initializeImpl = deps.initialize;
  sessionPresetSelectionImpl = deps.sessionPresetSelection;
  replaceSessionImpl = deps.replaceSession;
  sessionManagerOpenImpl = deps.sessionManagerOpen;
  agentHomeImpl = deps.agentHome;
  provideRpcUiContextImpl = deps.provideRpcUiContext;
  emitPluginEventImpl = deps.emitPluginEvent;
  emitRendererEventImpl = deps.emitRendererEvent;
  questionAnswerImpl = deps.questionAnswer;
  createOpenBuddyRpcUiContextImpl = deps.createOpenBuddyRpcUiContext;
}

/** 测试/调试用: 重置模块级单例回到 stub. */
export function __resetSessionRebindForTest(): void {
  state = null;
  initializeImpl = async () => undefined;
  sessionPresetSelectionImpl = async () => undefined;
  replaceSessionImpl = async () => undefined;
  sessionManagerOpenImpl = () => ({});
  agentHomeImpl = () => "";
  provideRpcUiContextImpl = () => undefined;
  emitPluginEventImpl = () => undefined;
  emitRendererEventImpl = () => undefined;
  questionAnswerImpl = () => undefined;
  createOpenBuddyRpcUiContextImpl = () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 把当前 session 快速切换到另一个 session 文件.
 *
 * 与 `initialize()` 的差异:
 *   - 当 cwd + preset + context 都匹配时, 复用现有 resourceLoader / context,
 *     只替换 PiSessionManager (~50ms)
 *   - 否则降级到 `initialize({ cwd, sessionPath })` (~2-5s)
 *
 * 注: cwd-scoped 或 preset-scoped 的 host state 不能热切换 (它们 baked
 * into resource loader / preset runtime), 所以不匹配时必须 fall back.
 */
export async function rebindSession(sessionPath: string, cwd: string): Promise<void> {
  if (!state) throw new Error("session-rebind: not installed");

  const context = state.context;
  const modelRuntime = state.modelRuntime;
  const resourceLoader = state.piResourceLoader;

  // Fallback 1: missing core services — must do full initialize.
  if (!state.session || !context || !modelRuntime || !resourceLoader) {
    await initializeImpl({ cwd, sessionPath });
    return;
  }

  // Fallback 2: cwd changed — host state is cwd-scoped, can't swap.
  if (state.cwd !== cwd) {
    await initializeImpl({ cwd, sessionPath });
    return;
  }

  // Empty / unreadable session files carry no preset hint. Treat them as
  // "inherit whatever is already mounted" instead of falling back to a
  // full initialize() — otherwise every "新建会话" click with a default
  // preset configured would re-bootstrap the entire agent host (~2-5s)
  // instead of taking the ~50ms warm-host rebind path.
  const mountedPresetId = state.presetSessionRuntime?.id ?? null;
  const probedPreset = await sessionPresetSelectionImpl(sessionPath);
  const targetPresetId = probedPreset === undefined || probedPreset === null
    ? mountedPresetId
    : probedPreset;
  if (targetPresetId !== mountedPresetId) {
    await initializeImpl({ cwd, sessionPath });
    return;
  }

  // Hot path: replace the session manager without re-bootstrapping the host.
  const session = await replaceSessionImpl({
    cwd,
    agentDir: agentHomeImpl(),
    noTools: "builtin",
    modelRuntime,
    sessionManager: sessionManagerOpenImpl(sessionPath, undefined, cwd),
    resourceLoader,
  });

  state.session = session;
  state.model = session.model;
  state.queueMirror = [];
  context.provide("piSessionRaw", session);
  context.provide("piExtensionApi", session);

  const uiContext = provideRpcUiContextImpl({
    context,
    session,
    state,
    emitPluginEvent: emitPluginEventImpl,
    emitRendererEvent: emitRendererEventImpl,
    questionAnswer: questionAnswerImpl,
    createOpenBuddyRpcUiContext: createOpenBuddyRpcUiContextImpl,
  });

  // Phase 5 — fire-and-forget the bind so `agent:new-session` IPC returns
  // the sessionId immediately. Mutating IPCs await `state.extensionsBound`
  // before issuing their own RPC. See line 217 for the slot contract.
  state.extensionsBound = session
    .bindExtensions({ uiContext, mode: "rpc" })
    .catch((err: unknown) => {
      console.warn("[openbuddy] bindExtensions failed", err);
    });

  context.emit("pi/ready", { sessionId: session.sessionId, cwd });
  emitPluginEventImpl("session/created", { sessionId: session.sessionId, cwd });

  try {
    if (!session.sessionManager.getSessionName()) session.setSessionName("OpenBuddy");
  } catch {
    // Session naming is optional across Pi releases.
  }
}
