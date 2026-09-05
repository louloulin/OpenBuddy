/**
 * provide-rpc-ui-context.ts — wire the OpenBuddy RPC UI context into Pi's context.
 *
 * Phase 8.3 §46: extracted from electron/main/agent/agent-host.ts
 * :initialize() (~60 lines of inline closure arguments for
 * createOpenBuddyRpcUiContext + context.provide("piUi", ...)).
 *
 * Pi extensions call back into the host through the UI context: select
 * (radio), confirm (allow/deny), input (free text), editor (multi-line),
 * emit (notifications + extension UI payloads), and editor/tools expanded
 * state. Each callback:
 *   1. mints a stable requestId
 *   2. registers a resolver in state.pendingUiRequests
 *   3. emits pi://question / pi://permission for the renderer
 *   4. emits session/question or session/permission for plugin bus listeners
 *
 * Splitting this out:
 *   - reduces inline noise in initialize()
 *   - makes each callback unit-testable (we can swap state + emitter mocks)
 *   - lets us version the requestId format in one place if Pi changes shape
 *
 * Reverse-dependency invariant:
 *   This module imports nothing from agent-host.ts. deps are passed in.
 */
import type { AgentSession, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface ProvideRpcUiContextDeps {
  /** The Pi context — used for context.provide("piUi", uiContext). */
  context: { provide: (key: string, value: unknown) => void };
  /** The just-created Pi AgentSession. session.sessionId is the request-id key. */
  session: AgentSession;
  /**
   * Shared mutable state for in-flight UI requests. The resolvers in the
   * callbacks resolve when the user answers via pi://question/permission.
   */
  state: {
    pendingUiRequests: Map<string, {
      kind: "question" | "permission";
      sessionId: string;
      resolve: (value: unknown) => void;
    }>;
    extensionEditorText: Map<string, string>;
    extensionToolsExpanded: Map<string, boolean>;
  };
  /** Bridge events to plugin bus listeners. */
  emitPluginEvent: (channel: string, payload: unknown) => void;
  /** Push events to the renderer only. */
  emitRendererEvent: (channel: string, payload: unknown) => void;
  /**
   * Convert a UI answer value to the option the agent expects
   * (typically the label/optionId the agent submitted).
   */
  questionAnswer: (value: unknown, fallback?: string) => string | undefined;
  /**
   * External factory that builds the OpenBuddyRpcUiContext shape the host
   * hands to Pi. Imported from ./pi-rpc-ui-context in agent-host.ts and
   * passed in as a dep so this module stays independent of that import.
   */
  createOpenBuddyRpcUiContext: (args: unknown) => unknown;
}

function makeRequestId(sessionId: string, kind: string): string {
  return `${sessionId}:${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Wire the RPC UI context into the Pi context. Returns the uiContext so the
 * caller can pass it to session.bindExtensions({ uiContext, mode: "rpc" }).
 */
export function provideRpcUiContext(deps: ProvideRpcUiContextDeps): ExtensionUIContext {
  const { context, session, state, emitPluginEvent, emitRendererEvent, questionAnswer, createOpenBuddyRpcUiContext } = deps;

  const uiContext = (createOpenBuddyRpcUiContext as any)({
    sessionId: session.sessionId,
    select: async (title: string, options: ReadonlyArray<unknown>) =>
      new Promise<string | undefined>((resolve) => {
        const requestId = makeRequestId(session.sessionId, "select");
        state.pendingUiRequests.set(requestId, { kind: "question", sessionId: session.sessionId, resolve: (value) => resolve(questionAnswer(value, title)) });
        emitPluginEvent("session/question", { requestId, sessionId: session.sessionId, title, questionCount: 1, optionCount: options.length });
        emitRendererEvent("pi://question", {
          requestId,
          sessionId: session.sessionId,
          toolCallId: "",
          title,
          questions: [{ id: requestId, question: title, options }],
        });
      }),
    confirm: async (title: string, message: string) =>
      new Promise<boolean>((resolve) => {
        const requestId = makeRequestId(session.sessionId, "confirm");
        state.pendingUiRequests.set(requestId, { kind: "permission", sessionId: session.sessionId, resolve: (value) => resolve(value === true) });
        emitPluginEvent("session/permission", { requestId, sessionId: session.sessionId, title, hasMessage: Boolean(message), optionCount: 2 });
        emitRendererEvent("pi://permission", {
          requestId,
          sessionId: session.sessionId,
          toolCallId: "",
          title,
          message,
          options: [
            { optionId: "allow", kind: "allow", title: message || title },
            { optionId: "deny", kind: "deny", title: "拒绝" },
          ],
        });
      }),
    input: async (title: string, placeholder: string) =>
      new Promise<string | undefined>((resolve) => {
        const requestId = makeRequestId(session.sessionId, "input");
        state.pendingUiRequests.set(requestId, { kind: "question", sessionId: session.sessionId, resolve: (value) => resolve(questionAnswer(value, placeholder || title)) });
        emitPluginEvent("session/question", { requestId, sessionId: session.sessionId, title, questionCount: 1, optionCount: 0, input: true });
        emitRendererEvent("pi://question", {
          requestId,
          sessionId: session.sessionId,
          toolCallId: "",
          title,
          questions: [{ id: requestId, question: placeholder || title, options: [] }],
        });
      }),
    editor: async (title: string, prefill: string) =>
      new Promise<string | undefined>((resolve) => {
        const requestId = makeRequestId(session.sessionId, "editor");
        state.pendingUiRequests.set(requestId, { kind: "question", sessionId: session.sessionId, resolve: (value) => resolve(questionAnswer(value, title)) });
        emitPluginEvent("session/question", { requestId, sessionId: session.sessionId, title, questionCount: 1, optionCount: 0, input: true, editor: true, prefill });
        emitRendererEvent("pi://question", {
          requestId,
          sessionId: session.sessionId,
          toolCallId: "",
          title,
          questions: [{ id: requestId, question: title, options: [], prefill }],
        });
      }),
    emit: (payload: { method?: string; message?: string; type?: string; [key: string]: unknown }) => {
      if (payload.method === "notify") {
        emitRendererEvent("pi://notification", { sessionId: session.sessionId, message: payload.message, type: payload.type });
        return;
      }
      emitRendererEvent("pi://extension-ui", payload);
    },
    getEditorText: () => state.extensionEditorText.get(session.sessionId) ?? "",
    setEditorText: (text: string) => {
      state.extensionEditorText.set(session.sessionId, text);
      emitRendererEvent("pi://extension-ui", { sessionId: session.sessionId, method: "setEditorText", text });
    },
    getToolsExpanded: () => state.extensionToolsExpanded.get(session.sessionId) ?? false,
    setToolsExpanded: (expanded: boolean) => {
      state.extensionToolsExpanded.set(session.sessionId, expanded);
      emitRendererEvent("pi://extension-ui", { sessionId: session.sessionId, method: "setToolsExpanded", expanded });
    },
  });

  context.provide("piUi", uiContext);
  return uiContext as any;
}
