/**
 * `!command` rows in the transcript (20261116-pii W1.2). The engine streams a run as
 * `bash_execution_start` → `bash_execution_update`* → `bash_execution_end`; replayed history has
 * Pi's `bashExecution` message instead. Both become one `notice` row of kind `bash` whose text is
 * the output and whose `meta.bash` says what ran and how it ended.
 */
import type { PiMessage, SessionUpdate } from "@openbuddy/protocol/dto";
import type { BashMeta, ChatMessage, SessionTranscript } from "./transcript";

/** Output kept per row while streaming (the end event replaces it with the engine's final tail). */
const MAX_LIVE_OUTPUT = 64 * 1024;
let seq = 0;

/** `meta.bash` of a replayed `bashExecution` message. */
export function bashMetaOf(message: PiMessage): BashMeta {
  const m = message as PiMessage & { exitCode?: unknown; cancelled?: unknown; truncated?: unknown; excludeFromContext?: unknown };
  return {
    command: m.command ?? "",
    ...(typeof m.exitCode === "number" ? { exitCode: m.exitCode } : {}),
    ...(m.cancelled === true ? { cancelled: true } : {}),
    ...(m.truncated === true ? { truncated: true } : {}),
    ...(m.excludeFromContext === true ? { excluded: true } : {}),
  };
}

const isBashEvent = (type: string) => type === "bash_execution_start" || type === "bash_execution_update" || type === "bash_execution_end";

/** Apply a `bash_execution_*` event; any other event returns `undefined`. */
export function reduceBash(t: SessionTranscript, event: SessionUpdate): SessionTranscript | undefined {
  if (!isBashEvent(event.type)) return undefined;
  const id = typeof event.id === "string" ? event.id : "";
  const at = t.messages.findIndex((m) => m.meta?.bash?.id === id && m.meta.notice === "bash");
  if (event.type === "bash_execution_start") {
    if (at >= 0) return t;
    const row: ChatMessage = {
      id: `bash_${Date.now()}_${seq++}`, role: "notice", complete: false, parts: [],
      meta: { notice: "bash", timestamp: Date.now(), bash: { id, command: String(event.command ?? ""), running: true, ...(event.excludeFromContext === true ? { excluded: true } : {}) } },
    };
    return { ...t, messages: [...t.messages, row] };
  }
  if (at < 0) return t;
  const row = t.messages[at];
  const before = row.parts[0]?.kind === "text" ? row.parts[0].text : "";
  let next: ChatMessage;
  if (event.type === "bash_execution_update") {
    const text = (before + String(event.delta ?? "")).slice(-MAX_LIVE_OUTPUT);
    next = { ...row, parts: [{ kind: "text", text }] };
  } else {
    const output = typeof event.output === "string" ? event.output : before;
    next = {
      ...row, complete: true, parts: output ? [{ kind: "text", text: output }] : [],
      meta: { ...row.meta, bash: {
        ...row.meta!.bash!, running: false,
        ...(typeof event.exitCode === "number" ? { exitCode: event.exitCode } : {}),
        ...(event.cancelled === true ? { cancelled: true } : {}),
        ...(event.truncated === true ? { truncated: true } : {}),
      } },
    };
  }
  const messages = [...t.messages];
  messages[at] = next;
  return { ...t, messages };
}
