import { create } from "zustand";
import type { PiContent, PiMessage, Plan, PromptComplete, SessionUpdate, ToolCallContent, ToolCallUpdate } from "@/lib/types";
import { parseUserText } from "@/lib/user-text";

export interface MessageMeta {
  /** Engine timestamp (ms) of the message; local clock for optimistic ones. */
  timestamp?: number;
  /** Local time the message finished (live turns only). */
  endedAt?: number;
  model?: string;
  provider?: string;
  stopReason?: string;
  errorMessage?: string;
  /** User message chips. */
  attachments?: string[];
  skill?: string;
  expert?: string;
  images?: Array<{ data: string; mimeType: string }>;
  /** Optimistic user message not yet echoed by the engine. */
  pending?: boolean;
  /** Non-chat history entries rendered as dividers. */
  notice?: "compaction" | "branch" | "custom" | "bash";
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "notice";
  parts: MessagePart[];
  complete: boolean;
  meta?: MessageMeta;
}
export type MessagePart =
  | { kind: "text"; text: string; contentIndex?: number }
  | { kind: "thought"; text: string; contentIndex?: number }
  | { kind: "tool_call"; toolCall: ToolCallView; contentIndex?: number };
export interface ToolCallView {
  toolCallId: string; title: string; kind: string;
  status: "in_progress" | "completed" | "failed";
  content: ToolCallContent[]; rawInput?: unknown;
  /** Tool-specific result details (edit diff/patch, bash truncation). */
  details?: unknown;
  durationMs?: number;
  startedAt?: number;
}
interface Usage { promptTokens?: number; completionTokens?: number; totalTokens?: number }
export interface RetryState { attempt: number; maxAttempts: number; delayMs: number; errorMessage?: string; startedAt: number }
export interface SessionTranscript {
  messages: ChatMessage[]; streamingMessageId: string | null; busy: boolean;
  usage: Usage; plan: Plan | null; error: string | null;
  retry: RetryState | null; compacting: string | null;
  /** Local time the current turn started. */
  turnStartedAt: number | null;
}
interface SessionState {
  sessionId: string | null; transcripts: Record<string, SessionTranscript>;
  messages: ChatMessage[]; streaming: boolean; streamingMessageId: string | null;
  usage: Usage; plan: Plan | null; error: string | null; planMode: boolean;
  retry: RetryState | null; compacting: string | null; turnStartedAt: number | null;
  setSession(id: string | null): void; reset(): void;
  /** Build a transcript from engine history. Live transcripts are kept unless `force`. */
  hydrate(id: string, messages: PiMessage[], busy: boolean, force?: boolean): void;
  startStreaming(sessionId?: string): void;
  markComplete(p: PromptComplete): void; setError(error: string | null, sessionId?: string): void;
  stopStreaming(sessionId?: string): void; dropSessionCache(id: string): void;
  pushUser(text: string, attachments?: string[], sessionId?: string): void;
  /** Undo an optimistic send that never reached the engine. */
  dropPending(sessionId?: string): void;
  pushAssistant(text: string): void;
  applyUpdate(update: SessionUpdate): void; setMessages(messages: ChatMessage[]): void;
  setPlan(plan: Plan | null): void; setPlanMode(enabled: boolean): void;
}
let seq = 0;
const nextId = () => `m${Date.now()}_${seq++}`;
const empty = (): SessionTranscript => ({ messages: [], streamingMessageId: null, busy: false, usage: {}, plan: null, error: null, retry: null, compacting: null, turnStartedAt: null });
const mirror = (t = empty()) => ({
  messages: t.messages, streaming: t.busy, streamingMessageId: t.streamingMessageId, usage: t.usage, plan: t.plan,
  error: t.error, retry: t.retry, compacting: t.compacting, turnStartedAt: t.turnStartedAt,
});
const foreignListeners = new Map<string, (event: SessionUpdate) => void>();
export function registerForeignUpdateListener(sessionId: string, callback: (event: SessionUpdate) => void): () => void {
  foreignListeners.set(sessionId, callback);
  return () => { if (foreignListeners.get(sessionId) === callback) foreignListeners.delete(sessionId); };
}
function contentOf(message: { content?: PiContent[] | string }): PiContent[] {
  const content = message.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}
function toolContent(content: PiContent[] = []): ToolCallContent[] {
  return content.flatMap((part): ToolCallContent[] => {
    if (part.type === "text") return [{ type: "text", text: part.text ?? "" }];
    if (part.type === "image" && part.data) return [{ type: "image", data: part.data, mimeType: part.mimeType ?? "image/png" }];
    return [];
  });
}
function toolPart(part: PiContent, contentIndex: number, existing: MessagePart[]): MessagePart {
  const previous = existing.find((p): p is Extract<MessagePart, { kind: "tool_call" }> => p.kind === "tool_call" && p.toolCall.toolCallId === part.id);
  return { kind: "tool_call", contentIndex, toolCall: {
    toolCallId: part.id ?? "", title: part.name ?? "工具", kind: part.name ?? "other",
    status: previous ? previous.toolCall.status : "in_progress",
    content: previous ? previous.toolCall.content : [],
    rawInput: part.arguments ?? previous?.toolCall.rawInput,
    details: previous?.toolCall.details, durationMs: previous?.toolCall.durationMs, startedAt: previous?.toolCall.startedAt,
  } };
}
/** Parts of a finished assistant message, keeping live tool status/results. */
function assistantParts(message: PiMessage, existing: MessagePart[] = []): MessagePart[] {
  return contentOf(message).flatMap((part, contentIndex): MessagePart[] => {
    if (part.type === "text") return part.text ? [{ kind: "text", text: part.text, contentIndex }] : [];
    if (part.type === "thinking") return part.thinking?.trim() ? [{ kind: "thought", text: part.thinking, contentIndex }] : [];
    if (part.type === "toolCall") return [toolPart(part, contentIndex, existing)];
    return [];
  });
}
function userMessage(message: PiMessage, id = nextId()): ChatMessage {
  const content = contentOf(message);
  const raw = content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
  const display = parseUserText(raw);
  const images = content.filter(part => part.type === "image" && part.data).map(part => ({ data: part.data!, mimeType: part.mimeType ?? "image/png" }));
  return {
    id, role: "user", complete: true,
    parts: display.text ? [{ kind: "text", text: display.text }] : [],
    meta: {
      timestamp: message.timestamp,
      ...(display.attachments.length ? { attachments: display.attachments } : {}),
      ...(display.skill ? { skill: display.skill } : {}),
      ...(display.expert ? { expert: display.expert } : {}),
      ...(images.length ? { images } : {}),
    },
  };
}
function assistantMeta(message: PiMessage, endedAt?: number): MessageMeta {
  return {
    timestamp: message.timestamp, endedAt, model: message.model, provider: message.provider,
    stopReason: message.stopReason, errorMessage: message.errorMessage,
  };
}
function noticeMessage(message: PiMessage): ChatMessage | undefined {
  const kinds: Record<string, MessageMeta["notice"]> = { compactionSummary: "compaction", branchSummary: "branch", custom: "custom", bashExecution: "bash" };
  const notice = kinds[message.role];
  if (!notice) return undefined;
  if (notice === "custom" && message.display === false) return undefined;
  const text = notice === "bash"
    ? `$ ${message.command ?? ""}\n${message.output ?? ""}`.trim()
    : typeof message.summary === "string" ? message.summary : contentOf(message).map(part => part.text ?? "").join("\n");
  return { id: nextId(), role: "notice", complete: true, parts: text ? [{ kind: "text", text }] : [], meta: { notice, timestamp: message.timestamp } };
}
function finish(t: SessionTranscript): SessionTranscript {
  return {
    ...t, busy: false, streamingMessageId: null, retry: null, compacting: null, turnStartedAt: null,
    messages: t.messages
      .filter(m => m.parts.length > 0 || m.role !== "assistant" || m.meta?.errorMessage)
      .map(m => (m.complete && !m.meta?.pending ? m : { ...m, complete: true })),
  };
}
function ensureAssistant(t: SessionTranscript): { messages: ChatMessage[]; index: number; id: string } {
  const index = t.messages.findIndex(m => m.id === t.streamingMessageId && !m.complete);
  if (index >= 0) return { messages: [...t.messages], index, id: t.messages[index].id };
  const id = nextId();
  return { messages: [...t.messages, { id, role: "assistant", parts: [], complete: false, meta: { timestamp: Date.now() } }], index: t.messages.length, id };
}
function sumUsage(usage: Usage, message: PiMessage): Usage {
  const u = message.usage;
  if (!u) return usage;
  return {
    promptTokens: (usage.promptTokens ?? 0) + (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0),
    completionTokens: (usage.completionTokens ?? 0) + (u.output ?? 0),
    totalTokens: (usage.totalTokens ?? 0) + (u.totalTokens ?? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0)),
  };
}
/** Apply one finished history message (live `message_end` or a hydrated entry). */
function applyMessage(t: SessionTranscript, message: PiMessage, live: boolean): SessionTranscript {
  if (message.role === "toolResult") {
    return updateTool(t, message.toolCallId ?? "", message.toolName ?? "工具", {
      content: toolContent(contentOf(message)), status: message.isError ? "failed" : "completed",
      ...(message.details !== undefined ? { details: message.details } : {}),
    });
  }
  if (message.role === "user") {
    // Replace the optimistic copy instead of appending a second bubble.
    const pending = t.messages.findLastIndex(m => m.role === "user" && m.meta?.pending);
    if (pending >= 0) {
      const messages = [...t.messages];
      const next = userMessage(message, messages[pending].id);
      // Keep chips the composer knew about when the engine only saw inlined bodies.
      next.meta = { ...next.meta, attachments: messages[pending].meta?.attachments?.length ? messages[pending].meta!.attachments : next.meta?.attachments };
      messages[pending] = next;
      return { ...t, messages };
    }
    return { ...t, messages: [...t.messages, userMessage(message)] };
  }
  if (message.role === "assistant") {
    const { messages, index } = live ? ensureAssistant(t) : { messages: [...t.messages, { id: nextId(), role: "assistant" as const, parts: [], complete: false }], index: t.messages.length };
    messages[index] = { ...messages[index], parts: assistantParts(message, messages[index].parts), complete: true, meta: assistantMeta(message, live ? Date.now() : undefined) };
    return { ...t, messages, streamingMessageId: live ? null : t.streamingMessageId, usage: sumUsage(t.usage, message) };
  }
  const notice = noticeMessage(message);
  return notice ? { ...t, messages: [...t.messages, notice] } : t;
}
export function transcriptFromMessages(history: PiMessage[], busy = false): SessionTranscript {
  let t = empty();
  for (const message of history) t = applyMessage(t, message, false);
  // History is not a turn: usage only counts the model calls of the running turn.
  t = { ...finish(t), busy, usage: {} };
  return t;
}
/** Streaming deltas: content is assembled from deltas only (no cumulative snapshots). */
function applyDelta(t: SessionTranscript, delta: NonNullable<SessionUpdate["assistantMessageEvent"]>): SessionTranscript {
  const { messages, index, id } = ensureAssistant(t);
  const parts = [...messages[index].parts];
  const contentIndex = delta.contentIndex ?? 0;
  const at = parts.findIndex(p => p.contentIndex === contentIndex);
  const kind = delta.type.startsWith("thinking_") ? "thought" : delta.type.startsWith("text_") ? "text" : undefined;
  if (kind) {
    const previous = at >= 0 ? parts[at] : undefined;
    const before = previous && previous.kind === kind ? previous.text : "";
    const text = delta.type.endsWith("_end") ? delta.content ?? before : delta.type.endsWith("_delta") ? before + (delta.delta ?? "") : before;
    const part: MessagePart = { kind, text, contentIndex };
    if (at >= 0) parts[at] = part; else parts.push(part);
  } else if ((delta.type === "toolcall_start" || delta.type === "toolcall_end") && delta.toolCall) {
    const part = toolPart(delta.toolCall, contentIndex, parts);
    if (at >= 0) parts[at] = part; else parts.push(part);
  } else {
    return { ...t, messages, streamingMessageId: id, busy: true };
  }
  parts.sort((a, b) => (a.contentIndex ?? 0) - (b.contentIndex ?? 0));
  messages[index] = { ...messages[index], parts };
  return { ...t, messages, streamingMessageId: id, busy: true };
}
function reduce(t: SessionTranscript, event: SessionUpdate): SessionTranscript {
  switch (event.type) {
    case "agent_settled": return finish(t);
    // History branch moved (重新生成 / 从这里编辑): rebuild from the engine's messages.
    case "session_rewound": return { ...transcriptFromMessages(Array.isArray(event.messages) ? (event.messages as PiMessage[]) : []), plan: t.plan };
    case "agent_start": return { ...t, busy: true, error: null, usage: t.busy ? t.usage : {}, turnStartedAt: t.turnStartedAt ?? Date.now() };
    case "message_start": {
      if (event.message?.role !== "assistant") return t;
      const { messages, id } = ensureAssistant(t);
      return { ...t, messages, streamingMessageId: id };
    }
    case "message_update": return event.assistantMessageEvent ? applyDelta(t, event.assistantMessageEvent) : t;
    case "message_end": return event.message ? applyMessage(t, event.message, true) : t;
    case "tool_execution_start":
      return updateTool(t, event.toolCallId ?? "", event.toolName ?? "工具", { status: "in_progress", rawInput: event.args, startedAt: Date.now() });
    case "tool_execution_update":
      return updateTool(t, event.toolCallId ?? "", event.toolName ?? "工具", {
        status: "in_progress", rawInput: event.args,
        ...(event.partialResult?.content ? { content: toolContent(event.partialResult.content) } : {}),
      });
    case "tool_execution_end":
      return updateTool(t, event.toolCallId ?? "", event.toolName ?? "工具", {
        status: event.isError ? "failed" : "completed",
        ...(event.result?.content ? { content: toolContent(event.result.content) } : {}),
        ...(event.result?.details !== undefined ? { details: event.result.details } : {}),
        ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
      });
    case "auto_retry_start":
      return { ...t, retry: { attempt: Number(event.attempt ?? 1), maxAttempts: Number(event.maxAttempts ?? 1), delayMs: Number(event.delayMs ?? 0), errorMessage: typeof event.errorMessage === "string" ? event.errorMessage : undefined, startedAt: Date.now() } };
    case "auto_retry_end": return { ...t, retry: null };
    case "compaction_start": return { ...t, compacting: String(event.reason ?? "threshold") };
    case "compaction_end": {
      const next = { ...t, compacting: null };
      if (!event.result || event.aborted) return next;
      return { ...next, messages: [...next.messages, { id: nextId(), role: "notice", complete: true, parts: [], meta: { notice: "compaction", timestamp: Date.now() } }] };
    }
    default: return t;
  }
}
export const useSessionStore = create<SessionState>((set, get) => {
  const apply = (sid: string | null | undefined, reducer: (t: SessionTranscript) => SessionTranscript) => {
    if (!sid) return;
    set(state => {
      const next = reducer(state.transcripts[sid] ?? empty());
      return { transcripts: { ...state.transcripts, [sid]: next }, ...(state.sessionId === sid ? mirror(next) : {}) };
    });
  };
  return {
    sessionId: null, transcripts: {}, ...mirror(), planMode: false,
    setSession: id => set(state => {
      const t = (id ? state.transcripts[id] : undefined) ?? empty();
      return { sessionId: id, transcripts: id && !state.transcripts[id] ? { ...state.transcripts, [id]: t } : state.transcripts, ...mirror(t) };
    }),
    reset: () => set({ sessionId: null, ...mirror() }),
    hydrate: (id, history, busy, force = false) => set(state => {
      const cached = state.transcripts[id];
      // A cached transcript has been receiving this session's live events all along.
      const next = cached && cached.messages.length && !force ? { ...cached, busy: busy || cached.busy } : transcriptFromMessages(history, busy);
      if (busy && !next.streamingMessageId) Object.assign(next, { turnStartedAt: next.turnStartedAt ?? Date.now() });
      return { transcripts: { ...state.transcripts, [id]: next }, ...(state.sessionId === id ? mirror(next) : {}) };
    }),
    startStreaming: sessionId => apply(sessionId ?? get().sessionId, t => {
      const { messages, id } = ensureAssistant(t);
      return { ...t, messages, streamingMessageId: id, busy: true, error: null, retry: null, usage: {}, turnStartedAt: Date.now() };
    }),
    markComplete: p => apply(p.sessionId, t => ({ ...finish(t), usage: { ...t.usage, ...p.usage } })),
    setError: (error, sessionId) => apply(sessionId ?? get().sessionId, t => (error ? { ...finish(t), error } : { ...t, error: null })),
    stopStreaming: sessionId => apply(sessionId ?? get().sessionId, finish),
    dropSessionCache: id => set(state => {
      const transcripts = { ...state.transcripts }; delete transcripts[id];
      return { transcripts, ...(state.sessionId === id ? mirror() : {}) };
    }),
    pushUser: (text, attachments, sessionId) => apply(sessionId ?? get().sessionId, t => {
      const display = parseUserText(text);
      return { ...t, error: null, messages: [...t.messages, {
        id: nextId(), role: "user", complete: true,
        parts: display.text ? [{ kind: "text", text: display.text }] : [],
        meta: { pending: true, timestamp: Date.now(), ...(attachments?.length ? { attachments } : display.attachments.length ? { attachments: display.attachments } : {}), ...(display.skill ? { skill: display.skill } : {}) },
      }] };
    }),
    dropPending: sessionId => apply(sessionId ?? get().sessionId, t => {
      const pending = t.messages.findLastIndex(m => m.role === "user" && m.meta?.pending);
      const messages = t.messages.filter((m, i) => i !== pending && !(m.id === t.streamingMessageId && m.parts.length === 0));
      return { ...t, messages, busy: false, streamingMessageId: null, turnStartedAt: null };
    }),
    pushAssistant: text => apply(get().sessionId, t => ({ ...t, messages: [...t.messages, { id: nextId(), role: "assistant", parts: [{ kind: "text", text }], complete: true }] })),
    applyUpdate: event => {
      const sid = event.sessionId ?? event.__sessionId;
      if (!sid) return;
      foreignListeners.get(sid)?.(event);
      apply(sid, t => reduce(t, event));
    },
    setMessages: messages => apply(get().sessionId, t => ({ ...t, messages })),
    setPlan: plan => apply(get().sessionId, t => ({ ...t, plan })),
    setPlanMode: planMode => set({ planMode }),
  };
});
function updateTool(t: SessionTranscript, toolCallId: string, name: string, patch: Partial<ToolCallView>): SessionTranscript {
  let found = false;
  const messages = t.messages.map(message => message.role !== "assistant" ? message : ({ ...message, parts: message.parts.map(part => {
    if (part.kind !== "tool_call" || part.toolCall.toolCallId !== toolCallId) return part;
    found = true;
    const rawInput = patch.rawInput !== undefined && patch.rawInput !== null ? patch.rawInput : part.toolCall.rawInput;
    return { ...part, toolCall: { ...part.toolCall, ...patch, rawInput, startedAt: part.toolCall.startedAt ?? patch.startedAt } };
  }) }));
  if (found) return { ...t, messages };
  const next = ensureAssistant({ ...t, messages });
  next.messages[next.index] = { ...next.messages[next.index], parts: [...next.messages[next.index].parts, { kind: "tool_call", toolCall: { toolCallId, title: name, kind: name, status: "in_progress", content: [], ...patch } }] };
  return { ...t, messages: next.messages, streamingMessageId: next.id };
}
export type { ToolCallUpdate };
