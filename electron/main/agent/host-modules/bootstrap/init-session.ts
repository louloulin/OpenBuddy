/**
 * bootstrap/init-session.ts — Pi AgentSession creation stage of `initialize()`.
 *
 * Phase 8.3 Batch D-3: split `agent-host.ts:initialize()` into per-stage helpers.
 * This stage owns:
 *   - mounting the configured agent preset on the loader/context
 *   - starting profile watchers
 *   - refreshing marketplace Pi resource paths
 *   - configuring the Pi extensions
 *   - creating the Pi `DefaultResourceLoader`
 *   - creating the live `AgentSession` via `PiSessionRuntime`
 *   - persisting the session header on first-time sessions
 *   - reporting extension errors + syncing marketplace extension statuses
 *   - wiring `state.session`, `state.model`, `state.queueMirror`
 *   - registering `teamRunner`, `piSessionRaw`, `piExtensionApi` on the Cordis context
 *   - building + installing the RPC UI context
 *   - capturing the pending provider registrations
 *   - firing `state.extensionsBound` (Phase 5)
 *   - emitting `pi/ready`, `session/created`
 *   - subscribing the unified session-event handler
 *   - setting the session display name on first-time sessions
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import { SessionManager, DefaultResourceLoader, ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { Context } from "@openbuddy/cordis";
import type { HandleSessionEventDeps } from "./handle-session-event";
import { buildSessionEventSubscriber } from "./handle-session-event";
import type { ProvideRpcUiContextDeps } from "./provide-rpc-ui-context";
import { provideRpcUiContext } from "./provide-rpc-ui-context";

import { type AgentHostState, type PiPromptContentPart } from "../_state-shape";
import type { ElectronHarnessPluginLoader } from "../profile/loader";

/**
 * Dependencies required to create + wire the Pi AgentSession.
 *
 * `mountConfiguredAgentPreset` / `sessionPresetSelection` are top-level helpers
 * that own the preset lifecycle; they are passed in here rather than imported
 * so this stage stays composition-root free.
 */
export interface InitSessionDeps {
  state: AgentHostState;
  context: Context;
  loader: ElectronHarnessPluginLoader;
  cwd: string;
  /** ModelRuntime already bootstrapped by `bootstrapModelRuntime`. */
  modelRuntime: ModelRuntime | null;
  /** Session path to resume, or undefined for a fresh session. */
  sessionPath?: string;
  /** Emitter helpers + session event subscription helpers. */
  emitPluginEvent: any;
  emitRendererEvent: any;
  emitPiSessionEvent: any;
  captureFileSnapshot: any;
  /** Top-level preset helpers. */
  sessionPresetSelection: any;
  mountConfiguredAgentPreset: any;
  startProfileWatchers: any;
  refreshMarketplacePiResourcePaths: any;
  configurePiExtensions: any;
  reportPiExtensionErrors: any;
  syncMarketplacePiExtensionStatuses: any;
  /** Native pi resource paths (extensions/skills/prompts/themes). */
  nativePiResourcePaths: any;
  /** Persisted session header writer. */
  persistPiSessionHeaderImpl: any;
  /** `piSessionRuntime` — owned by `host-modules/pi-session-runtime.ts`. */
  piSessionRuntime: any;
  /** Cordis context emitter helper for the unified session-event subscriber. */
  publicQueueItems: any;
  /** Event namespaces for the unified session-event subscriber. */
  eventNamespace: any;
  canonicalEventNamespace: any;
  /** createRpcUiContext factory and question-answer helper. */
  createOpenBuddyRpcUiContext: any;
  questionAnswer: any;
  /** path helpers. */
  piHome: () => string;
  piSessionDir: (cwd: string) => string;
  /** team-runner factory. */
  createTeamRunner: any;}

/**
 * The session bootstrap stage. Creates the live Pi `AgentSession`, wires the
 * Cordis context, builds the RPC UI context, fires `state.extensionsBound`,
 * and subscribes the unified session-event handler.
 *
 * Returns the freshly created `sessionId` so the composition root can
 * surface it in `state.session`.
 */
export async function initSession(deps: InitSessionDeps): Promise<string> {
  const {
    state,
    context,
    loader,
    cwd,
    modelRuntime,
    sessionPath,
    emitPluginEvent,
    emitRendererEvent,
    emitPiSessionEvent,
    captureFileSnapshot,
    sessionPresetSelection,
    mountConfiguredAgentPreset,
    startProfileWatchers,
    refreshMarketplacePiResourcePaths,
    configurePiExtensions,
    reportPiExtensionErrors,
    syncMarketplacePiExtensionStatuses,
    nativePiResourcePaths,
    persistPiSessionHeaderImpl,
    piSessionRuntime,
    publicQueueItems,
    eventNamespace,
    canonicalEventNamespace,
    createOpenBuddyRpcUiContext,
    questionAnswer,
    piHome,
    piSessionDir,
    createTeamRunner,
  } = deps;

  // Mount the configured agent preset BEFORE creating the session so the
  // session can see the preset's tools + system-prompt contributions.
  const persistedPresetId = await sessionPresetSelection(sessionPath);
  const mountedPresetId = await mountConfiguredAgentPreset(cwd, context, loader, persistedPresetId);

  await startProfileWatchers();
  await refreshMarketplacePiResourcePaths();
  configurePiExtensions(state.profilePiExtensions);

  const piResourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: piHome(),
    ...nativePiResourcePaths(),
    additionalExtensionPaths: state.piExtensionPaths,
    extensionFactories: state.piExtensionFactories,
    agentsFilesOverride: (base) => ({
      agentsFiles: [...base.agentsFiles, ...state.piMarketplaceAgentFiles.map((file) => ({ ...file }))],
    }),
    systemPromptOverride: (base) => {
      const prompt = state.context?.get("systemPrompt") as { render?: () => string } | undefined;
      const contributed = prompt?.render?.() ?? "";
      const presetPrompt = state.presetSessionRuntime?.renderSystemPrompt() ?? "";
      return [base, contributed, presetPrompt].filter((value): value is string => Boolean(value?.trim())).join("\n\n") || undefined;
    },
  });

  let session: AgentSession;
  try {
    await piResourceLoader.reload();
    state.piResourceLoader = piResourceLoader;
    // piSessionRuntime.create() returns Promise<AgentSession> (not { session })
    // per the canonical signature in electron/main/agent/pi-session-runtime.ts.
    session = await piSessionRuntime.create({
      cwd,
      agentDir: piHome(),
      noTools: "builtin",
      modelRuntime: modelRuntime ?? undefined,
      sessionManager: sessionPath
        ? SessionManager.open(sessionPath, undefined, cwd)
        : SessionManager.create(cwd, piSessionDir(cwd)),
      resourceLoader: piResourceLoader,
    });
    if (!sessionPath) await persistPiSessionHeaderImpl(session);
  } catch (error) {
    await state.presetSessionRuntime?.dispose().catch(() => undefined);
    state.presetSessionRuntime = null;
    throw error;
  }

  reportPiExtensionErrors();
  await syncMarketplacePiExtensionStatuses();

  state.session = session;
  state.model = session.model;
  if (!sessionPath) {
    session.sessionManager.appendCustomEntry("openbuddy/agent-preset", { id: mountedPresetId, version: 1 });
  }
  state.queueMirror = [];
  context.provide("teamRunner", createTeamRunner(modelRuntime as ModelRuntime, cwd, () => state.model));
  context.provide("piSessionRaw", session);
  context.provide("piExtensionApi", session);

  const uiContext = provideRpcUiContext({
    context,
    session,
    state,
    emitPluginEvent,
    emitRendererEvent,
    questionAnswer,
    createOpenBuddyRpcUiContext,
  } as unknown as ProvideRpcUiContextDeps);

  // Capture which Pi extension registered which provider before bindExtensions
  // drains the pending queue. The tracker installed above captures live calls
  // but loses the extension path context; this snapshot preserves it so the UI
  // can show "provided by <pi-extension>" badges in the model picker.
  for (const entry of piResourceLoader.getExtensions().runtime.pendingProviderRegistrations ?? []) {
    state.providerRegistry.set(entry.name, {
      id: entry.name,
      source: "pi-extension",
      extensionPath: entry.extensionPath,
      registeredAt: Date.now(),
    });
  }

  // Phase 5 — fire-and-forget; mutating IPCs await `state.extensionsBound`
  // before issuing their RPC. The first `agent:prompt` after a cold-start
  // session waits once for the bind to settle; subsequent turns don't
  // (the bind is already settled, the await is a microtask).
  state.extensionsBound = session
    .bindExtensions({ uiContext, mode: "rpc" })
    .catch((err) => {
      console.warn("[openbuddy] bindExtensions failed", err);
    });

  context.emit("pi/ready", { sessionId: session.sessionId, cwd });
  emitPluginEvent("session/created", { sessionId: session.sessionId, cwd });

  const handler = buildSessionEventSubscriber({
    state,
    context,
    publicQueueItems: publicQueueItems as any,
    captureFileSnapshot,
    emitPluginEvent,
    emitRendererEvent,
    emitPiSessionEvent,
    eventNamespace,
    canonicalEventNamespace,
  } as unknown as HandleSessionEventDeps);
  state.sessionUnsubscribe = piSessionRuntime.subscribe(
    handler as unknown as (event: unknown, session: AgentSession) => void,
  );

  try {
    if (!session.sessionManager.getSessionName()) session.setSessionName("OpenBuddy");
  } catch {
    // Session naming is optional across Pi releases.
  }

  return session.sessionId;
}
