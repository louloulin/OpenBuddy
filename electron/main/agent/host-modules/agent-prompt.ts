/**
 * host-modules/agent-prompt.ts — prompt dispatch + session I/O surface.
 *
 * Phase 8.3 Batch B: 从 agent-host.ts 抽出 lines 3653-3828, 围绕 session
 * 调度的 IPC handler (prompt / steer / followUp / abort / promptContent /
 * updateSessionQueue / readSessionAttachment / getSession / onEvent /
 * onPluginEvent).
 *
 * 设计:
 *   - state / emitPluginEvent / emitRendererEvent / publicQueueItems 通过
 *     环形 import 自 ../agent-host 注入 (publicQueueItems 是 agent-host.ts
 *     内部 helper, 在 line 425, 这次给它加 export 以支持环形 import)
 *   - writePromptHistory 直接 from "./pi-resources" (agent-host.ts 也是这个
 *     import 路径, 维持原依赖方向)
 *   - EventHandler / PluginEventHandler / PromptResult 三个 local type 在
 *     本模块独立声明 — agent-host.ts 内只是 PiSessionFacade 内部细节, 没有
 *     外部用户
 *   - prompt / abort 已经是 export 关键字, 保留 export (cordis-runtime.ts
 *     还要从 agent-host.ts 拿它们, agent-host.ts 内部 wrapper 重新 export)
 */
import {
  ModelRuntime,
  ModelRegistry,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

import type { SessionEventRecord } from "../../session/session-event-log";
import type { StoredSessionAttachment } from "../../session/session-attachments";
// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { state, emitPluginEvent, emitRendererEvent, publicQueueItems } from "../agent-host"` (reverse dep)
//   修复后: 通过 installAgentPrompt() 一次性注入, 本模块零 agent-host 导入.
//   PiPromptContentPart 类型现已在 _state-shape 公开.
import type { PiPromptContentPart } from "./_state-shape";
import type { OpenBuddyThinkingLevel } from "../../ipc/validation";
import { generateTraceId } from "@openbuddy/logging-shared";
import { hostReceived as hostReceivedLog, hostDispatched as hostDispatchedLog, hostFailed as hostFailedLog } from "../agent-host-log";
import { writePromptHistory } from "../pi-resources";
import { type AgentHostState } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

let state: AgentHostState = createDefaultAgentHostState();

/**
 * Pre-install fallback Sets. Why this exists:
 *   - registerIpc() in electron/main/index.ts calls agentHost.onEvent(handler)
 *     synchronously during app.whenReady(), BEFORE bootBackgroundServices()
 *     runs agentHost.initialize() (which calls installAgentPrompt()).
 *   - Install Pattern lets `state` would be undefined at that moment, so
 *     `state.eventHandlers.add(...)` crashes (TypeError: Cannot read
 *     properties of undefined).
 *   - Fix: agent-prompt.ts owns its own mutable Set refs for these two
 *     subscriptions. Pre-install calls go to the local Set. install() syncs
 *     the let to the real agent-host state Set, so after install, both
 *     modules share the same Set reference (live binding).
 *
 * The pre-install window only matters for registerIpc's eager subscription;
 * no renderer can dispatch events until the window is up, so no other
 * handler can land in the orphan Set.
 */
let eventHandlers: Set<EventHandler> = new Set();
let pluginEventHandlers: Set<PluginEventHandler> = new Set();

let emitPluginEvent: (type: string, payload: unknown) => void;
let emitRendererEvent: (channel: string, payload: unknown) => void;
let publicQueueItems: (session: unknown) => readonly unknown[];

/**
 * Bind agent-prompt dependencies. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installAgentPrompt(deps: {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  publicQueueItems: (session: unknown) => readonly unknown[];
}): void {
  state = deps.state;
  // Migrate pre-install handlers and rebind to the real agent-host Sets so
  // agent-host.ts:2803 (event broadcast loop) sees the same Set references.
  for (const h of eventHandlers) deps.state.eventHandlers.add(h);
  for (const h of pluginEventHandlers) deps.state.pluginEventHandlers.add(h);
  eventHandlers = deps.state.eventHandlers;
  pluginEventHandlers = deps.state.pluginEventHandlers;
  emitPluginEvent = deps.emitPluginEvent;
  emitRendererEvent = deps.emitRendererEvent;
  publicQueueItems = deps.publicQueueItems;
}

type EventHandler = (event: AgentSessionEvent) => void;
type PluginEventHandler = (event: SessionEventRecord & { eventVersion: 1 }) => void;
type PromptResult = { itemId?: string };

function getSession(): AgentSession | null {
  return state.session;
}

function onEvent(handler: EventHandler): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}

function onPluginEvent(handler: PluginEventHandler): () => void {
  pluginEventHandlers.add(handler);
  return () => pluginEventHandlers.delete(handler);
}

export async function prompt(text: string, options?: { traceId?: string; sessionId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTraceId();
  const sessionId = options?.sessionId ?? state.session?.sessionId;
  hostReceivedLog("agent:prompt", traceId, sessionId);
  if (!state.session) {
    const err = new Error("openbuddy-agent: session not initialized");
    hostFailedLog("agent:prompt", traceId, err);
    throw err;
  }
  // Diagnostics for upstream provider wiring. The previous MiniMax 404 was
  // hidden by a hardcoded stopReason in the IPC layer; this log makes the
  // resolved model identity visible so the next 404 (or any other upstream
  // failure) is trivial to diagnose from logs alone.
  const sessionModel = (state.session as unknown as { model?: { provider?: string; id?: string; api?: string; baseUrl?: string } }).model;
  const fallbackModel = state.model as { provider?: string; id?: string; api?: string; baseUrl?: string } | undefined;
  const resolvedModel = sessionModel ?? fallbackModel;
  console.log("[openbuddy] pi prompt.start", {
    traceId,
    sessionId,
    textLength: text.length,
    provider: resolvedModel?.provider,
    model: resolvedModel?.id,
    api: resolvedModel?.api,
    baseUrl: resolvedModel?.baseUrl,
  });
  emitPluginEvent("session/input", { sessionId: state.session.sessionId, text });
  await writePromptHistory(text);
  try {
    await state.session.prompt(text);
    console.log("[openbuddy] pi prompt.dispatched", { traceId, sessionId });
    hostDispatchedLog("agent:prompt", traceId, sessionId);
  } catch (error) {
    console.error("[openbuddy] pi prompt.failed", { traceId, sessionId, error: String(error) });
    emitPluginEvent("agent/error", { sessionId: state.session.sessionId, operation: "prompt", error: String(error) });
    emitRendererEvent("pi://error", { sessionId: state.session.sessionId, error: String(error) });
    hostFailedLog("agent:prompt", traceId, error);
    throw error;
  }
}

async function promptContent(content: readonly PiPromptContentPart[], mode: "queue" | "steer" = "queue"): Promise<PromptResult> {
  if (!state.session) throw new Error("openbuddy-agent: session not initialized");
  const text = content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("");
  if (!text.trim() && !content.some((part) => part.type === "image")) throw new Error("openbuddy-agent: prompt content must not be empty");
  const parts = content.map((part) => part.type === "text"
    ? { type: "text" as const, text: part.text }
    : { type: "image" as const, data: part.data, mimeType: part.mediaType });
  const attachmentRefs: Array<{ attachmentId: string; mediaType: string; bytes: number; sha256: string; name?: string }> = [];
  for (const part of content) {
    if (part.type !== "image") continue;
    const attachment = await state.attachmentStore.save({ sessionId: state.session.sessionId, mediaType: part.mediaType, data: part.data, name: part.name });
    attachmentRefs.push(attachment);
  }
  let imageIndex = 0;
  const publicContent = content.map((part) => part.type === "text"
    ? part
    : { type: "image", mediaType: part.mediaType, ...(part.name ? { name: part.name } : {}), ...(attachmentRefs[imageIndex++] ? { attachmentId: attachmentRefs[imageIndex - 1].attachmentId } : {}) });
  emitPluginEvent("session/input", { sessionId: state.session.sessionId, content: publicContent, mode, ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}) });
  if (text.trim()) await writePromptHistory(text);
  try {
    void state.queueMirror;
    await state.session!.sendUserMessage(parts, mode === "steer" ? { deliverAs: "steer" } : { deliverAs: "followUp" });
    return {};
  } catch (error) {
    emitPluginEvent("agent/error", { sessionId: state.session.sessionId, operation: "prompt", error: String(error) });
    emitRendererEvent("pi://error", { sessionId: state.session.sessionId, error: String(error) });
    throw error;
  }
}

async function updateSessionQueue(sessionId: string, _itemId: string, action: { kind: "edit" | "remove" | "steer"; content?: readonly PiPromptContentPart[] }): Promise<{ accepted: true }> {
  if (state.session?.sessionId !== sessionId) throw Object.assign(new Error(`session not found: ${sessionId}`), { code: "session-not-found" });
  if (!state.session) throw Object.assign(new Error("session queue is unavailable"), { code: "service-unavailable" });
  if (action.kind === "remove") {
    state.session.clearQueue();
  } else if (action.kind === "steer") {
    const text = (action.content ?? []).filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n").trim();
    if (text) await state.session.steer(text);
  } else if (action.kind === "edit") {
    const text = (action.content ?? []).filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n").trim();
    state.session.clearQueue();
    if (text) await state.session.followUp(text);
  }
  const items = publicQueueItems(state.session);
  if (state.queueMirror) state.queueMirror = items.map((value) => {
    const item = value as { mode: "queue" | "steer"; content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data?: string; name?: string }> };
    return { mode: item.mode, content: item.content.map((part) => part.type === "text"
      ? { type: "text" as const, text: part.text }
      : { type: "image" as const, mediaType: part.mediaType, data: part.data ?? "", ...(part.name ? { name: part.name } : {}) }) };
  });
  emitPluginEvent("session/queue-updated", { sessionId, action: action.kind, items });
  return { accepted: true };
}

async function readSessionAttachment(sessionId: string, attachmentId: string): Promise<StoredSessionAttachment> {
  if (!sessionId.trim() || !attachmentId.trim()) throw Object.assign(new Error("sessionId and attachmentId are required"), { code: "bad-request" });
  return state.attachmentStore.read(sessionId, attachmentId);
}

async function steer(text: string, options?: { traceId?: string; sessionId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTraceId();
  const sessionId = options?.sessionId ?? state.session?.sessionId;
  hostReceivedLog("agent:steer", traceId, sessionId);
  if (!state.session) {
    const err = new Error("openbuddy-agent: session not initialized");
    hostFailedLog("agent:steer", traceId, err);
    throw err;
  }
  const value = text.trim();
  if (!value) {
    const err = new Error("openbuddy-agent: steer text must not be empty");
    hostFailedLog("agent:steer", traceId, err);
    throw err;
  }
  emitPluginEvent("session/steer", { sessionId: state.session.sessionId, text: value });
  try {
    await state.session.steer(value);
    hostDispatchedLog("agent:steer", traceId, sessionId);
  } catch (error) {
    hostFailedLog("agent:steer", traceId, error);
    throw error;
  }
}

async function followUp(text: string, options?: { traceId?: string; sessionId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTraceId();
  const sessionId = options?.sessionId ?? state.session?.sessionId;
  hostReceivedLog("agent:follow-up", traceId, sessionId);
  if (!state.session) {
    const err = new Error("openbuddy-agent: session not initialized");
    hostFailedLog("agent:follow-up", traceId, err);
    throw err;
  }
  const value = text.trim();
  if (!value) {
    const err = new Error("openbuddy-agent: follow-up text must not be empty");
    hostFailedLog("agent:follow-up", traceId, err);
    throw err;
  }
  emitPluginEvent("session/follow-up", { sessionId: state.session.sessionId, text: value });
  try {
    await state.session.followUp(value);
    hostDispatchedLog("agent:follow-up", traceId, sessionId);
  } catch (error) {
    hostFailedLog("agent:follow-up", traceId, error);
    throw error;
  }
}

export async function abort(options?: { traceId?: string; sessionId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTraceId();
  const sessionId = options?.sessionId ?? state.session?.sessionId;
  hostReceivedLog("agent:abort", traceId, sessionId);
  emitPluginEvent("agent/abort", { sessionId: state.session?.sessionId });
  try {
    await state.session?.abort();
    hostDispatchedLog("agent:abort", traceId, sessionId);
  } catch (error) {
    hostFailedLog("agent:abort", traceId, error);
    throw error;
  }
}

export {
  getSession,
  onEvent,
  onPluginEvent,
  promptContent,
  updateSessionQueue,
  readSessionAttachment,
  steer,
  followUp,
};
