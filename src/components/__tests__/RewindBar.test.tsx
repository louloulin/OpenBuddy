import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RewindBar } from "../RewindBar";

// vitest — stub the three client calls it uses.
vi.mock("@/lib/agent-client", () => ({
  rewindPoints: vi.fn().mockResolvedValue([
    { promptIndex: 0, promptPreview: "first prompt", timestamp: "2026-01-01T00:00:00Z" },
  ]),
  rewindExecute: vi.fn().mockResolvedValue(undefined),
  sessionFork: vi.fn().mockResolvedValue("forked-session-id-1234"),
}));

// Re-import the mocked module so we can assert call args on the stubs.
const { rewindExecute } = await import("@/lib/agent-client");

describe("RewindBar wiring", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("分叉成功后调用 onForked(新id) 与 onToast", async () => {
    const onForked = vi.fn();
    const onToast = vi.fn();
    render(
      <RewindBar sessionId="s1" onForked={onForked} onToast={onToast} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /分叉/ }));
    await waitFor(() =>
      expect(onForked).toHaveBeenCalledWith("forked-session-id-1234"),
    );
    expect(onToast).toHaveBeenCalled();
  });

  it("回溯成功后调用 onRewound 与 onToast", async () => {
    const onRewound = vi.fn();
    const onToast = vi.fn();
    render(
      <RewindBar sessionId="s1" onRewound={onRewound} onToast={onToast} />,
    );
    // 打开下拉触发加载回溯点。
    fireEvent.click(screen.getByRole("button", { name: /回溯/ }));
    // 选"仅对话"模式(模式下拉与时间线动作按钮共名片段,先精确选中模式)。
    const modeBtn = await screen.findByRole("button", { name: "仅对话" });
    fireEvent.click(modeBtn);
    // 时间线动作按钮的可访问名是"回溯到此处（仅对话)",点击它真正触发回溯。
    const actionBtn = await screen.findByRole("button", {
      name: /回溯到此处.*仅对话/,
    });
    fireEvent.click(actionBtn);
    await waitFor(() => expect(onRewound).toHaveBeenCalled());
    expect(rewindExecute).toHaveBeenCalledWith("s1", 0, "conversation", true);
    expect(onToast).toHaveBeenCalled();
  });
});
