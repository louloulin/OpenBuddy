import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ConnectorItem } from "@openbuddy/protocol/dto";
import { ConnectorAuthModal } from "../ConnectorAuthModal";

const connector = { id: "demo", name: "演示连接器", iconLocal: undefined, cat: "dev", desc: "" } as unknown as ConnectorItem;
const base = { sessionId: "s1", serverName: "demo", startedAt: Date.now(), expiresAt: Date.now() + 90_000 };

describe("ConnectorAuthModal (B3a)", () => {
  it("shows the countdown and a copyable attempt id while pending", () => {
    render(<ConnectorAuthModal connector={connector} attempt={{ ...base, id: "abcdef12-3456-7890", status: "pending" }} onClose={vi.fn()} />);
    expect(screen.getByText("剩余时间")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(screen.getByText("abcdef12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消授权" })).toBeTruthy();
  });

  it("explains expiry and cancellation instead of looking stuck", () => {
    const { rerender } = render(<ConnectorAuthModal connector={connector} attempt={{ ...base, id: "expired-1", status: "expired" }} onClose={vi.fn()} />);
    expect(screen.getByText("授权已过期，请重新发起")).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
    rerender(<ConnectorAuthModal connector={connector} attempt={{ ...base, id: "cancelled-1", status: "cancelled" }} onClose={vi.fn()} />);
    expect(screen.getByText("已取消授权")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "关闭" }).length).toBeGreaterThan(0);
  });

  it("renders the failure reason with the manual-credential hint", () => {
    render(<ConnectorAuthModal connector={connector} attempt={{ ...base, id: "failed-1", status: "failed", error: "invalid_client" }} onClose={vi.fn()} />);
    expect(screen.getByText("授权未完成")).toBeTruthy();
    expect(screen.getByText("invalid_client")).toBeTruthy();
    expect(screen.getByText(/手动填入凭证/)).toBeTruthy();
  });
});
