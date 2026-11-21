/**
 * 后台命令的终端输出 (WorkBuddy terminal module parity, 20261119 §10.2.3).
 *
 * A pure derivation over a transcript: the same rows feed the task overview
 * popover and the sidebar's running-task panel, so both surfaces show the
 * same command output without duplicating the parsing rules.
 */
import type { CommandOutputContent } from "@openbuddy/protocol/dto";
import type { ChatMessage } from "./transcript";

export interface TerminalRow {
  /** Stable id of the tool call that produced the output. */
  id: string;
  /** The command line that ran (falls back to the tool title). */
  command: string;
  /** Stdout+stderr captured so far. */
  output: string;
  status: "in_progress" | "completed" | "failed";
  durationMs?: number;
}

/** How many terminal calls a surface shows at once. */
export const MAX_TERMINAL_ROWS = 5;
/** How many characters of a single output are rendered. */
export const MAX_TERMINAL_CHARS = 4000;

/** The tool kind that carries shell output. */
export const TERMINAL_TOOL_KIND = "run_terminal_command";

const isCommandOutput = (content: unknown): content is CommandOutputContent =>
  !!content && typeof content === "object" && (content as { type?: unknown }).type === "command_output";

/**
 * Collect the terminal calls of a transcript, newest last.
 * Rows without any output are skipped (a command that has not produced output yet).
 */
export function collectTerminalRows(messages: ChatMessage[]): TerminalRow[] {
  const rows: TerminalRow[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.kind !== "tool_call") continue;
      const call = part.toolCall;
      if (call.kind !== TERMINAL_TOOL_KIND) continue;
      const outputs = call.content.filter(isCommandOutput);
      if (!outputs.length) continue;
      const output = outputs.map((c) => c.output).filter(Boolean).join("");
      if (!output) continue;
      rows.push({
        id: call.toolCallId,
        command: outputs.find((c) => c.command)?.command || call.title,
        output,
        status: call.status,
        ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
      });
    }
  }
  return rows.slice(-MAX_TERMINAL_ROWS);
}

/** Trim a long output to its tail so a popover never mounts a huge block. */
export function tailOutput(output: string, limit = MAX_TERMINAL_CHARS): string {
  if (output.length <= limit) return output;
  return `${output.slice(-limit)}\n…（仅显示末尾内容）`;
}
