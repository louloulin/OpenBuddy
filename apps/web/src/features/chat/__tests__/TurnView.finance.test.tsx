import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TurnView } from "../TurnView";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import type { ChatMessage } from "@/features/chat/state/session-store";

const now = Date.now();
const user: ChatMessage = { id: "u", role: "user", complete: true, parts: [{ kind: "text", text: "茅台现在多少钱" }], meta: { timestamp: now - 10_000 } };
/** UpUp `market_data_quote` 的真实返回形状。 */
const quoteTurn = (details: unknown): ChatMessage => ({
  id: "a",
  role: "assistant",
  complete: true,
  meta: { timestamp: now - 1_000, stopReason: "stop" },
  parts: [
    {
      kind: "tool_call",
      toolCall: {
        toolCallId: "call-quote",
        title: "market_data_quote",
        kind: "market_data_quote",
        status: "completed",
        content: [{ type: "text", text: JSON.stringify({ symbol: "600519.SH", price: 1520.5, changePct: 2.1, peTTM: 22.35 }) }],
        details,
      },
    },
    { kind: "text", text: "贵州茅台最新价 1520.50。" },
  ],
});
const envelope = { evidence: [{ asOf: "2026-11-14", source: "eastmoney" }], asOf: "2026-11-14", provider: "eastmoney", dataFreshness: "live", auditId: "call-quote", source: "native-provider" };

describe("投研数据卡 (U5 / UP-5.2)", () => {
  it("带来源信封的工具结果在回答下方出卡：来源徽标、截至时间、红涨、免责声明", () => {
    render(<ThemeProvider><TurnView messages={[quoteTurn(envelope)]} user={user} running={false} isLast sessionId="s" /></ThemeProvider>);
    const card = screen.getByRole("article", { name: "行情 600519.SH" });
    expect(within(card).getByText("eastmoney")).toBeTruthy();
    expect(within(card).getByText("截至 2026-11-14 · live")).toBeTruthy();
    expect(within(card).getByText("2.10%").className).toBe("finance-card__value--up");
    expect(within(card).getByText(/不构成投资建议/)).toBeTruthy();
  });

  it("没有 as-of/来源的结果不出卡", () => {
    render(<ThemeProvider><TurnView messages={[quoteTurn({ auditId: "x", source: "native-provider" })]} user={user} running={false} isLast sessionId="s" /></ThemeProvider>);
    expect(screen.queryByRole("region", { name: "数据卡" })).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("运行中不出卡（避免流式过程中闪烁）", () => {
    render(<ThemeProvider><TurnView messages={[quoteTurn(envelope)]} user={user} running isLast sessionId="s" /></ThemeProvider>);
    expect(screen.queryByRole("article", { name: "行情 600519.SH" })).toBeNull();
  });

  it("「生成报告」把带来源的 Markdown 放进输入框", () => {
    const onInsertPrompt = vi.fn();
    render(<ThemeProvider><TurnView messages={[quoteTurn(envelope)]} user={user} running={false} isLast sessionId="s" onInsertPrompt={onInsertPrompt} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    const prompt = onInsertPrompt.mock.calls[0]![0] as string;
    expect(prompt).toContain("保存为 Markdown 文件");
    expect(prompt).toContain("来源：eastmoney · 截至 2026-11-14");
  });
});
