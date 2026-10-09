/**
 * streamReducer — stable shape for an in-flight assistant message.
 *
 * Why this exists (Phase pi-web-alignment):
 *
 * The historical chat path (see `session-store.ts` `mergeStreamingDelta`)
 * coalesces `agent_message_chunk` deltas into a rAF batch, but every batch
 * still mutates `messages[]` with `findIndex + slice`. That keeps the
 * streaming message a sibling of the historical transcript, which means
 * every ChatView render that consumes `messages` must re-walk the full
 * array and React.memo cannot skip the streaming bubble. pi-web instead
 * stores the streaming message **outside** the persisted transcript and
 * concatenates them only at render time.
 *
 * This module ships the same shape as a pure reducer so we can:
 * 1. Adopt it incrementally — the reducer is fully usable with no store
 *    changes. We can wrap it in a selector helper when migrating the
 *    ChatView consumption.
 * 2. Drive both the new `streamState.streamingMessage` slot AND the
 *    legacy `messages[]` mirror from the same action stream during the
 *    migration window.
 *
 * The reducer is *pure* (no Zustand, no React) so it is cheap to unit-test
 * in isolation and re-usable from any host (hook, store, saga).
 *
 * Events accepted on the wire (mirror `SessionUpdate`):
 * - `agent_message_chunk`        → `delta` with TextContent[]
 * - `agent_thought_chunk`        → `delta` with ThoughtContent[] (separate
 *                                  bubble)
 * - `tool_call`                  → `appendPart` (tool_call part)
 * - `tool_call_update`           → `updatePart` (partial update)
 * - `agent_complete` / `cancel`  → `end`
 */

import type {
  AgentMessageChunk,
  AgentThoughtChunk,
  ToolCallContent,
  ToolCallStatus,
  ToolCallUpdate,
  ToolCallDeltaUpdate,
} from "@openbuddy/shared-types";

// ---------------------------------------------------------------------------
// Stable shape — the in-flight assistant message
// ---------------------------------------------------------------------------

/** A tool_call part — extracted as a named alias so reducer internals can
 *  reference it without re-using `Extract<StreamPart, ...>` at every
 *  narrowing site. */
export interface ToolCallPart {
  kind: "tool_call";
  toolCallId: string;
  title: string;
  /** Wire `toolKind` discriminator (e.g. "read_file"). */
  toolKind: string;
  status: ToolCallStatus;
  content: ToolCallContent[];
  partial?: boolean;
  rawInput?: unknown;
}

export type StreamPart =
  | { kind: "text"; text: string }
  | { kind: "thought"; text: string }
  | ToolCallPart;

function isToolCallPart(part: StreamPart): part is ToolCallPart {
  return part.kind === "tool_call";
}

export interface StreamingMessage {
  /** Stable id used by React.memo and the rAF scheduler. */
  id: string;
  /** The persisted-precursor role — always "assistant" today, but typed
   *  for forward-compat with subagent transcripts. */
  role: "assistant";
  /** Parts in arrival order. Text/thought parts are merged in-place to keep
   *  this array short even after thousands of deltas. */
  parts: StreamPart[];
  /** Monotonic update counter — useful for `===` equality on the renderer. */
  revision: number;
  /** Wall-clock timestamp of the first delta — used for the per-turn elapsed
   *  indicator without an extra ref. */
  startedAt: number;
  /** True once the agent stops emitting chunks for this message. */
  complete: boolean;
}

export interface StreamingState {
  /** Null when no assistant turn is currently in-flight. */
  message: StreamingMessage | null;
  /** Latest usage stats observed during this turn (optional; some turns
   *  never produce them). */
  lastUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export const INITIAL_STREAMING_STATE: StreamingState = { message: null };

// ---------------------------------------------------------------------------
// Reducer actions
// ---------------------------------------------------------------------------
export interface ToolCallPatch {
  kind: "tool_call";
  status?: ToolCallStatus;
  partial?: boolean;
  rawInput?: unknown;
  title?: string;
  toolKind?: string;
  content?: ToolCallContent[];
}

export type StreamAction =
  | { type: "start"; id: string; at?: number }
  | { type: "delta"; text: string; part: "text" | "thought"; at?: number }
  | { type: "appendPart"; part: StreamPart }
  | { type: "updatePart"; toolCallId: string; patch: ToolCallPatch }
  | { type: "end" }
  | { type: "reset" }
  | { type: "usage"; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const emptyMessage = (id: string, at: number): StreamingMessage => ({
  id,
  role: "assistant",
  parts: [],
  revision: 0,
  startedAt: at,
  complete: false,
});

export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start": {
      const at = action.at ?? Date.now();
      return {
        message: { ...emptyMessage(action.id, at) },
        lastUsage: state.lastUsage,
      };
    }

    case "delta": {
      const msg = state.message;
      if (!msg || msg.complete) return state;
      const tail = msg.parts[msg.parts.length - 1];
      const nextPart: StreamPart | null =
        tail && tail.kind === action.part
          ? { ...tail, text: tail.text + action.text }
          : action.part === "text"
            ? { kind: "text", text: action.text }
            : { kind: "thought", text: action.text };
      const nextParts = tail && tail.kind === action.part
        ? msg.parts.slice(0, -1).concat(nextPart)
        : msg.parts.concat(nextPart);
      return {
        ...state,
        message: { ...msg, parts: nextParts, revision: msg.revision + 1 },
      };
    }

    case "appendPart": {
      const msg = state.message;
      if (!msg) return state;
      return {
        ...state,
        message: { ...msg, parts: [...msg.parts, action.part], revision: msg.revision + 1 },
      };
    }

    case "updatePart": {
      const msg = state.message;
      if (!msg) return state;
      const idx = msg.parts.findIndex(isToolCallPart);
      if (idx === -1) return state;
      // Narrow again on the actual matched id; the first filter only confirms
      // the kind, but the action's toolCallId must match too.
      const target = msg.parts[idx];
      if (!isToolCallPart(target) || target.toolCallId !== action.toolCallId) return state;
      const next: ToolCallPart = { ...target, ...action.patch };
      const nextParts = msg.parts.slice();
      nextParts[idx] = next;
      return {
        ...state,
        message: { ...msg, parts: nextParts, revision: msg.revision + 1 },
      };
    }

    case "end": {
      const msg = state.message;
      if (!msg || msg.complete) return state;
      return { ...state, message: { ...msg, complete: true, revision: msg.revision + 1 } };
    }

    case "reset":
      return { ...INITIAL_STREAMING_STATE, lastUsage: undefined };

    case "usage":
      return { ...state, lastUsage: { ...state.lastUsage, ...action.usage } };
  }
}

// ---------------------------------------------------------------------------
// Adapters — turn the wire `SessionUpdate` payloads into `StreamAction`s.
// Returning null means the event is not stream-relevant (caller can still
// react to it elsewhere, e.g. appending a tool_call to the persisted
// transcript).
// ---------------------------------------------------------------------------

export function deltaFromTextChunk(chunk: AgentMessageChunk): StreamAction | null {
  if (!chunk.content?.length) return null;
  // chunk.content is already typed as TextContent[]; no cast needed.
  const text = chunk.content.map((c) => c.text ?? "").join("");
  if (!text) return null;
  return { type: "delta", text, part: "text" };
}

export function deltaFromThoughtChunk(chunk: AgentThoughtChunk): StreamAction | null {
  if (!chunk.content?.length) return null;
  const text = chunk.content.map((c) => c.text ?? "").join("");
  if (!text) return null;
  return { type: "delta", text, part: "thought" };
}

export function appendPartFromToolCall(update: ToolCallUpdate): StreamAction {
  return {
    type: "appendPart",
    part: {
      kind: "tool_call",
      toolCallId: update.toolCallId,
      title: update.title,
      toolKind: update.kind,
      status: update.status,
      content: update.content ?? [],
      rawInput: update.rawInput,
      partial: update.status === "in_progress",
    },
  };
}

/** Narrowed shape of the wire delta's `update` field — only the keys the
 *  streaming state actually understands. Forwarded as-is when the wire
 *  payload already matches; otherwise dropped. */
interface KnownToolCallPatch {
  status?: ToolCallStatus;
  partial?: boolean;
  rawInput?: unknown;
}

function pickKnownToolCallPatch(raw: unknown): KnownToolCallPatch {
  if (!raw || typeof raw !== "object") return {};
  const out: KnownToolCallPatch = {};
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate["status"] === "string") {
    out.status = candidate["status"] as ToolCallStatus;
  }
  if (typeof candidate["partial"] === "boolean") {
    out.partial = candidate["partial"];
  }
  if ("rawInput" in candidate) {
    out.rawInput = candidate["rawInput"];
  }
  return out;
}

export function updatePartFromToolCallDelta(update: ToolCallDeltaUpdate): StreamAction {
  return {
    type: "updatePart",
    toolCallId: update.toolCallId,
    patch: { kind: "tool_call", ...pickKnownToolCallPatch(update.update) },
  };
}
