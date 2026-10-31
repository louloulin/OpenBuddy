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
import { randomUUID } from "node:crypto";

import { confirmGateAllows, confirmSessionAllows, CONFIRM_TOOL_NAME } from "../hook-permission";
import { EDIT_CONFIRM_TITLE } from "../../extensions/apply-patch";
import type { AgentSession, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { AgentHostPendingUiRequest } from "../_state-shape";

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
    pendingUiRequests: Map<string, AgentHostPendingUiRequest>;
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
  piGeneration?: number;
}

function makeRequestId(sessionId: string, kind: string): string {
  return `${sessionId}:${kind}:${randomUUID()}`;
}

/**
 * Wire the RPC UI context into the Pi context. Returns the uiContext so the
 * caller can pass it to session.bindExtensions({ uiContext, mode: "rpc" }).
 */
export function provideRpcUiContext(deps: ProvideRpcUiContextDeps): ExtensionUIContext {
  const { context, session, state, emitPluginEvent, emitRendererEvent, questionAnswer, createOpenBuddyRpcUiContext } = deps;
  /**
   * 不要兜底成 0！解析侧(ui-request-resolver)的守卫是
   *   `request.generation !== undefined && request.generation !== state.piGeneration`
   * —— 语义是"没记住代际的请求"不受代际约束。此前这里写 `?? 0`,而
   * `state.piGeneration` 只在 pi 运行时 reload 时才被赋值,于是**首次 reload 之前
   * 创建的所有请求**都变成 `gen=0` vs `stateGen=<N>`,被判"过期"、直接从表里删掉,
   * `agent:resolve-permission` 一律返回 ok:false —— 弹窗点"允许"也没用,扩展的
   * ui.confirm/select/input 永远不 settle,遮罩永久挡住界面。
   * 实测证据(2026-10-11 文件诊断):`created gen=0 stateGen=904` 紧跟
   * `rejected why=stale reqGen=0 stateGen=904`。
   */
  const generation = deps.piGeneration;

  const uiContext = (createOpenBuddyRpcUiContext as any)({
    sessionId: session.sessionId,
    select: async (title: string, options: ReadonlyArray<unknown>) =>
      new Promise<string | undefined>((resolve) => {
        const requestId = makeRequestId(session.sessionId, "select");
        state.pendingUiRequests.set(requestId, { kind: "question", sessionId: session.sessionId, generation, resolve: (value) => resolve(questionAnswer(value, title)) });
        emitPluginEvent("session/question", { requestId, sessionId: session.sessionId, title, questionCount: 1, optionCount: options.length });
        emitRendererEvent("pi://question", {
          requestId,
          sessionId: session.sessionId,
          toolCallId: "",
          title,
          questions: [{ id: requestId, question: title, options }],
        });
      }),
    confirm: async (title: string, message: string) => {
      // 1) 模式闸:bypassPermissions 直接放行,不再弹窗。
      // 2) 会话级「始终允许此命令」:同一条命令在本会话里第二次出现时不再问。
      //    识别键是 message 本身 —— confirm 没有工具名/pattern,命令原文是
      //    唯一稳定的身份。
      const isEdit = title === EDIT_CONFIRM_TITLE;
      const gated = await confirmGateAllows(isEdit ? "edit" : "other");
      if (gated === true) return true;
      // 编辑的「本会话始终允许」作用于所有文件修改;命令仍按命令原文逐条授权。
      const grantKey = isEdit ? EDIT_CONFIRM_TITLE : message;
      if (confirmSessionAllows(session.sessionId, grantKey)) return true;
      return await new Promise<boolean>((resolve) => {
        const requestId = makeRequestId(session.sessionId, "confirm");
        state.pendingUiRequests.set(requestId, {
          kind: "permission",
          sessionId: session.sessionId,
          generation,
          // resolveUiRequest 在 allow_always 时据此写入会话规则(带 pattern),
          // 同时不会再持久化成跨会话规则(ctx.confirm 不是真实工具名)。
          permission: { toolName: CONFIRM_TOOL_NAME, pattern: grantKey },
          resolve: (value) => {
            const decision = value && typeof value === "object" && "decision" in value
              ? (value as { decision?: string }).decision
              : value === true ? "allow" : "deny";
            resolve(decision === "allow" || decision === "allow_always");
          },
        });
        emitPluginEvent("session/permission", { requestId, sessionId: session.sessionId, title, hasMessage: Boolean(message), optionCount: 3 });
        emitRendererEvent("pi://permission", {
          requestId,
          sessionId: session.sessionId,
          toolCallId: "",
          title,
          message,
          source: "tool",
          // Keep the tool identity meaningful for the UI: the risk badge and
          // the localized tool chip both key off the kind, and "confirm"
          // would render every shell prompt as the generic 「工具确认」.
          toolKind: isEdit ? "apply_patch" : title?.includes("执行命令") ? "apply_command" : "confirm",
          options: [
            { optionId: "allow", kind: "allow", title: "允许" },
            { optionId: "allow_always", kind: "allow_always", title: isEdit ? "本会话始终允许编辑" : "本会话始终允许此命令" },
            { optionId: "deny", kind: "deny", title: "拒绝" },
          ],
        });
      });
    },
    input: async (title: string, placeholder: string) =>
      new Promise<string | undefined>((resolve) => {
        const requestId = makeRequestId(session.sessionId, "input");
        state.pendingUiRequests.set(requestId, { kind: "question", sessionId: session.sessionId, generation, resolve: (value) => resolve(questionAnswer(value, placeholder || title)) });
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
        state.pendingUiRequests.set(requestId, { kind: "question", sessionId: session.sessionId, generation, resolve: (value) => resolve(questionAnswer(value, title)) });
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
