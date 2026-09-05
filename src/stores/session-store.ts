import { create } from "zustand";
import type { Plan, ToolCallContent } from "@openbuddy/shared-types";
import {
  INITIAL_STREAMING_STATE,
  streamReducer,
  deltaFromTextChunk,
  deltaFromThoughtChunk,
  appendPartFromToolCall,
  updatePartFromToolCallDelta,
  type StreamingState,
  type StreamAction,
} from "@/lib/stream/streaming-message";
import { IDLE_PHASE, phaseReducer, type AgentPhase, type AgentPhaseEvent } from "@/lib/stream/agent-phase";

/**
 * A single chat message in the transcript the UI renders.
 *
 * Kept as a stable export here because `@openbuddy/ui-conversation`
 * (`MessageItem`, `FindBar`, `ToolSidePanel`, `FileChangesPanel`),
 * `src/lib/collaboration/share.ts`, `src/lib/ui/timeline-utils.ts`, and
 * several component tests import the type. The transcript itself is owned
 * by pi's `AgentSession` (Phase 1-3) — this store no longer carries one.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  /** False while the assistant is still streaming this message. */
  complete: boolean;
}
export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "tool_call"; toolCall: ToolCallView };

/** A tool-call card rendered inline. Mirrors a subset of ToolCallUpdate. */
export interface ToolCallView {
  toolCallId: string;
  title: string;
  kind: string;
  status: "in_progress" | "completed" | "failed";
  content: ToolCallContent[];
  rawInput?: unknown;
  /** R1.4 — true while we are still receiving tool_execution_update deltas.
   *  Cleared by the final tool_call_update (status: completed | failed). */
  partial?: boolean;
  /** R1.4 — last partial result from tool_execution_update. Lets the
   *  detail body show streaming output such as live build logs. */
  partialResult?: unknown;
  /** Phase R3.0 — wall-clock ms when the tool call first appeared. Used by
   *  ToolCallCard to render "完成 1.2s" / "运行中 5s" inline. Set by
   *  useAgentSession.ts the first time a tool_call event lands. */
  startedAt?: number;
  /** Phase R3.0 — wall-clock ms when the tool call first reached a terminal
   *  status (`completed` / `failed`). The elapsed label is
   *  `completedAt - startedAt` once this is set, which keeps a finished
   *  tool's duration stable across later re-renders instead of measuring
   *  against a live `Date.now()`. Absent while still `in_progress`. */
  completedAt?: number;
}

/**
 * UI-only session state. The canonical transcript now lives in pi's
 * `AgentSession.state.messages` (Phase 1-3). This store only carries the
 * transient bits the renderer needs between renders:
 *
 *   - which session is focused (`sessionId`)
 *   - whether streaming is in-flight (`streaming`) — drives Composer lock
 *     and the LoadingRow
 *   - a one-shot optimistic user bubble (`optimisticBubble`) shown until
 *     the round-trip lands and pi replays the real user message into the
 *     transcript
 *   - the global error banner (`error`)
 *   - plan-mode toggle (`planMode`)
 *
 * Phase 4 deliberately deletes:
 *   - `transcripts` map (pi owns the canonical transcript)
 *   - `localStorage` cache (pi auto-persists via JSONL)
 *   - `REPLAY_SUPPRESSED_EVENTS` (no replay → no suppression)
 *   - `applyUpdate` (App.tsx handles pi events directly)
 *
 * R1.4 / R2 re-introduced the bare minimum fields App.tsx, ChatView, and
 * PlanPanel still read (`messages`, `streamingMessageId`, `plan`) plus
 * the streaming reducers and `setPlan` that App.tsx drives from
 * `agent_message_chunk` / `tool_call` / `plan_update` events. The two
 * dead R1.4 actions (`setMessages`, `appendMessage`) were removed in
 * Phase 8.2.6 — nothing in production ever called them.
 */
interface UiSessionState {
  sessionId: string | null;
  streaming: boolean;
  planMode: boolean;
  optimisticBubble: ChatMessage | null;
  error: string | null;
  // R1.4 — restored minimal transcript mirror. Phase 4 removed the
  // messages / streamingMessageId / usage fields while ChatView kept reading
  // them; this is the bare minimum to keep timeline.length === 0 rendering
  // the empty-state banner and to prevent messages.length crashes. A full
  // event-driven rewire (replaces the old applyUpdate) is tracked separately.
  messages: ChatMessage[];
  streamingMessageId: string | null;
  /** R2 — current execution plan (ACP `Plan`). Populated by agent
   *  plan_update events; surfaced via PlanPanel / PlanModeBanner. */
  plan: Plan | null;
  /** pi-web-alignment — in-flight assistant message stored outside the
   *  persisted transcript so streaming deltas do not force every historical
   *  message to re-render on each chunk. Consumers can either keep using
   *  the legacy `messages` mirror (still maintained as a fallback) or
   *  switch to a streaming-only selector reading `streamState.message`. */
  streamState: StreamingState;
  /** pi-web-alignment — machine-readable lifecycle of the current turn.
   *  Drives badges (`running 3 tools`, `awaiting model`) without forcing
   *  the UI to recompute from tool counts + streaming boolean. */
  phase: AgentPhase;
  /** Phase R3.0 — set of session ids that are still in the optimistic
   *  `__pending_<nonce>` state (i.e. the renderer knows about them but the
   *  backend hasn't confirmed). UI components consult `isPending(id)` /
   *  `pendingSessionIds.has(id)` to gate destructive actions (Sidebar
   *  context menu, Topbar rename/delete, etc.) without depending on the
   *  defensive `assertRealSessionId` log warn in pi-client. */
  pendingSessionIds: ReadonlySet<string>;
}
interface UiSessionActions {
  setSession: (id: string | null) => void;
  /** Optimistic-session migration. Switches the focused session from a
   *  local pending id (e.g. `__pending_<nonce>`) to the real id returned
   *  by piNewSession, while preserving the optimistic user bubble and any
   *  in-flight streaming message. No-op when the focused session is not
   *  `oldId` — out-of-order resolves from rapid sidebar clicks never
   *  clobber a newer switch's transcript. */
  migrateSession: (oldId: string, newId: string) => void;
  /** Replace the messages mirror with historical entries loaded from
   *  pi after piLoadSession. Only used on session switch (not for live
   *  streaming — that path uses beginStreamingMessage / appendStreamingDelta).
   *  No-op when the focused session id does not match `forSessionId`, so
   *  out-of-order fetches from rapid sidebar clicks never clobber a
   *  newer switch's transcript. */
  loadHistoryMessages: (forSessionId: string, messages: ChatMessage[]) => void;
  setStreaming: (streaming: boolean) => void;
  setPlanMode: (enabled: boolean) => void;
  /** Push an optimistic user bubble; returns its id so the caller can
   *  `popOptimistic()` on rollback. */
  pushOptimisticUser: (text: string) => string;
  /** Drop the optimistic user bubble (e.g. round-trip failed). */
  popOptimistic: () => void;
  setError: (e: string | null) => void;
  /** R1.4 — start a streaming assistant message. Returns its id so subsequent
   *  deltas can target it. Called by App.tsx from `agent_message_chunk` /
   *  `tool_call` events. */
  beginStreamingMessage: () => string;
  /** R1.4 — append a delta to the currently-streaming assistant message.
   *  No-op when no streaming message is active. Called by App.tsx.
   *  Deltas coalesce per animation frame (C2) — read state only after rAF.
   *
   *  `kind` selects the part the delta lands in: `"text"` for the answer body,
   *  `"thought"` for reasoning arriving on `agent_thought_chunk`. Reasoning
   *  must not share the answer's part — `MessageItem` renders `thought` parts
   *  as a collapsible 深度思考 block, and merging them would print the model's
   *  reasoning inline as if it were the answer. Switching kind flushes the
   *  pending buffer so interleaved blocks keep their arrival order. */
  appendStreamingDelta: (delta: string, kind?: "text" | "thought") => void;
  /** R1.4 — finalise the streaming message (complete: true). Called by
   *  App.tsx after the agent stops emitting chunks. Robust to the case
   *  where `streamingMessageId` was already cleared (cancel path, session
   *  switch, prior error path) — falls back to the latest incomplete
   *  assistant message so the orphan LoadingRow can never get stuck. */
  finishStreamingMessage: () => void;
  /** Abandon the in-flight assistant message. Called from every error
   *  path (pi://turn-error, pi://agent-died, 60s streaming watchdog,
   *  user cancel) so the orphan LoadingRow is force-finalised and
   *  stamped with the interruption reason. Idempotent. */
  abandonStreamingMessage: (reason: string) => void;
  /** R2 — replace the current plan with a new one. Called when the agent
   *  emits a new PlanUpdate; old entries are dropped (ACP semantics). */
  setPlan: (plan: Plan | null) => void;
  /** Clear focused session + transient flags. The canonical transcript is
   *  not owned by us — pi keeps it. */
  reset: () => void;
  /** Phase R3.0 — mark a `__pending_<nonce>` id as still optimistic. UI
   *  components consult `pendingSessionIds.has(id)` to gate destructive
   *  actions (Sidebar context menu, Topbar rename/delete). */
  markPending: (pendingId: string) => void;
  /** Phase R3.0 — resolve a pending id by either:
   *  - passing the real id (drops the pending from the set); or
   *  - passing `null` to drop it without replacement (e.g. on rollback).
   *  Idempotent: calling twice is a no-op. */
  markResolved: (pendingId: string, realId?: string | null) => void;
  /** Phase R3.0 — pure predicate; consumed by Sidebar/Topbar to gate
   *  destructive actions on the current focused session. */
  isPending: (id: string) => boolean;
  /** pi-web-alignment — dispatch a streamReducer action. The action only
   *  touches `streamState`; consumers of the legacy `messages[]` mirror
   *  keep their existing path. This lets ChatView components migrate to
   *  a streaming-only selector without a big-bang rewrite. */
  applyStreamAction: (action: StreamAction) => void;
  /** pi-web-alignment — read-only convenience selector for the in-flight
   *  message (null when no turn is active). */
  streamingMessage: () => ChatMessage | null;
  /** pi-web-alignment — dispatch a phase event. Referentially stable for
   *  the same input so consumers can subscribe with `Object.is` equality
   *  and only re-render when the phase actually changes. */
  applyPhaseEvent: (event: AgentPhaseEvent) => void;
}

let seq = 0;
const nextId = () => `m${Date.now()}_${seq++}`;
/**
 * 流式 delta 合帧(C2 收敛):agent_message_chunk 高频到达(每秒可达上百条),
 * 逐条 `messages.map` 重建数组会让 ChatView/timeline 以 chunk 频率全量重渲染。
 * 缓冲到模块级,按 requestAnimationFrame 合并成每帧至多一次 store 更新;
 * finish 强制同步 flush,begin/切换会话时清空缓冲防止跨轮/跨会话串字。
 * 合并语义不变——仍追加到 streamingMessageId 的最后一个 text part。
 *
 * P0-06: 用 findIndex + slice 替代 messages.map。O(n) 的 map 会让每条
 * delta 都触发 N 次回调 + N 次浅比较;新写法只对匹配项做一次 slice+concat,
 * 其他消息保持引用相等(React.memo 不重渲染)。
 */
let pendingDelta = "";
let deltaRafId: number | null = null;
/** Timeout handle racing the animation frame — see `scheduleDeltaFlush`. */
let deltaTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Which part kind the buffered delta belongs to.
 *
 * Reasoning and answer text arrive on two different channels
 * (`agent_thought_chunk` / `agent_message_chunk`) but share this one buffer, so
 * the buffer has to remember what it is holding. Before this existed,
 * `appendStreamingDelta` was kind-blind and every thought delta merged into the
 * assistant's `text` part — reasoning rendered inline as the answer instead of
 * inside the collapsible `<details class="msg__thought">` block that
 * `MessageItem` already implements for it.
 *
 * A kind switch flushes first (see `appendStreamingDelta`) so interleaved
 * thought/text blocks keep their arrival order.
 */
type StreamingDeltaKind = "text" | "thought";
let pendingDeltaKind: StreamingDeltaKind = "text";

/** Coalescing window used when animation frames are starved. */
const DELTA_FLUSH_FALLBACK_MS = 32;

/**
 * Schedule the buffered-delta flush, racing an animation frame against a
 * timeout.
 *
 * A bare `requestAnimationFrame` is not sufficient. Electron throttles — and
 * for a fully occluded window, entirely stops — animation frames. rAF still
 * *exists* in that state, it just never fires, so a capability check can't
 * detect it. The result was that a turn streaming into a background window
 * never merged its deltas into `messages[]`: the whole response sat in
 * `pendingDelta` until something forced a synchronous flush.
 *
 * Racing both schedulers keeps the one-write-per-frame coalescing while the
 * window is compositing, and degrades to a 32ms timer when it isn't.
 * Whichever fires first flushes and cancels the other.
 */
function scheduleDeltaFlush(): number {
  const run = () => {
    clearDeltaSchedulers();
    flushStreamingBuffer();
  };
  deltaTimeoutId = setTimeout(run, DELTA_FLUSH_FALLBACK_MS);
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(run);
  // No rAF at all (SSR / jsdom without a polyfill): the timeout alone drives
  // the flush. Return a non-null sentinel so `appendStreamingDelta`'s
  // "already scheduled" guard still works.
  return -1;
}

/** Cancel both pending schedulers and reset the handles. */
function clearDeltaSchedulers(): void {
  if (deltaTimeoutId !== null) {
    clearTimeout(deltaTimeoutId);
    deltaTimeoutId = null;
  }
  if (deltaRafId !== null) {
    if (deltaRafId !== -1 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(deltaRafId);
    }
    deltaRafId = null;
  }
}

function mergeStreamingDelta(text: string, kind: StreamingDeltaKind = "text") {
  useSessionStore.setState((s) => {
    if (!s.streamingMessageId) return s;
    const idx = s.messages.findIndex((m) => m.id === s.streamingMessageId);
    if (idx === -1) return s;
    const target = s.messages[idx];
    const last = target.parts[target.parts.length - 1];
    // Merge into the tail only when it is the same kind, otherwise open a new
    // part. This is what keeps a reasoning block and the answer that follows it
    // as two separate parts instead of one concatenated blob.
    const newParts =
      last && last.kind === kind
        ? target.parts.slice(0, -1).concat({ kind, text: last.text + text })
        : target.parts.concat({ kind, text });
    const newMessages = s.messages.slice();
    newMessages[idx] = { ...target, parts: newParts };
    // Drive the new reducer in lockstep so streamState stays a referentially
    // accurate shadow of the legacy messages[] mirror. Either view is safe to
    // read; the migration window lets ChatView migrate to streamState.message
    // incrementally without losing the legacy path mid-stream.
    const nextStream = streamReducer(s.streamState, {
      type: "delta",
      text,
      part: kind,
    });
    return {
      messages: newMessages,
      streamState: nextStream === s.streamState ? s.streamState : nextStream,
    };
  });
}

function flushStreamingBuffer() {
  clearDeltaSchedulers();
  const text = pendingDelta;
  const kind = pendingDeltaKind;
  pendingDelta = "";
  if (text) mergeStreamingDelta(text, kind);
}

/**
 * Locate the assistant message that should be force-finalised.
 *
 * Preferred match: the one currently tracked by `streamingMessageId`.
 * Fallback (handles the cancel / setSession / error path where
 * `streamingMessageId` was cleared but the message is still in `messages`
 * with `complete: false`): the latest assistant message that's still
 * incomplete. Returns null when there's nothing to finalise.
 */
function findFinalisableAssistant(state: UiSessionState): ChatMessage | null {
  if (state.streamingMessageId) {
    const m = state.messages.find((x) => x.id === state.streamingMessageId);
    if (m) return m;
  }
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role === "assistant" && !m.complete) return m;
  }
  return null;
}

function discardStreamingBuffer() {
  clearDeltaSchedulers();
  pendingDelta = "";
  // Reset the kind too, otherwise the next turn's first text delta is judged
  // against a stale "thought" and triggers a pointless flush of an empty
  // buffer — or worse, opens the turn with a thought part.
  pendingDeltaKind = "text";
}

/**
 * Sweep a freshly-loaded history mirror for any assistant message that's
 * still incomplete with no content. Pi's JSONL can persist such a row when
 * the agent crashes mid-stream (e.g. fatal MCP failure, agent thread died,
 * model dropped the connection) before `message_end` was written. Without
 * this sweep the renderer would re-render an infinite LoadingRow on the next
 * session focus — the user-visible "半天没返回" symptom.
 *
 * We only touch the TRAILING assistant (the one the user just sent), and
 * only when it has zero content. Earlier turns are assumed complete because
 * `sessionEntriesToChatMessages` always sets `complete: true` for entries
 * pulled from disk. The placeholder text is intentionally short so it
 * doesn't read as a real model answer.
 */
function cleanupOrphanHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  if (last.role !== "assistant" || last.complete || last.parts.length > 0) {
    return messages;
  }
  const out = messages.slice();
  out[lastIdx] = {
    ...last,
    parts: [{ kind: "text", text: "（上次响应未完成，已自动收尾）" }],
    complete: true,
  };
  return out;
}

export const useSessionStore = create<UiSessionState & UiSessionActions>((set, get) => ({
  sessionId: null,
  streaming: false,
  planMode: false,
  optimisticBubble: null,
  error: null,
  messages: [],
  streamingMessageId: null,
  plan: null,
  // pi-web-alignment — populated lazily on the first `applyStreamAction`
  // call for a new turn. Reuses `streamingMessageId` as the bubble id so
  // the legacy mirror stays in sync.
  streamState: INITIAL_STREAMING_STATE,
  // pi-web-alignment — drives machine-readable lifecycle badges. Starts
  // idle; transitions to `waiting_model` / `running_tools` / etc. via
  // `applyPhaseEvent`. The legacy `streaming` boolean remains as a
  // backward-compatible aggregate for callers that don't care which
  // sub-state the agent is in.
  phase: IDLE_PHASE,
  // Phase R3.0 — UI-level gate for destructive actions on optimistic
  // session ids. Populated by `beginPendingNewSession` (App.tsx) and
  // drained by `markResolved` once the real id round-trips from main.
  pendingSessionIds: new Set<string>() as ReadonlySet<string>,

  setSession: (id) => {
    discardStreamingBuffer();
    set({ sessionId: id, error: null, messages: [], streamingMessageId: null, plan: null, streamState: INITIAL_STREAMING_STATE, phase: IDLE_PHASE });
  },
  migrateSession: (oldId, newId) => {
    if (oldId === newId) return;
    // Flush any coalesced streaming deltas so the assistant message
    // contents survive the id swap on the next render.
    flushStreamingBuffer();
    set((s) => {
      if (s.sessionId !== oldId) return s;
      return { sessionId: newId };
    });
  },

  loadHistoryMessages: (forSessionId, messages) => {
    discardStreamingBuffer();
    set((s) => {
      if (s.sessionId !== forSessionId) return s;
      // Migration guard: history replay must never leave an orphan LoadingRow.
      // Pi's JSONL can persist an assistant message whose turn never finished
      // (model crash mid-stream, agent died before complete). Without this
      // sweep the freshly-loaded transcript would render the loading row
      // forever. We mark any trailing incomplete assistant as complete and
      // stamp a one-line "已中断" placeholder so the user sees a final state
      // instead of an endless spinner.
      //
      // Architectural note (post-pi-web-alignment): `loadHistoryMessages` is
      // also the SESSION-BOUNDARY event. Whatever transient streaming state
      // the SSE replay (triggered by `piLoadSession`) created must be wiped
      // here, otherwise the next prompt's `appendStreamingDelta` reads a
      // stale `streamingMessageId` whose target row was replaced by the
      // projection — and silently drops every delta (`findIndex === -1`).
      // That stale-pointer bug was the visible symptom of "半天没返回":
      // the assistant bubble created by `beginStreamingMessage` during the
      // replay survives `loadHistoryMessages` because the bubble id is still
      // in `streamingMessageId`, but the row it pointed to is gone from
      // `messages[]`. Wiping both views here closes the race.
      const cleaned = cleanupOrphanHistory(messages);
      return {
        messages: cleaned,
        streamingMessageId: null,
        streamState: INITIAL_STREAMING_STATE,
      };
    });
  },

  setStreaming: (streaming) => set({ streaming }),
  setPlanMode: (planMode) => set({ planMode }),

  // pi-web-alignment — drives the phase state machine. Side effect: keeps
  // the legacy `streaming` boolean in sync with `phase.kind !== "idle"`
  // so existing callers (composer lock, LoadingRow) keep working without
  // a big-bang rewrite. The next refactor can drop the boolean once all
  // consumers move to `phase`.
  applyPhaseEvent: (event) => {
    set((s) => {
      const next = phaseReducer(s.phase, event);
      if (next === s.phase) return s;
      return { phase: next, streaming: next.kind !== "idle" };
    });
  },

  // R2 — defensive snapshot:
  // `Plan` object they passed in (e.g. for further mutations or to pass
  // to a different consumer) without affecting what's rendered. structuredClone
  // gives us a deep copy; for the tiny Plan payload the cost is negligible
  // and prevents the classic "I changed my local object and the UI followed
  // along" footgun.
  setPlan: (plan) => set({ plan: plan ? structuredClone(plan) : null }),

  // The bubble is appended straight into the `messages` mirror: nothing in
  // the live event stream replays the user's own message back (pi only sends
  // assistant deltas + tool events), so storing it aside means it never
  // renders. On rollback popOptimistic removes it by id; on success the
  // message is exactly what pi persists, so it stays until the next
  // projection (session switch) rebuilds the mirror from the JSONL.
  pushOptimisticUser: (text) => {
    const id = nextId();
    const bubble = {
      id,
      role: "user" as const,
      parts: [{ kind: "text" as const, text }],
      complete: true,
    };
    set((s) => ({
      optimisticBubble: bubble,
      messages: [...s.messages, bubble],
    }));
    return id;
  },

  popOptimistic: () => set((s) => {
    const bubble = s.optimisticBubble;
    if (!bubble) return { optimisticBubble: null };
    return {
      optimisticBubble: null,
      messages: s.messages.filter((m) => m.id !== bubble.id),
    };
  }),

  setError: (error) => set({ error }),

  beginStreamingMessage: () => {
    // 上一轮可能残留未 flush 的 delta(异常中止路径),丢弃防止串进新消息。
    discardStreamingBuffer();
    const id = nextId();
    set((s) => ({
      messages: [...s.messages, { id, role: "assistant", parts: [], complete: false }],
      streamingMessageId: id,
      // Drive the new single-source-of-truth reducer too. Same id so any
      // consumer that watches both views sees them stay coherent.
      streamState: streamReducer(s.streamState, { type: "start", id }),
    }));
    return id;
  },

  appendStreamingDelta: (delta, kind = "text") => {
    if (!useSessionStore.getState().streamingMessageId) return;
    // A kind switch (reasoning → answer, or back) must not be swallowed into
    // the buffered run of the previous kind: flush what is pending first so the
    // two land as separate parts in arrival order.
    if (kind !== pendingDeltaKind) {
      flushStreamingBuffer();
      pendingDeltaKind = kind;
    }
    pendingDelta += delta;
    if (deltaRafId !== null) return;
    deltaRafId = scheduleDeltaFlush();
  },

  finishStreamingMessage: () => {
    // flush 保证缓冲里的文本先落进消息,再标记完成。
    flushStreamingBuffer();
    set((s) => {
      const target = findFinalisableAssistant(s);
      if (!target) {
        // Nothing to mark complete — still drop the dangling id so the
        // next beginStreamingMessage() doesn't reuse it.
        return {
          streamingMessageId: null,
          streamState: streamReducer(s.streamState, { type: "end" }),
        };
      }
      return {
        messages: s.messages.map((m) =>
          m.id === target.id ? { ...m, complete: true } : m,
        ),
        streamingMessageId: null,
        streamState: streamReducer(s.streamState, { type: "end" }),
      };
    });
  },

  abandonStreamingMessage: (reason) => {
    // 异常兜底：把所有异常路径(turn-error / agent-died / watchdog /
    // 用户 cancel)统一收口；找不到目标就只清 streamingMessageId。
    // 与 finishStreamingMessage 不同：若目标消息 parts 为空，会写入一
    // 条"已中断"占位文本，避免 LoadingRow 无限旋转。
    flushStreamingBuffer();
    set((s) => {
      const target = findFinalisableAssistant(s);
      if (!target) {
        return {
          streamingMessageId: null,
          streamState: streamReducer(s.streamState, { type: "end" }),
        };
      }
      const parts =
        target.parts.length > 0
          ? target.parts
          : [{ kind: "text" as const, text: `（已中断：${reason}）` }];
      return {
        messages: s.messages.map((m) =>
          m.id === target.id ? { ...m, parts, complete: true } : m,
        ),
        streamingMessageId: null,
        streamState: streamReducer(s.streamState, { type: "end" }),
      };
    });
  },

  reset: () => {
    discardStreamingBuffer();
    set({
      sessionId: null,
      streaming: false,
      planMode: false,
      optimisticBubble: null,
      error: null,
      messages: [],
      streamingMessageId: null,
      plan: null,
      streamState: INITIAL_STREAMING_STATE,
      phase: IDLE_PHASE,
      pendingSessionIds: new Set<string>() as ReadonlySet<string>,
    });
  },

  // Phase R3.0 — gate for destructive actions on optimistic session ids.
  // Adds `pendingId` to the set; consumers (Sidebar, Topbar) read via
  // `pendingSessionIds.has(id)` or `isPending(id)`. Idempotent.
  markPending: (pendingId) => {
    set((s) => {
      if (s.pendingSessionIds.has(pendingId)) return s;
      const next = new Set(s.pendingSessionIds);
      next.add(pendingId);
      return { pendingSessionIds: next };
    });
  },

  // Phase R3.0 — removes `pendingId` from the pending set. If `realId` is
  // provided AND the pending id was the focused session, migrate the focus
  // to the real id (mirrors `migrateSession` semantics). If `realId` is
  // null/undefined, just drop the pending id (rollback path).
  markResolved: (pendingId, realId) => {
    set((s) => {
      if (!s.pendingSessionIds.has(pendingId)) return s;
      const next = new Set(s.pendingSessionIds);
      next.delete(pendingId);
      // Migrate only when the resolved id differs from the pending one.
      if (realId && realId !== pendingId && s.sessionId === pendingId) {
        return {
          pendingSessionIds: next,
          sessionId: realId,
        };
      }
      return { pendingSessionIds: next };
    });
  },

  isPending: (id) => get().pendingSessionIds.has(id),

  // pi-web-alignment — pure dispatch to the streaming reducer. We do NOT
  // mirror into `messages[]` here on purpose: callers that still consume
  // the legacy `streamingMessageId`/`appendStreamingDelta` path keep
  // working unchanged, and a future migration can simply replace the
  // App.tsx event handler to call only `applyStreamAction` and read
  // `streamState.message`. Until then the two views stay coherent because
  // both are seeded from the same `streamingMessageId`.
  applyStreamAction: (action) => {
    set((s) => ({ streamState: streamReducer(s.streamState, action) }));
  },

  // pi-web-alignment — read-only convenience: returns the in-flight
  // assistant bubble in the legacy `ChatMessage` shape. Null when no
  // turn is active. Consumers can use this as a drop-in replacement for
  // the last entry of `messages[]` during a streaming session.
  streamingMessage: (): ChatMessage | null => {
    const state = useSessionStore.getState();
    const streaming = state.streamState.message;
    if (!streaming) return null;
    const parts: ChatMessage["parts"] = streaming.parts.map((p: { kind: string; text?: string; toolCallId?: string; title?: string; toolKind?: string; status?: ToolCallView["status"]; content?: ToolCallContent[]; rawInput?: unknown; partial?: boolean }) => {
      if (p.kind === "text") return { kind: "text", text: p.text ?? "" };
      if (p.kind === "thought") return { kind: "thought", text: p.text ?? "" };
      // p.kind === "tool_call"
      return {
        kind: "tool_call",
        toolCall: {
          toolCallId: p.toolCallId ?? "",
          title: p.title ?? "tool",
          kind: p.toolKind ?? "tool",
          status: p.status ?? "in_progress",
          content: p.content ?? [],
          rawInput: p.rawInput,
          partial: p.partial,
          partialResult: undefined,
        },
      };
    });
    return {
      id: streaming.id,
      role: "assistant",
      parts,
      complete: streaming.complete,
    };
  },
}));
/**
 * Stub for `registerForeignUpdateListener` — historical reference to
 * `openbuddy-ui-automation/InspirationPanel` removed during the pi-native
 * Stage A cleanup. Returning a no-op unsubscribe keeps the renderer bundle
 * building without dragging in the legacy session plumbing. If a future
 * pi-native panel needs foreign updates, replace this with a real
 * subscription on the session store.
 */
export function registerForeignUpdateListener(
  _sessionId: string,
  _onUpdate: (update: unknown) => void,
): () => void {
  return () => {
    /* no-op */
  };
}
