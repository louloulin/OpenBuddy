import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { PLAN_TOOL } from "@openbuddy/protocol/plan";
import type { EngineContext } from "./engine-context.js";
import { messageText } from "./titles.js";
import type { Slot } from "./types.js";
import { planFromBranch, slimPlan, stateFromDetails } from "./builtin/plan-state.js";

/**
 * `agent://plan` (20261116-pii W3.1): the slim plan of a session's current branch — the step
 * list only, never the tool-call history. Sent after every `ob_todo` result, when a session is
 * opened or focused, and after any tree navigation (regenerate, rewind, branch switch).
 */
export function emitPlan(engine: EngineContext, sessionId: string, items: unknown) {
  engine.emit("agent://plan", { sessionId, items: slimPlan(items) });
}
/** Rebuild the plan from the slot's current branch and send it. */
export function emitBranchPlan(engine: EngineContext, slot: Slot) {
  emitPlan(engine, slot.id, planFromBranch(slot.session.sessionManager).items);
}

/**
 * Strip the cumulative `message` / `partial` snapshots from streaming events.
 * They grow with the reply, so forwarding them per token makes IPC cost
 * quadratic; the renderer reassembles content from deltas and `message_end`.
 */
export function slimEvent(event: AgentSessionEvent): unknown {
  if (event.type === "message_update") {
    const source = event.assistantMessageEvent as unknown as Record<string, unknown> & {
      type: string;
      contentIndex?: number;
      partial?: { content?: Array<Record<string, unknown>>; usage?: unknown };
      error?: { errorMessage?: string };
    };
    // Raw argument deltas are summarized by the engine instead (see toolArgProgress).
    if (source.type === "toolcall_delta") return undefined;
    const slim: Record<string, unknown> = { type: source.type };
    for (const key of ["contentIndex", "delta", "content", "toolCall", "reason"])
      if (source[key] !== undefined) slim[key] = source[key];
    if (source.type === "toolcall_start" && source.contentIndex !== undefined) {
      const part = source.partial?.content?.[source.contentIndex];
      if (part?.type === "toolCall")
        slim.toolCall = { type: "toolCall", id: part.id, name: part.name, arguments: {} };
    }
    if (source.type === "error" && source.error?.errorMessage)
      slim.errorMessage = source.error.errorMessage;
    // The finished block / arguments arrive again in message_end right after: do not send
    // them twice (a 1MB write used to cross IPC three times — 20261115-ui §3 budget).
    if (source.type === "text_end" || source.type === "thinking_end") delete slim.content;
    if (source.type === "toolcall_end" && slim.toolCall && typeof slim.toolCall === "object") {
      const call = slim.toolCall as { arguments?: unknown };
      slim.toolCall = { ...call, arguments: smallArgs(call.arguments) };
    }
    // `partial.usage` is cumulative and only message_end's is used.
    return { type: "message_update", assistantMessageEvent: slim };
  }
  // The renderer already holds the arguments from message_end; keep small ones for display.
  if (event.type === "tool_execution_start" && argsSize(event.args) > MAX_FORWARDED_ARGS) {
    const { args: _args, ...rest } = event;
    return rest;
  }
  // Both repeat content the renderer already received through message_end.
  if (event.type === "agent_end") return { type: "agent_end", willRetry: event.willRetry };
  if (event.type === "turn_end") return { type: "turn_end" };
  if (event.type === "entry_appended") return undefined;
  // Raw per-chunk `!command` output: features/bash.ts forwards it coalesced instead.
  if (event.type === "bash_execution_update") return undefined;
  // Updates repeat the arguments and the cumulative output: send the output tail only.
  if (event.type === "tool_execution_update") {
    const content = (event.partialResult as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
    return {
      type: event.type,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      ...(Array.isArray(content) ? { partialResult: { content: content.map((part) => (part.type === "text" && typeof part.text === "string" && part.text.length > TOOL_OUTPUT_TAIL ? { ...part, text: part.text.slice(-TOOL_OUTPUT_TAIL) } : part)) } } : {}),
    };
  }
  return event;
}
const TOOL_OUTPUT_TAIL = 8 * 1024;
const MAX_FORWARDED_ARGS = 32 * 1024;
/** Approximate JSON size of tool arguments without serializing megabytes. */
function argsSize(args: unknown, depth = 0): number {
  if (typeof args === "string") return args.length + 2;
  if (!args || typeof args !== "object") return 8;
  if (depth > 3) return MAX_FORWARDED_ARGS + 1;
  let n = 2;
  for (const [k, v] of Object.entries(args)) {
    n += k.length + 4 + argsSize(v, depth + 1);
    if (n > MAX_FORWARDED_ARGS) break;
  }
  return n;
}
/** Arguments for display while the full copy is on its way: large values are left out. */
export function smallArgs(args: unknown): unknown {
  if (argsSize(args) <= MAX_FORWARDED_ARGS) return args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(Object.entries(args).filter(([, v]) => argsSize(v) <= 1024));
}
/** Text/thinking deltas are merged for this long before crossing IPC. */
const DELTA_COALESCE_MS = 16;
const TOOL_DELTA_INTERVAL_MS = 100;
/** Best-effort `path` / `command` from the first bytes of streamed tool-call JSON. */
export function partialToolArgs(head: string, parsed?: unknown): { path?: string; command?: string } {
  const args = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const out: { path?: string; command?: string } = {};
  const unescape = (v: string) => { try { return JSON.parse(`"${v}"`) as string; } catch { return v; } };
  const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : head.match(/"(?:path|file_path)"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const command = typeof args.command === "string" ? args.command : head.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)/)?.[1];
  if (path) out.path = typeof args.path === "string" || typeof args.file_path === "string" ? path : unescape(path);
  if (command) out.command = (typeof args.command === "string" ? command : unescape(command)).slice(0, 500);
  return out;
}

/**
 * Forward one renderer event. Consecutive text/thinking deltas of the same block are
 * merged (leading edge immediately, then at most one IPC message per 16ms); anything
 * else flushes the pending delta first so ordering is preserved.
 */
export function emitEvent(engine: EngineContext, slot: Slot, event: unknown) {
  const update = (event as { type?: string; assistantMessageEvent?: { type?: string; contentIndex?: number; delta?: unknown } }).type === "message_update"
    ? (event as { assistantMessageEvent: { type?: string; contentIndex?: number; delta?: unknown } }).assistantMessageEvent
    : undefined;
  const mergeable = !!update && (update.type === "text_delta" || update.type === "thinking_delta") && typeof update.delta === "string" && Object.keys(update).every((k) => k === "type" || k === "contentIndex" || k === "delta");
  if (mergeable) {
    const pending = slot.pendingDelta;
    if (pending && pending.type === update!.type && pending.contentIndex === update!.contentIndex) {
      pending.delta += update!.delta as string;
      return;
    }
    engine.flushDelta(slot);
    const now = Date.now();
    if (now - (slot.lastDeltaAt ?? 0) >= DELTA_COALESCE_MS) {
      slot.lastDeltaAt = now;
      engine.emit("agent://event", { sessionId: slot.id, event });
      return;
    }
    const next: NonNullable<Slot["pendingDelta"]> = { type: update!.type!, contentIndex: update!.contentIndex, delta: update!.delta as string };
    next.timer = setTimeout(() => { if (slot.pendingDelta === next) engine.flushDelta(slot); }, DELTA_COALESCE_MS - (now - (slot.lastDeltaAt ?? 0)));
    slot.pendingDelta = next;
    return;
  }
  engine.flushDelta(slot);
  engine.emit("agent://event", { sessionId: slot.id, event });
}
export function flushDelta(engine: EngineContext, slot: Slot) {
  const pending = slot.pendingDelta;
  if (!pending) return;
  slot.pendingDelta = undefined;
  if (pending.timer) clearTimeout(pending.timer);
  slot.lastDeltaAt = Date.now();
  const assistantMessageEvent: Record<string, unknown> = { type: pending.type, delta: pending.delta };
  if (pending.contentIndex !== undefined) assistantMessageEvent.contentIndex = pending.contentIndex;
  engine.emit("agent://event", { sessionId: slot.id, event: { type: "message_update", assistantMessageEvent } });
}
/** Throttled `toolcall_delta` summary: target path / command and bytes streamed so far. */
export function toolArgProgress(engine: EngineContext, slot: Slot, source: { contentIndex?: number; delta?: string; partial?: { content?: Array<{ arguments?: unknown }> } }) {
  const index = source.contentIndex ?? 0;
  const map = (slot.toolArgs ??= new Map());
  const state = map.get(index) ?? { bytes: 0, head: "", at: 0 };
  const delta = typeof source.delta === "string" ? source.delta : "";
  state.bytes += delta.length;
  if (state.head.length < 4096) state.head += delta;
  map.set(index, state);
  const now = Date.now();
  if (now - state.at < TOOL_DELTA_INTERVAL_MS) return;
  state.at = now;
  engine.emitEvent(slot, {
    type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: index, partialArgs: partialToolArgs(state.head, source.partial?.content?.[index]?.arguments), bytes: state.bytes } });
}
export function onEvent(engine: EngineContext, slot: Slot, event: AgentSessionEvent) {
  const sessionId = slot.id;
  if (event.type === "message_update") {
    const source = event.assistantMessageEvent as unknown as { type: string; contentIndex?: number; delta?: string; partial?: { content?: Array<{ arguments?: unknown }> } };
    if (source.type === "toolcall_delta") engine.toolArgProgress(slot, source);
    else if (source.type === "toolcall_start" || source.type === "toolcall_end") slot.toolArgs?.delete(source.contentIndex ?? 0);
  }
  if (event.type === "message_start") slot.toolArgs = undefined;
  // An extension or /name renamed the session, or the thinking level moved (e.g. clamped after
  // a model switch): keep the sidebar title and the composer's thinking control in sync (C7/C8).
  if (event.type === "session_info_changed" && event.name?.trim()) {
    engine.metadata(sessionId, { title: event.name.trim() });
    engine.invalidateList();
    engine.emit("agent://summary", { sessionId, title: event.name.trim() });
  }
  if (event.type === "thinking_level_changed") {
    try { engine.emit("agent://model-state", engine.modelState(sessionId)); } catch { /* model not resolved yet */ }
  }
  const payload = slimEvent(event);
  if (payload) engine.emitEvent(slot, payload);
  if (event.type === "tool_execution_end" && event.toolName === PLAN_TOOL && !event.isError) {
    // Failed calls carry no details: the plan stays as it was.
    const state = stateFromDetails((event.result as { details?: unknown } | undefined)?.details);
    if (state) emitPlan(engine, sessionId, state.items);
  }
  if (event.type === "tool_execution_end") {
    void engine.checkpoints.finish(event.toolCallId).then(
      (record) => { if (record || event.toolName === "write" || event.toolName === "edit") engine.emit("agent://artifacts", { sessionId }); },
      () => {},
    );
  }
  if (event.type === "agent_start") {
    slot.finalError = undefined;
    slot.failed = false;
    if (!slot.busy) {
      slot.busy = true;
      engine.emitStatus(slot);
    }
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    slot.finalError =
      event.message.stopReason === "error"
        ? (event.message.errorMessage ?? "模型请求失败")
        : undefined;
  }
  if (event.type === "message_end" && event.message.role === "user") engine.ensureTitle(slot, messageText(event.message));
  // An errored attempt may still be retried or recovered by compaction.
  // Report a terminal error only once the SDK has completely settled.
  if (event.type === "agent_settled") {
    if (!event.aborted && slot.finalError) {
      engine.emit("agent://turn-error", {
        sessionId,
        kind: "error",
        detail: slot.finalError,
      });
      slot.failed = true;
    }
    slot.finalError = undefined;
    // The SDK accepts a new prompt as soon as it settled; don't make the
    // renderer wait for the outer prompt() promise to unwind.
    slot.busy = false;
    slot.lastActive = Date.now();
    engine.invalidateList();
    engine.emitStatus(slot);
    if (slot.stale) void engine.rebuild(slot).catch((error) => engine.emit("agent://error", { sessionId, message: String(error instanceof Error ? error.message : error) }));
  }
}
