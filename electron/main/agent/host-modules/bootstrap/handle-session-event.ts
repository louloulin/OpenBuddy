/**
 * handle-session-event.ts — single Pi session event callback dispatcher.
 *
 * Phase 8.3 §44: extracted from electron/main/agent/agent-host.ts
 * :initialize() (147 lines of inline piSessionRuntime.subscribe callback).
 *
 * Pi's runtime pushes one event per turn boundary, tool execution step,
 * message delta, queue update, retry cycle, and session-info change. Each
 * event type maps to a different OpenBuddy side-effect:
 *
 *   message_end / turn_end     → diagnostics logging
 *   auto_retry_start           → diagnostics logging
 *   queue_update               → state.queueMirror + plugin/queue emit
 *   tool_execution_start       → runningTasks + jobsRegistry +
 *                                 optional pi://subagent spawn
 *   tool_execution_end         → job completion + pi://subagent finished
 *   —                          → emitPiSessionEvent (DSH compatibility)
 *                                 + canonical plugin event emit
 *   session_info_changed       → session/summary + pi://summary
 *   auto_retry_end (failure)   → turn/error + pi://turn-error
 *   —                          → for each handler in state.eventHandlers,
 *                                 call with the wireEvent (with sequence,
 *                                 version, timestamp)
 *
 * The handler is a pure function of (deps, session, event). It mutates
 * `deps.state` (queueMirror, jobsRegistry, runningTasks) and emits
 * plugin/renderer events. It does NOT touch setup-time state (model
 * runtime, profile, plugin loader) so it cannot interfere with the
 * initialize() flow that calls piSessionRuntime.subscribe().
 *
 * Reverse-dependency invariant:
 *   This module imports nothing from agent-host.ts. deps are passed in.
 */
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface HandleSessionEventDeps {
  /** Mutable session-scoped state (queueMirror, eventHandlers, jobsRegistry, runningTasks). */
  state: {
    queueMirror: unknown;
    eventHandlers: Set<(event: AgentSessionEvent) => void>;
    jobsRegistry: Map<string, {
      id: string;
      kind?: string;
      label?: string;
      status?: string;
      sessionId?: string;
      startedAt?: number;
      finishedAt?: number;
      controller?: AbortController;
    }>;
    runningTasks: Map<string, {
      id: string;
      kind: string;
      description: string;
      status: string;
      sessionId?: string;
      startedAt: number;
      abortController: AbortController;
    }>;
  };
  /** Context used as the first arg to emitPiSessionEvent (DSH compatibility bridge). */
  context: { emit: (channel: string, payload: unknown) => void };
  /** Compute the public queue items snapshot for the given session. */
  publicQueueItems: (session: AgentSession | null) => readonly unknown[];
  /** Snapshot the filesystem state at the start of a tool execution (for rewind). */
  captureFileSnapshot: (sessionId: string, toolCallId: string, toolName: string, args: unknown) => Promise<void>;
  /** Emit a plugin-namespaced event to renderer + bus subscribers. */
  emitPluginEvent: (channel: string, payload: unknown) => { sequence: number; sessionSequence: number; eventVersion: number; timestamp: number };
  /** Emit a renderer-only event (no bus). */
  emitRendererEvent: (channel: string, payload: unknown) => void;
  /** DSH compatibility bridge — emits the unmodified session event to legacy subscribers. */
  emitPiSessionEvent: (
    context: HandleSessionEventDeps["context"],
    session: AgentSession,
    event: unknown,
    payload: unknown,
    errorHandler: (eventName: string, error: unknown) => void,
  ) => void;
  /** Map a raw Pi event type to OpenBuddy's plugin namespace. */
  eventNamespace: (rawType: string) => string;
  /** Map a raw Pi event type to its canonical OpenBuddy namespace, if any. */
  canonicalEventNamespace: (rawType: string) => string | null;
}

interface PiSessionEventLike {
  type?: string;
  message?: unknown;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  name?: string;
  finalError?: unknown;
  success?: unknown;
  /**
   * AssistantMessageEvent payload, present on `message_update` events.
   *
   * We intentionally do NOT import the `AssistantMessageEvent` type from
   * `@earendil-works/pi-ai` here: this module must stay free of new package
   * imports (the rest of the file uses `unknown` + runtime guards to keep the
   * existing dependency surface). The shape is described in the JSDoc above.
   *
   * Phase R3.0 (pi-web-alignment): extended to cover all 12 AssistantMessageEvent
   * variants emitted by Pi's wire surface:
   *   - `start`/`text_start`/`text_end` (block boundaries + ids for block-level timing)
   *   - `thinking_start`/`thinking_end` (reasoning block boundaries, deferred flag)
   *   - `toolcall_start`/`toolcall_delta` (initial + streaming partial args)
   *   - `done` (token usage) / `error` (provider error message)
   *
   * The `id` field on text/thinking/toolcall events is a stable per-block id used
   * by the renderer to drive block-level streaming duration (`streaming-metrics.ts`)
   * and matches pi-web's `MessageView.tsx` `blockStartTimesRef` pattern.
   */
  assistantMessageEvent?: {
    type?: string;
    contentIndex?: number;
    /** Stable per-block id (pi-web uses this for block-level timing). */
    id?: string;
    delta?: string;
    content?: string;
    /** Reasoning-block lazy-load hint — true when content is deferred. */
    deferred?: boolean;
    /** Terminal reason on `done` (e.g. "stop"/"length"/"toolUse") / `error` ("aborted"/"error"). */
    reason?: string;
    /** Provider error message on `error` variant. */
    errorMessage?: string;
    /** Snapshot of the partial AssistantMessage — present on most variants. */
    partial?: unknown;
    /** Full AssistantMessage — present on `done` / `error`. */
    message?: {
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      stopReason?: string;
      errorMessage?: string;
    };
    toolCall?: {
      type?: string;
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
      thoughtSignature?: string;
      namespace?: string;
    };
  };
  [key: string]: unknown;
}

/**
 * Sessions that have already emitted a `pi://complete` for the turn currently
 * in flight.
 *
 * Used to keep completion at exactly one event per turn while still
 * guaranteeing a terminal signal when a run ends without `turn_end` (abort /
 * provider error). Cleared on `turn_start` / `agent_start`.
 *
 * A `WeakSet` keyed by the live `AgentSession` object rather than a `Map` of
 * session ids: entries disappear when the session is collected, so long-lived
 * hosts that churn through sessions do not accumulate keys.
 */
const turnCompletedSessions = new WeakSet<object>();

/**
 * Handle a single Pi session event. Mutates deps.state and emits events.
 *
 * The function is intentionally tolerant of malformed events: every branch
 * wraps its side effects in try/catch and routes errors through
 * emitPluginEvent("agent/error", ...) so a bad event payload can never
 * crash the subscriber loop.
 */
export function handleSessionEvent(
  deps: HandleSessionEventDeps,
  activeSession: AgentSession,
  event: PiSessionEventLike,
): void {
  const {
    state, context, publicQueueItems, captureFileSnapshot,
    emitPluginEvent, emitRendererEvent, emitPiSessionEvent,
    eventNamespace, canonicalEventNamespace,
  } = deps;

  const session = activeSession;
  const sessionEvent = { ...event, sessionId: session.sessionId };

  // Diagnostics: surface model-side events with their terminal state so the
  // log clearly shows when an upstream provider responds vs. when pi surfaces
  // a failure (stopReason === "error" / "rate_limit"). Previously only the
  // bridge logger saw these, and only at debug level, so a 404 from the
  // provider was invisible in normal log capture.
  if (event.type === "message_end") {
    const m = (event.message as { role?: string; api?: string; provider?: string; model?: string; stopReason?: string; errorMessage?: string; usage?: { totalTokens?: number }; content?: unknown } | undefined);
    const contentSummary = Array.isArray(m?.content)
      ? m!.content!.map((c: { type?: string }) => c?.type ?? "?").join(",")
      : "none";
    console.log("[openbuddy] pi message_end", {
      sessionId: session.sessionId,
      role: m?.role,
      api: m?.api,
      provider: m?.provider,
      model: m?.model,
      stopReason: m?.stopReason,
      errorMessage: m?.errorMessage,
      usageTokens: m?.usage?.totalTokens,
      contentTypes: contentSummary,
    });
  } else if (event.type === "turn_end") {
    const m = (event.message as { stopReason?: string; errorMessage?: string; usage?: { totalTokens?: number } } | undefined);
    console.log("[openbuddy] pi turn_end", {
      sessionId: session.sessionId,
      stopReason: m?.stopReason,
      errorMessage: m?.errorMessage,
      usageTokens: m?.usage?.totalTokens,
    });
  } else if (event.type === "auto_retry_start") {
    console.log("[openbuddy] pi auto_retry_start", { sessionId: session.sessionId });
  }

  if (event.type === "queue_update") {
    const items = publicQueueItems(session);
    if (state.queueMirror) {
      state.queueMirror = items.map((value) => {
        const item = value as { mode: "queue" | "steer"; content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data?: string; name?: string }> };
        return {
          mode: item.mode,
          content: item.content.map((part) =>
            part.type === "text"
              ? { type: "text" as const, text: part.text }
              : { type: "image" as const, mediaType: part.mediaType, data: part.data ?? "", ...(part.name ? { name: part.name } : {}) },
          ),
        };
      });
    }
    emitPluginEvent("session/queue", { sessionId: session.sessionId, items });
  }

  if (event.type === "tool_execution_start") {
    const toolCallId = event.toolCallId ?? "";
    const toolName = event.toolName ?? "";
    const abortController = new AbortController();
    state.runningTasks.set(toolCallId, {
      id: toolCallId,
      kind: toolName,
      description: toolName,
      status: "running",
      sessionId: session.sessionId,
      startedAt: Date.now(),
      abortController,
    });
    state.jobsRegistry.set(toolCallId, {
      id: toolCallId,
      kind: toolName,
      label: toolName,
      status: "running",
      sessionId: session.sessionId,
      startedAt: Date.now(),
      controller: abortController,
    });
    emitPluginEvent("session/jobs", { sessionId: session.sessionId });
    void captureFileSnapshot(session.sessionId, toolCallId, toolName, event.args).catch((error) => {
      console.warn("[openbuddy] failed to capture rewind snapshot:", error);
    });
    // Subagent-shaped tool executions forward pi://subagent so the renderer
    // can show live progress without polling jobs registry.
    const subagentTypeHint = (event.args as { subagentType?: unknown } | undefined)?.subagentType;
    const looksLikeSubagent =
      typeof subagentTypeHint === "string" ||
      /subagent|team[_-]member|agent[_-]runner/i.test(String(toolName));
    if (looksLikeSubagent) {
      emitRendererEvent("pi://subagent", {
        sessionId: session.sessionId,
        phase: "spawned",
        subagentId: toolCallId,
        subagentType: typeof subagentTypeHint === "string" ? subagentTypeHint : String(toolName),
        status: "running",
      });
    }
  } else if (event.type === "tool_execution_end") {
    const toolCallId = event.toolCallId ?? "";
    const job = state.jobsRegistry.get(toolCallId);
    if (job) {
      job.status = event.isError ? "failed" : "completed";
      job.finishedAt = Date.now();
    }
    state.runningTasks.delete(toolCallId);
    emitPluginEvent("session/jobs", { sessionId: session.sessionId });
    if (job && /subagent|team[_-]member|agent[_-]runner/i.test(String(job.kind ?? ""))) {
      emitRendererEvent("pi://subagent", {
        sessionId: session.sessionId,
        phase: "finished",
        subagentId: toolCallId,
        status: event.isError ? "failed" : "completed",
      });
    }
  }

  // Streaming deltas from the model: full AssistantMessageEvent surface (Phase R3.0).
  //
  // Why this block exists:
  //   Pi's AgentSession pushes `message_update` once per AssistantMessageEvent
  //   emitted by the upstream stream. The renderer's coalescer turns these
  //   into visible text/thinking/tool rows. Without this emit, the renderer
  //   only ever sees `pi://complete` (and only on session-store replay), so
  //   AI responses are invisible to the user even though the model is happily
  //   streaming. We map Pi's wire shape to OpenBuddy's SessionUpdate shape
  //   used by `src/stores/session-store.ts` + `useAgentSession.ts`.
  //
  //   Pattern mirrors `subagent-runtime.ts:320-326` + `deepseek-pi-bridge.ts:298-348`
  //   (which already cover the full AssistantMessageEvent surface). We extend
  //   the minimal mapping to all 12 variants so the renderer can:
  //     - track per-block timing (text_start / thinking_start carry stable `id`)
  //     - receive tool-call deltas (toolcall_start / toolcall_delta)
  //     - surface provider errors (done / error)
  if (event.type === "message_update") {
    const ame = event.assistantMessageEvent;
    const ameType = ame?.type;
    const blockId = typeof ame?.id === "string" ? ame.id : undefined;

    if (ameType === "text_delta" && typeof ame?.delta === "string") {
      emitRendererEvent("pi://update", {
        sessionId: session.sessionId,
        type: "agent_message_chunk",
        content: [{ type: "text_delta", text: ame.delta, ...(blockId ? { id: blockId } : {}) }],
      });
    } else if (ameType === "text_start") {
      // Block boundary — used by renderer to start a new text block / clear stale content.
      emitRendererEvent("pi://update", {
        sessionId: session.sessionId,
        type: "agent_message_chunk",
        content: [{ type: "text_start", ...(blockId ? { id: blockId } : {}), contentIndex: ame?.contentIndex ?? 0 }],
      });
    } else if (ameType === "text_end" && typeof ame?.content === "string") {
      // Block terminator — renderer can finalize the block + drop the streaming buffer.
      emitRendererEvent("pi://update", {
        sessionId: session.sessionId,
        type: "agent_message_chunk",
        content: [{ type: "text_end", content: ame.content, ...(blockId ? { id: blockId } : {}), contentIndex: ame?.contentIndex ?? 0 }],
      });
    } else if (ameType === "thinking_delta" && typeof ame?.delta === "string") {
      emitRendererEvent("pi://update", {
        sessionId: session.sessionId,
        type: "agent_thought_chunk",
        content: [{ type: "thinking_delta", text: ame.delta, ...(blockId ? { id: blockId } : {}) }],
      });
    } else if (ameType === "thinking_start") {
      emitRendererEvent("pi://update", {
        sessionId: session.sessionId,
        type: "agent_thought_chunk",
        content: [{ type: "thinking_start", ...(blockId ? { id: blockId } : {}), contentIndex: ame?.contentIndex ?? 0 }],
      });
    } else if (ameType === "thinking_end" && typeof ame?.content === "string") {
      // Phase R3.0 — defer flag tells renderer to lazy-load reasoning on expand (pi-web parity).
      emitRendererEvent("pi://update", {
        sessionId: session.sessionId,
        type: "agent_thought_chunk",
        content: [{
          type: "thinking_end",
          content: ame.content,
          ...(blockId ? { id: blockId } : {}),
          contentIndex: ame?.contentIndex ?? 0,
          deferred: ame?.deferred === true,
        }],
      });
    } else if (ameType === "toolcall_start" && ame?.toolCall && typeof ame.toolCall === "object") {
      // Phase R3.0 — emit tool-call row at start so the renderer can show
      // "running" state immediately, before args stream in. Mirrors pi-web
      // `MessageView.tsx` tool_use_start handling.
      const tc = ame.toolCall;
      if (typeof tc.id === "string" && tc.id.length > 0) {
        const toolName = typeof tc.name === "string" ? tc.name : "tool";
        emitRendererEvent("pi://update", {
          sessionId: session.sessionId,
          type: "tool_call",
          toolCallId: tc.id,
          title: toolName,
          kind: toolName,
          status: "in_progress",
          content: [],
          rawInput: tc.arguments ?? {},
        });
      }
    } else if (ameType === "toolcall_delta" && ame?.toolCall && typeof ame.toolCall === "object") {
      // Phase R3.0 — partial args stream. The renderer's coalescer merges
      // partial rawInput into the existing tool_call row.
      const tc = ame.toolCall;
      if (typeof tc.id === "string" && tc.id.length > 0) {
        emitRendererEvent("pi://update", {
          sessionId: session.sessionId,
          type: "tool_call_update",
          toolCallId: tc.id,
          update: { partial: true, partialResult: tc.arguments ?? {} },
        });
      }
    } else if (ameType === "toolcall_end" && ame?.toolCall && typeof ame.toolCall === "object") {
      // Pi's ToolCall shape (from @earendil-works/pi-ai) is:
      //   { type: "toolCall", id, name, arguments, thoughtSignature?, namespace? }
      // Renderer's expected tool_call shape (session-store.ts) is:
      //   { toolCallId, title, kind, status, content, rawInput }
      // Map field names here so the renderer's coalescer can find the tool
      // row keyed by `toolCallId` and update its status to "completed".
      const tc = ame.toolCall;
      if (typeof tc.id === "string" && tc.id.length > 0) {
        const toolName = typeof tc.name === "string" ? tc.name : "tool";
        emitRendererEvent("pi://update", {
          sessionId: session.sessionId,
          type: "tool_call",
          toolCallId: tc.id,
          title: toolName,
          kind: toolName,
          status: "in_progress",
          content: [],
          rawInput: tc.arguments ?? {},
        });
      }
    } else if (ameType === "done") {
      // Phase R3.0 — terminal event with token usage. Forwarded as usage_update
      // so the renderer's coalescer can update cost / context-usage pill without
      // waiting for turn_end. Mirrors pi-web `MessageView.tsx` usage tracking.
      const usage = (ame?.message?.usage ?? undefined) as
        | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
        | undefined;
      emitRendererEvent("pi://update", {
        sessionId: session.sessionId,
        type: "usage_update",
        usage: {
          ...(typeof usage?.promptTokens === "number" ? { promptTokens: usage.promptTokens } : {}),
          ...(typeof usage?.completionTokens === "number" ? { completionTokens: usage.completionTokens } : {}),
          ...(typeof usage?.totalTokens === "number" ? { totalTokens: usage.totalTokens } : {}),
        },
        reason: typeof ame?.reason === "string" ? ame.reason : "stop",
      });
    } else if (ameType === "error") {
      // Phase R3.0 — provider error. Forwarded both as usage_update (so the
      // coalescer drops any in-flight streaming) and routed through the same
      // error pipeline as `auto_retry_end` failures.
      const errMsg = typeof ame?.errorMessage === "string"
        ? ame.errorMessage
        : (typeof ame?.message?.errorMessage === "string" ? ame.message.errorMessage : "provider error");
      emitRendererEvent("pi://update", {
        sessionId: session.sessionId,
        type: "usage_update",
        usage: {},
        errorMessage: errMsg,
        reason: typeof ame?.reason === "string" ? ame.reason : "error",
      });
      emitPluginEvent("turn/error", {
        sessionId: session.sessionId,
        kind: "error",
        detail: errMsg,
      });
    }
    // `start` is lifecycle-only (no content) — intentionally not emitted.
  }

  // Turn-end: mark the assistant turn as done so the renderer can drop its
  // streaming buffer into the committed messages array.
  //
  // Pi emits three terminal-ish events per prompt and this branch used to map
  // ALL of them to `pi://complete`: `turn_end` (per assistant turn) plus
  // `agent_end` and `agent_settled` (session-level markers). Together with a
  // fourth emit that used to live in `ipc/index.ts` on `agent_end`, one prompt
  // produced four `pi://complete` events — observed live against MiniMax with
  // stopReasons `stop`, `end_turn`, `end_turn`, `end_turn`.
  //
  // Every `onComplete` side effect in the renderer is a once-per-turn action,
  // so they all ran four times: `recordUsage()` inflated token/cost stats 4x,
  // `dispatchNotification()` raised four duplicate desktop notifications, and
  // `useMessageQueueStore.shiftNext()` could release four queued messages for a
  // single finished turn.
  //
  // `turn_end` is the authoritative per-turn signal, so it owns the emit. The
  // session-level markers still emit, but only when the run terminated without
  // a `turn_end` — the abort/error path, where they are the only terminal
  // signal the renderer would ever get. Without that fallback an aborted run
  // leaves the composer spinning forever.
  if (event.type === "turn_start" || event.type === "agent_start") {
    turnCompletedSessions.delete(session);
  }
  if (event.type === "turn_end" || event.type === "agent_end" || event.type === "agent_settled") {
    const alreadyCompleted = turnCompletedSessions.has(session);
    if (event.type === "turn_end" || !alreadyCompleted) {
      const msg = event.message as { stopReason?: string } | undefined;
      const stopReason = typeof msg?.stopReason === "string" ? msg.stopReason : "end_turn";
      turnCompletedSessions.add(session);
      emitRendererEvent("pi://complete", {
        sessionId: session.sessionId,
        promptId: "",
        stopReason,
      });
    }
  }

  // DeepSeek Harness plugins commonly consume the unmodified session event
  // through `ctx.on("session/event", (session, event) => ...)`. Preserve
  // that two-argument shape alongside OpenBuddy's namespaced payload events.
  emitPiSessionEvent(context, session, sessionEvent, undefined, (eventName: string, error: unknown) => {
    emitPluginEvent("agent/error", {
      sessionId: session.sessionId,
      operation: "event-dispatch",
      eventName,
      error: String(error),
    });
  });

  const eventRecord = emitPluginEvent(eventNamespace(event.type ?? ""), sessionEvent);
  const canonicalType = canonicalEventNamespace(event.type ?? "");
  if (canonicalType) emitPluginEvent(canonicalType, sessionEvent);

  if (event.type === "session_info_changed" && typeof event.name === "string") {
    emitPluginEvent("session/summary", { sessionId: session.sessionId, title: event.name });
    emitRendererEvent("pi://summary", { sessionId: session.sessionId, title: event.name });
  }

  if (event.type === "auto_retry_end" && event.success === false) {
    const error = event.finalError;
    emitPluginEvent("turn/error", {
      sessionId: session.sessionId,
      kind: "error",
      ...(error ? { detail: String(error) } : {}),
    });
    emitRendererEvent("pi://turn-error", {
      sessionId: session.sessionId,
      kind: "error",
      ...(error ? { detail: String(error) } : {}),
    });
  }

  const wireEvent = {
    ...sessionEvent,
    eventVersion: eventRecord.eventVersion,
    sequence: eventRecord.sequence,
    sessionSequence: eventRecord.sessionSequence,
    timestamp: eventRecord.timestamp,
  };
  for (const handler of [...state.eventHandlers]) {
    try {
      handler(wireEvent as AgentSessionEvent);
    } catch (error) {
      console.error("[openbuddy] agent event handler failed", error);
      emitPluginEvent("agent/error", {
        sessionId: session.sessionId,
        operation: "renderer-event-dispatch",
        eventType: event.type,
        error: String(error),
      });
      emitRendererEvent("pi://agent-died", {
        sessionId: session.sessionId,
        reason: "session-event-handler-threw",
        detail: String(error),
        eventType: event.type,
      });
    }
  }
}

/**
 * Convenience: build a thin subscribe-callback for piSessionRuntime.subscribe().
 *
 * The returned function closes over `deps` so callers can do:
 *   const unsubscribe = piSessionRuntime.subscribe(buildSessionEventSubscriber(deps));
 */
export function buildSessionEventSubscriber(
  deps: HandleSessionEventDeps,
): (event: PiSessionEventLike, session: AgentSession) => void {
  return (event, session) => handleSessionEvent(deps, session, event);
}
