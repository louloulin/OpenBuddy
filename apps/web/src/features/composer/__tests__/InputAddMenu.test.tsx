import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InputAddMenu } from "../InputAddMenu";
import { sessionMcpGet, sessionMcpSet } from "@openbuddy/client/agent-client";

vi.mock("@openbuddy/client/agent-client", () => ({
  expertsLoad: vi.fn().mockResolvedValue({ experts: [] }),
  skillsList: vi.fn().mockResolvedValue([]),
  sessionMcpGet: vi.fn(),
  sessionMcpSet: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionMcpGet).mockResolvedValue({ servers: [{ name: "filesystem", enabled: true }] });
  vi.mocked(sessionMcpSet).mockResolvedValue({ servers: [{ name: "filesystem", enabled: false }] });
});

describe("“+” 菜单 · 本任务连接器开关 (pii W2.4 P2)", () => {
  it("lists the session's MCP servers and toggles one in place", async () => {
    render(<InputAddMenu onPickFiles={vi.fn()} sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    const item = screen.getByText("连接器").closest(".iam-item");
    expect(item).toBeTruthy();
    fireEvent.mouseEnter(item!);
    await waitFor(() => expect(screen.getByRole("button", { name: /filesystem/ })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: /filesystem/ }));
    await waitFor(() => expect(sessionMcpSet).toHaveBeenCalledWith("s1", "filesystem", false));
  });

  it("explains that the home page has no task yet", async () => {
    render(<InputAddMenu onPickFiles={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.mouseEnter(screen.getByText("连接器").closest(".iam-item")!);
    await waitFor(() => expect(screen.getByText("打开任务后可切换本任务连接器")).toBeInTheDocument());
    expect(sessionMcpGet).not.toHaveBeenCalled();
  });
});
