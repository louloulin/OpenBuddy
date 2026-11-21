import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuickInput } from "../QuickInput";
import { agentInit, agentNewSession, agentSend } from "@openbuddy/client/agent-client";

vi.mock("@openbuddy/client/agent-client", () => ({
  agentInit: vi.fn(),
  agentNewSession: vi.fn(),
  agentSend: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentInit).mockResolvedValue({ cwd: "/work" } as never);
  vi.mocked(agentNewSession).mockResolvedValue("new-session");
  vi.mocked(agentSend).mockResolvedValue(undefined);
  window.close = vi.fn();
});

describe("全局快速输入 (pii W7.2)", () => {
  it("creates a task with the default workspace and closes the window", async () => {
    render(<QuickInput />);
    fireEvent.change(screen.getByLabelText("快速输入内容"), { target: { value: "整理今天的会议纪要" } });
    fireEvent.keyDown(screen.getByLabelText("快速输入内容"), { key: "Enter" });
    await waitFor(() => expect(agentSend).toHaveBeenCalledWith("new-session", "整理今天的会议纪要"));
    expect(agentInit).toHaveBeenCalled();
    expect(agentNewSession).toHaveBeenCalledWith("/work");
    expect(window.close).toHaveBeenCalled();
  });

  it("Shift+Enter keeps editing; Esc closes without sending", () => {
    render(<QuickInput />);
    const input = screen.getByLabelText("快速输入内容");
    fireEvent.change(input, { target: { value: "第一行" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(agentSend).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(window.close).toHaveBeenCalled();
  });
});
