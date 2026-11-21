import { beforeEach, describe, expect, it } from "vitest";
import { installTerminalBridge } from "../terminal-bridge";
import { useSessionStore } from "../session-store";
import { useTerminalStore } from "@/app/state/terminal-store";

/**
 * 终端输出桥接 (20261121-ui-gap G10)：后台会话的命令输出要进入 app 层缓存，
 * 供侧栏「运行中」与任务概览读取，且新会话（还没有任何命令）不能抛错。
 */
const commandMessage = (id: string, cmd: string, output: string) => ({
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
      status: "completed" as const,
      content: [{ type: "command_output" as const, command: cmd, output, exitCode: 0 }],
    },
  }],
});

beforeEach(() => {
  useSessionStore.setState({ sessionId: null, transcripts: {}, messages: [], streaming: false, streamingMessageId: null, usage: {}, plan: null, error: null });
  useTerminalStore.setState({ bySession: {} });
});

describe("terminal bridge", () => {
  it("没有命令输出的会话不会抛错", () => {
    const uninstall = installTerminalBridge();
    try {
      // 新任务会先注册一个空 transcript：缓存里没有这一项，读取时不能崩。
      useSessionStore.getState().setSession("empty-session");
      expect(useTerminalStore.getState().bySession["empty-session"] ?? []).toHaveLength(0);
    } finally {
      uninstall();
    }
  });

  it("把会话的命令输出镜像进缓存", () => {
    const uninstall = installTerminalBridge();
    try {
      const messages = [commandMessage("call-1", "ls", "a.txt") as never];
      useSessionStore.setState({ transcripts: { "s1": { ...useSessionStore.getState().transcripts.s1, messages } as never } });
      const rows = useTerminalStore.getState().bySession["s1"] ?? [];
      expect(rows).toHaveLength(1);
      expect(rows[0].command).toBe("ls");
      expect(rows[0].output).toBe("a.txt");
    } finally {
      uninstall();
    }
  });
});
