import { describe, it, expect } from "vitest";
import {
  estimateTextTokens,
  estimateMessageTokens,
  estimateToolCallTokens,
  estimateConversationTokens,
  estimateSendCost,
} from "../billing/token-estimate";
import type { ChatMessage } from "@/stores/session-store";

function msg(parts: ChatMessage["parts"]): ChatMessage {
  return { id: "m1", role: "assistant", parts, complete: true };
}

describe("estimateTextTokens", () => {
  it("空字符串返回 0", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("   ")).toBe(0);
  });

  it("纯中文按字数近似(每个汉字 ≈ 1)", () => {
    const t = estimateTextTokens("你好世界");
    expect(t).toBe(4);
  });

  it("纯英文按词近似", () => {
    // 三个短词 → 至少 3
    expect(estimateTextTokens("hello world foo")).toBeGreaterThanOrEqual(3);
  });

  it("长英文词按字符拆分", () => {
    // "internationalization" 20 字符 → ceil(20/4) = 5
    expect(estimateTextTokens("internationalization")).toBe(5);
  });

  it("中英混合分别估算后求和", () => {
    const t = estimateTextTokens("你好 hello");
    // 2 个汉字 + 至少 1 个英文词
    expect(t).toBeGreaterThanOrEqual(3);
  });

  it("标点不计入拉丁词 token", () => {
    const a = estimateTextTokens("hello");
    const b = estimateTextTokens("hello!!!");
    expect(a).toBe(b);
  });
});

describe("estimateMessageTokens", () => {
  it("text part 聚合", () => {
    expect(estimateMessageTokens(msg([{ kind: "text", text: "你好" }]))).toBe(2);
  });

  it("多 part 求和", () => {
    const m = msg([
      { kind: "text", text: "你好" },
      { kind: "thought", text: "世界" },
    ]);
    expect(estimateMessageTokens(m)).toBe(4);
  });

  it("tool_call 聚合 title + command + output", () => {
    const m = msg([
      {
        kind: "tool_call",
        toolCall: {
          toolCallId: "t1",
          title: "Run ls",
          kind: "run_terminal_command",
          status: "completed",
          content: [
            { type: "command_output", command: "ls -la", output: "file1" },
          ],
        },
      },
    ]);
    expect(estimateMessageTokens(m)).toBeGreaterThan(0);
  });

  it("空消息返回 0", () => {
    expect(estimateMessageTokens(msg([]))).toBe(0);
  });
});

describe("estimateToolCallTokens", () => {
  it("diff 路径 + old + new 都计入", () => {
    const t = estimateToolCallTokens({
      title: "Edit",
      content: [{ type: "diff", diff: { path: "a.ts", old: "x", new: "yy" } }],
    });
    expect(t).toBeGreaterThan(0);
  });

  it("rawInput(JSON)计入", () => {
    const t = estimateToolCallTokens({
      title: "x",
      rawInput: { key: "value", n: 123 },
    });
    expect(t).toBeGreaterThan(0);
  });

  it("rawInput(字符串)计入", () => {
    const t = estimateToolCallTokens({ title: "x", rawInput: "你好" });
    expect(t).toBeGreaterThanOrEqual(2);
  });
});

describe("estimateConversationTokens", () => {
  it("对多条消息求和", () => {
    const ms = [
      msg([{ kind: "text", text: "你好" }]),
      msg([{ kind: "text", text: "世界" }]),
    ];
    expect(estimateConversationTokens(ms)).toBe(4);
  });

  it("空数组返回 0", () => {
    expect(estimateConversationTokens([])).toBe(0);
  });
});

describe("estimateSendCost", () => {
  it("无 ctx 时 label 只有 +N", () => {
    const c = estimateSendCost("你好");
    expect(c.newTokens).toBe(2);
    expect(c.projectedTotal).toBe(2);
    expect(c.projectedPct).toBe(0);
    expect(c.label).toBe("+2");
    expect(c.severity).toBe("ok");
  });

  it("有 ctx 时计算占比与 severity", () => {
    // ctxUsed=50000, ctxTotal=100000, 新增 5000 → 55% → ok
    const c = estimateSendCost("a".repeat(5000), 50000, 100000);
    expect(c.projectedTotal).toBe(50000 + c.newTokens);
    expect(c.projectedPct).toBeGreaterThan(0);
    expect(c.label).toContain("预计");
  });

  it("severity warn 在 60–85%", () => {
    // 让占比落在 70% 区间:used=65k, new≈5k, total=100k → ~70%
    const c = estimateSendCost("a".repeat(5000), 65000, 100000);
    expect(c.severity).toBe("warn");
  });

  it("severity danger >85%", () => {
    const c = estimateSendCost("a".repeat(5000), 90000, 100000);
    expect(c.projectedPct).toBeGreaterThan(85);
    expect(c.severity).toBe("danger");
  });

  it("ctxTotal 为 0 时不报除零", () => {
    const c = estimateSendCost("你好", 100, 0);
    expect(c.projectedPct).toBe(0);
    expect(c.severity).toBe("ok");
  });
});
