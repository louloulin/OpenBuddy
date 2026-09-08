/**
 * host-modules/session-rebind.ts — session 热重绑定 (warm-host rebind).
 */

import { type AgentHostState } from "./_state-shape";

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

export interface InstallSessionRebindDeps {
  state: AgentHostState;
  initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void>;
  sessionPresetSelection: (sessionPath?: string | null) => Promise<string | null | undefined>;
  replaceSession: (opts: any) => Promise<any>;
  sessionManagerOpen: (sessionPath: string, options: any, cwd: string) => any;
  agentHome: () => string;
  provideRpcUiContext: (deps: any) => any;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  questionAnswer: (value: any, questionKey?: string) => string | undefined;
  createOpenBuddyRpcUiContext: (deps: any) => any;
}

export function installSessionRebind(deps: InstallSessionRebindDeps): void {
  if (deps.state) state = deps.state;
  if (deps.initialize) initializeImpl = deps.initialize;
  if (deps.sessionPresetSelection) sessionPresetSelectionImpl = deps.sessionPresetSelection;
  if (deps.replaceSession) replaceSessionImpl = deps.replaceSession;
  if (deps.sessionManagerOpen) sessionManagerOpenImpl = deps.sessionManagerOpen;
  if (deps.agentHome) agentHomeImpl = deps.agentHome;
  if (deps.provideRpcUiContext) provideRpcUiContextImpl = deps.provideRpcUiContext;
  if (deps.emitPluginEvent) emitPluginEventImpl = deps.emitPluginEvent;
  if (deps.emitRendererEvent) emitRendererEventImpl = deps.emitRendererEvent;
  if (deps.questionAnswer) questionAnswerImpl = deps.questionAnswer;
  if (deps.createOpenBuddyRpcUiContext) createOpenBuddyRpcUiContextImpl = deps.createOpenBuddyRpcUiContext;
}

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

export async function rebindSession(sessionPath: string, cwd: string): Promise<void> {
  if (!state) throw new Error("session-rebind: not installed");

  const context = state.context;
  const modelRuntime = state.modelRuntime;
  const resourceLoader = state.piResourceLoader;

  if (!state.session || !context || !modelRuntime || !resourceLoader) {
    await initializeImpl({ cwd, sessionPath });
    return;
  }

  if (state.cwd !== cwd) {
    await initializeImpl({ cwd, sessionPath });
    return;
  }

  const mountedPresetId = state.presetSessionRuntime?.id ?? null;
  const probedPreset = await sessionPresetSelectionImpl(sessionPath);
  const targetPresetId = probedPreset === undefined || probedPreset === null
    ? mountedPresetId
    : probedPreset;
  if (targetPresetId !== mountedPresetId) {
    await initializeImpl({ cwd, sessionPath });
    return;
  }
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
