import { create } from "zustand";
import type { PiContent, PiMessage, Plan, PromptComplete, SessionUpdate, ToolCallContent, ToolCallUpdate } from "@/lib/types";

export interface ChatMessage { id: string; role: "user" | "assistant"; parts: MessagePart[]; complete: boolean }
export type MessagePart =
  | { kind: "text"; text: string; contentIndex?: number }
  | { kind: "thought"; text: string; contentIndex?: number }
  | { kind: "tool_call"; toolCall: ToolCallView; contentIndex?: number };
export interface ToolCallView {
  toolCallId: string; title: string; kind: string;
  status: "in_progress" | "completed" | "failed";
  content: ToolCallContent[]; rawInput?: unknown;
}
interface Usage { promptTokens?: number; completionTokens?: number; totalTokens?: number }
export interface SessionTranscript {
  messages: ChatMessage[]; streamingMessageId: string | null; busy: boolean;
  usage: Usage; plan: Plan | null; suppressReplay: boolean;
}
interface SessionState {
  sessionId: string | null; transcripts: Record<string, SessionTranscript>;
  messages: ChatMessage[]; streaming: boolean; streamingMessageId: string | null;
  usage: Usage; plan: Plan | null; error: string | null; planMode: boolean;
  setSession(id: string | null): void; reset(): void; startStreaming(): void;
  markComplete(p: PromptComplete): void; setError(error: string | null): void;
  stopStreaming(): void; dropSessionCache(id: string): void; clearReplaySuppression(id?: string): void;
  pushUser(text: string): void; pushAssistant(text: string): void;
  applyUpdate(update: SessionUpdate): void; setMessages(messages: ChatMessage[]): void;
  setPlan(plan: Plan | null): void; setPlanMode(enabled: boolean): void;
}
let seq = 0;
const nextId = () => `m${Date.now()}_${seq++}`;
const empty = (): SessionTranscript => ({ messages: [], streamingMessageId: null, busy: false, usage: {}, plan: null, suppressReplay: false });
const mirror = (t = empty()) => ({ messages: t.messages, streaming: t.busy, streamingMessageId: t.streamingMessageId, usage: t.usage, plan: t.plan });
const foreignListeners = new Map<string, (event: SessionUpdate) => void>();
export function registerForeignUpdateListener(sessionId: string, callback: (event: SessionUpdate) => void): () => void {
  foreignListeners.set(sessionId, callback);
  return () => { if (foreignListeners.get(sessionId) === callback) foreignListeners.delete(sessionId); };
}
function toolContent(content: PiContent[] = []): ToolCallContent[] {
  return content.flatMap((part): ToolCallContent[] => {
    if (part.type === "text") return [{ type: "text", text: part.text ?? "" }];
    if (part.type === "image" && part.data) return [{ type: "image", data: part.data, mimeType: part.mimeType ?? "image/png" }];
    return [];
  });
}
function partsOf(message: PiMessage, existing: MessagePart[] = []): MessagePart[] {
  const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
  return content.flatMap((part, contentIndex): MessagePart[] => {
    if (part.type === "text") return [{ kind: "text", text: part.text ?? "", contentIndex }];
    if (part.type === "thinking") return [{ kind: "thought", text: part.thinking ?? "", contentIndex }];
    if (part.type === "toolCall") {
      const previous = existing.find(p => p.kind === "tool_call" && p.toolCall.toolCallId === part.id);
      return [{ kind: "tool_call", contentIndex, toolCall: {
        toolCallId: part.id ?? "", title: part.name ?? "工具", kind: part.name ?? "other",
        status: previous?.kind === "tool_call" ? previous.toolCall.status : "in_progress",
        content: previous?.kind === "tool_call" ? previous.toolCall.content : [], rawInput: part.arguments,
      } }];
    }
    return [];
  });
}
function finish(t: SessionTranscript): SessionTranscript {
  return { ...t, busy: false, streamingMessageId: null, messages: t.messages.filter(m => m.parts.length > 0).map(m => ({ ...m, complete: true })) };
}
function ensureAssistant(t: SessionTranscript): { messages: ChatMessage[]; index: number; id: string } {
  const index = t.messages.findIndex(m => m.id === t.streamingMessageId && !m.complete);
  if (index >= 0) return { messages: [...t.messages], index, id: t.messages[index].id };
  const id = nextId();
  return { messages: [...t.messages, { id, role: "assistant", parts: [], complete: false }], index: t.messages.length, id };
}
export const useSessionStore = create<SessionState>((set, get) => {
  const apply = (sid: string | null, reducer: (t: SessionTranscript) => SessionTranscript) => {
    if (!sid) return;
    set(state => {
      const next = reducer(state.transcripts[sid] ?? empty());
      return { transcripts: { ...state.transcripts, [sid]: next }, ...(state.sessionId === sid ? mirror(next) : {}) };
    });
  };
  return {
    sessionId: null, transcripts: {}, ...mirror(), error: null, planMode: false,
    setSession: id => set(state => {
      const cached = id ? state.transcripts[id] : undefined;
      const t = cached ? { ...cached, suppressReplay: true } : empty();
      return { sessionId: id, transcripts: id ? { ...state.transcripts, [id]: t } : state.transcripts, ...mirror(t), error: null };
    }),
    reset: () => set({ sessionId: null, ...mirror(), error: null }),
    startStreaming: () => {
      apply(get().sessionId, t => {
        const { messages, id } = ensureAssistant(t);
        return { ...t, messages, streamingMessageId: id, busy: true, suppressReplay: false, usage: {} };
      });
      set({ error: null });
    },
    markComplete: p => apply(p.sessionId, t => ({ ...finish(t), usage: { ...t.usage, ...p.usage } })),
    setError: error => { if (error) apply(get().sessionId, finish); set({ error }); },
    stopStreaming: () => apply(get().sessionId, finish),
    dropSessionCache: id => set(state => {
      const transcripts = { ...state.transcripts }; delete transcripts[id];
      return { transcripts, ...(state.sessionId === id ? mirror() : {}) };
    }),
    clearReplaySuppression: id => apply(id ?? get().sessionId, t => ({ ...t, suppressReplay: false })),
    pushUser: text => apply(get().sessionId, t => ({ ...t, messages: [...t.messages, { id: nextId(), role: "user", parts: [{ kind: "text", text }], complete: true }] })),
    pushAssistant: text => apply(get().sessionId, t => ({ ...t, messages: [...t.messages, { id: nextId(), role: "assistant", parts: [{ kind: "text", text }], complete: true }] })),
    applyUpdate: event => {
      const sid = event.sessionId ?? event.__sessionId;
      if (!sid) return;
      foreignListeners.get(sid)?.(event);
      apply(sid, t => {
        if (t.suppressReplay) return t;
        if (event.type === "agent_settled") return finish(t);
        if (event.type === "agent_start") return { ...t, busy: true };
        if (event.type === "message_start") {
          if (event.message?.role !== "assistant") return t;
          const { messages, id } = ensureAssistant(t);
          return { ...t, messages, streamingMessageId: id };
        }
        if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (!delta) return t;
          const { messages, index, id } = ensureAssistant(t);
          let parts = [...messages[index].parts];
          const contentIndex = delta.contentIndex ?? 0;
          const kind = delta.type.startsWith("thinking_") ? "thought" : "text";
          const partIndex = parts.findIndex(p => p.contentIndex === contentIndex);
          if (["text_delta", "thinking_delta", "text_end", "thinking_end"].includes(delta.type)) {
            const previous = parts[partIndex];
            const value = delta.type.endsWith("_end") ? delta.content ?? "" : (previous && previous.kind !== "tool_call" ? previous.text : "") + (delta.delta ?? "");
            const part: MessagePart = { kind, text: value, contentIndex };
            if (partIndex >= 0) parts[partIndex] = part; else parts.push(part);
          } else if (delta.type === "toolcall_end" && delta.toolCall) {
            const part = partsOf({ role: "assistant", content: [delta.toolCall] }, parts)[0];
            if (part) {
              part.contentIndex = contentIndex;
              if (partIndex >= 0) parts[partIndex] = part; else parts.push(part);
            }
          } else if (delta.partial) parts = partsOf(delta.partial, parts);
          else if (event.message) parts = partsOf(event.message, parts);
          parts.sort((a, b) => (a.contentIndex ?? 0) - (b.contentIndex ?? 0));
          messages[index] = { ...messages[index], parts };
          return { ...t, messages, streamingMessageId: id, busy: true };
        }
        if (event.type === "message_end" && event.message) {
          const message = event.message;
          if (message.role === "toolResult") return updateTool(t, message.toolCallId ?? "", message.toolName ?? "工具", toolContent(typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content), message.isError ? "failed" : "completed");
          if (message.role === "user") {
            const parts = partsOf(message);
            const last = t.messages.filter(m => m.parts.length > 0).at(-1);
            if (last?.role === "user" && JSON.stringify(last.parts.map(p => p.kind !== "tool_call" ? p.text : "")) === JSON.stringify(parts.map(p => p.kind !== "tool_call" ? p.text : ""))) return t;
            return { ...t, messages: [...t.messages, { id: nextId(), role: "user", parts, complete: true }] };
          }
          if (message.role !== "assistant") return t;
          const { messages, index } = ensureAssistant(t);
          messages[index] = { ...messages[index], parts: partsOf(message, messages[index].parts), complete: true };
          return { ...t, messages, streamingMessageId: null, usage: message.usage ? { promptTokens: (t.usage.promptTokens ?? 0) + (message.usage.input ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0), completionTokens: (t.usage.completionTokens ?? 0) + (message.usage.output ?? 0), totalTokens: (t.usage.totalTokens ?? 0) + (message.usage.totalTokens ?? (message.usage.input ?? 0) + (message.usage.output ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0)) } : t.usage };
        }
        if (event.type.startsWith("tool_execution_")) {
          const status = event.type === "tool_execution_end" ? (event.isError ? "failed" : "completed") : "in_progress";
          const content = event.type === "tool_execution_update" ? event.partialResult?.content : event.result?.content;
          return updateTool(t, event.toolCallId ?? "", event.toolName ?? "工具", content ? toolContent(content) : undefined, status, event.args);
        }
        return t;
      });
    },
    setMessages: messages => apply(get().sessionId, t => ({ ...t, messages })),
    setPlan: plan => apply(get().sessionId, t => ({ ...t, plan })),
    setPlanMode: planMode => set({ planMode }),
  };
});
function updateTool(t: SessionTranscript, toolCallId: string, name: string, content: ToolCallContent[] | undefined, status: ToolCallView["status"], rawInput?: unknown): SessionTranscript {
  let found = false;
  const messages = t.messages.map(message => ({ ...message, parts: message.parts.map(part => {
    if (part.kind !== "tool_call" || part.toolCall.toolCallId !== toolCallId) return part;
    found = true;
    return { ...part, toolCall: { ...part.toolCall, status, ...(content ? { content } : {}), ...(rawInput !== undefined ? { rawInput } : {}) } };
  }) }));
  if (found) return { ...t, messages };
  const next = ensureAssistant({ ...t, messages });
  next.messages[next.index] = { ...next.messages[next.index], parts: [...next.messages[next.index].parts, { kind: "tool_call", toolCall: { toolCallId, title: name, kind: name, status, content: content ?? [], rawInput } }] };
  return { ...t, messages: next.messages, streamingMessageId: next.id };
}
export type { ToolCallUpdate };
