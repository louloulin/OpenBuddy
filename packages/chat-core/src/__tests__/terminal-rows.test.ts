import { describe, expect, it } from "vitest";
import { collectTerminalRows, MAX_TERMINAL_ROWS, tailOutput } from "../terminal-rows";
import type { ChatMessage } from "../transcript";

const command = (id: string, cmd: string, output: string, status: "in_progress" | "completed" | "failed" = "completed") => ({
  id: `m-${id}`,
  role: "assistant" as const,
  complete: true,
  parts: [{
    kind: "tool_call" as const,
    contentIndex: 0,
    toolCall: {
      toolCallId: id,
      title: "run_terminal_command",
      kind: "run_terminal_command",
      status,
      content: [{ type: "command_output" as const, command: cmd, output, exitCode: 0 }],
    },
  }],
});

describe("terminal-rows", () => {
  it("collects terminal calls with their command and output", () => {
    const rows = collectTerminalRows([command("t1", "npm test", "PASS") as unknown as ChatMessage]);
    expect(rows).toEqual([{ id: "t1", command: "npm test", output: "PASS", status: "completed" }]);
  });

  it("ignores non-terminal tools and calls without output", () => {
    const other = {
      id: "m-x",
      role: "assistant" as const,
      complete: true,
      parts: [{
        kind: "tool_call" as const,
        contentIndex: 0,
        toolCall: { toolCallId: "x", title: "read", kind: "read", status: "completed" as const, content: [{ type: "text" as const, text: "hi" }] },
      }],
    };
    expect(collectTerminalRows([other as unknown as ChatMessage])).toEqual([]);
    expect(collectTerminalRows([command("t2", "sleep 1", "") as unknown as ChatMessage])).toEqual([]);
  });

  it("keeps only the most recent rows", () => {
    const messages = Array.from({ length: 8 }, (_, i) => command(`t${i}`, `cmd-${i}`, `out-${i}`) as unknown as ChatMessage);
    const rows = collectTerminalRows(messages);
    expect(rows).toHaveLength(MAX_TERMINAL_ROWS);
    expect(rows[rows.length - 1].id).toBe("t7");
  });

  it("tails long output instead of truncating the head", () => {
    const long = "x".repeat(50);
    expect(tailOutput(long, 10)).toContain("（仅显示末尾内容）");
    expect(tailOutput(long, 10).length).toBeLessThan(long.length + 20);
    expect(tailOutput("short", 10)).toBe("short");
  });
});
