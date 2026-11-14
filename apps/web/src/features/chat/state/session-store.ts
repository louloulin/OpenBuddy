import { create } from "zustand";
import type { PiMessage, Plan, PromptComplete, SessionUpdate, ToolCallUpdate } from "@openbuddy/protocol/dto";
import { parseUserText } from "@openbuddy/chat-core/user-text";
import type { ChatMessage, MessageMeta, MessagePart, RetryState, SessionTranscript, ToolCallView, Usage } from "@openbuddy/chat-core/transcript";
import { empty, ensureAssistant, finish, nextId, reduce, transcriptFromMessages } from "@openbuddy/chat-core/transcript-reducer";

// The transcript model and its pure reducer live in chat-core (20261115-md R7).
export type { ChatMessage, MessageMeta, MessagePart, RetryState, SessionTranscript, ToolCallView };
export { transcriptFromMessages };
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
  applyUpdate(update: SessionUpdate): void;
  /** Streamed engine events: applied together once per frame (see flushQueuedUpdates). */
  queueUpdate(update: SessionUpdate): void;
  setMessages(messages: ChatMessage[]): void;
  setPlan(plan: Plan | null): void; setPlanMode(enabled: boolean): void;
}
const mirror = (t = empty()) => ({
  messages: t.messages, streaming: t.busy, streamingMessageId: t.streamingMessageId, usage: t.usage, plan: t.plan,
  error: t.error, retry: t.retry, compacting: t.compacting, turnStartedAt: t.turnStartedAt,
});
const foreignListeners = new Map<string, (event: SessionUpdate) => void>();
export function registerForeignUpdateListener(sessionId: string, callback: (event: SessionUpdate) => void): () => void {
  foreignListeners.set(sessionId, callback);
  return () => { if (foreignListeners.get(sessionId) === callback) foreignListeners.delete(sessionId); };
}
/** Engine events waiting for the next frame. */
let queued: SessionUpdate[] = [];
let flushToken = 0;
/** Last keystroke in the window: streaming yields frames to typing (20261115-ui §3). */
let lastInputAt = -Infinity;
if (typeof window !== "undefined") {
  const mark = () => { lastInputAt = performance.now(); };
  window.addEventListener("keydown", mark, { capture: true, passive: true });
  window.addEventListener("input", mark, { capture: true, passive: true });
}
const TYPING_MS = 150;
function scheduleFlush(run: () => void) {
  const token = ++flushToken;
  const once = () => { if (token === flushToken) run(); };
  // rAF pauses in a hidden window; the timer keeps background sessions moving.
  if (typeof requestAnimationFrame === "function") {
    // While the user types, render the stream every other frame so most frames only carry
    // the keystroke (still ≤ 33ms behind; the 50ms timer below bounds the wait).
    const typing = performance.now() - lastInputAt < TYPING_MS;
    requestAnimationFrame(typing ? () => requestAnimationFrame(once) : once);
  }
  setTimeout(once, 50);
}
export const useSessionStore = create<SessionState>((set, get) => {
  /** Apply every queued engine event in one store update (one render per frame). */
  const flush = () => {
    flushToken++;
    if (!queued.length) return;
    const events = queued;
    queued = [];
    set(state => {
      let transcripts = state.transcripts;
      for (const event of events) {
        const sid = event.sessionId ?? event.__sessionId;
        if (!sid) continue;
        const current = transcripts[sid];
        const next = reduce(current ?? empty(), event);
        if (next === current) continue;
        if (transcripts === state.transcripts) transcripts = { ...transcripts };
        transcripts[sid] = next;
      }
      if (transcripts === state.transcripts) return state;
      const active = state.sessionId ? transcripts[state.sessionId] : undefined;
      return { transcripts, ...(active && active !== state.transcripts[state.sessionId!] ? mirror(active) : {}) };
    });
  };
  /** Direct actions must see every event that arrived before them. */
  const sync = () => { if (queued.length) flush(); };
  const apply = (sid: string | null | undefined, reducer: (t: SessionTranscript) => SessionTranscript) => {
    if (!sid) return;
    sync();
    set(state => {
      const current = state.transcripts[sid];
      const next = reducer(current ?? empty());
      if (next === current) return state;
      return { transcripts: { ...state.transcripts, [sid]: next }, ...(state.sessionId === sid ? mirror(next) : {}) };
    });
  };
  return {
    sessionId: null, transcripts: {}, ...mirror(), planMode: false,
    setSession: id => { sync(); set(state => {
      const t = (id ? state.transcripts[id] : undefined) ?? empty();
      return { sessionId: id, transcripts: id && !state.transcripts[id] ? { ...state.transcripts, [id]: t } : state.transcripts, ...mirror(t) };
    }); },
    reset: () => { sync(); set({ sessionId: null, ...mirror() }); },
    hydrate: (id, history, busy, force = false) => { sync(); set(state => {
      const cached = state.transcripts[id];
      // A cached transcript has been receiving this session's live events all along.
      const next = cached && cached.messages.length && !force ? { ...cached, busy: busy || cached.busy } : transcriptFromMessages(history, busy);
      if (busy && !next.streamingMessageId) Object.assign(next, { turnStartedAt: next.turnStartedAt ?? Date.now() });
      return { transcripts: { ...state.transcripts, [id]: next }, ...(state.sessionId === id ? mirror(next) : {}) };
    }); },
    startStreaming: sessionId => apply(sessionId ?? get().sessionId, t => {
      const { messages, id } = ensureAssistant(t);
      return { ...t, messages, streamingMessageId: id, busy: true, error: null, retry: null, usage: {}, turnStartedAt: Date.now() };
    }),
    markComplete: p => apply(p.sessionId, t => ({ ...finish(t), usage: { ...t.usage, ...p.usage } })),
    setError: (error, sessionId) => apply(sessionId ?? get().sessionId, t => (error ? { ...finish(t), error } : { ...t, error: null })),
    stopStreaming: sessionId => apply(sessionId ?? get().sessionId, finish),
    dropSessionCache: id => { sync(); set(state => {
      const transcripts = { ...state.transcripts }; delete transcripts[id];
      return { transcripts, ...(state.sessionId === id ? mirror() : {}) };
    }); },
    pushUser: (text, attachments, sessionId) => apply(sessionId ?? get().sessionId, t => {
      const display = parseUserText(text);
      return { ...t, error: null, messages: [...t.messages, {
        id: nextId(), role: "user", complete: true,
        parts: display.text ? [{ kind: "text", text: display.text }] : [],
        meta: { pending: true, timestamp: Date.now(), ...(attachments?.length ? { attachments } : display.attachments.length ? { attachments: display.attachments } : {}), ...(display.skill ? { skill: display.skill } : {}), ...(display.mode ? { mode: display.mode } : {}) },
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
    queueUpdate: event => {
      const sid = event.sessionId ?? event.__sessionId;
      if (!sid) return;
      foreignListeners.get(sid)?.(event);
      queued.push(event);
      if (queued.length === 1) scheduleFlush(flush);
    },
    setMessages: messages => apply(get().sessionId, t => ({ ...t, messages })),
    setPlan: plan => apply(get().sessionId, t => ({ ...t, plan })),
    setPlanMode: planMode => set({ planMode }),
  };
});
export type { ToolCallUpdate };
