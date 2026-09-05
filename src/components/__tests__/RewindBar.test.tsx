import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RewindBar } from "@openbuddy/ui-conversation";

// The toolbar talks to pi over the desktop `invoke` bridge, which doesn't exist under
// vitest — stub the three client calls it uses. Use importOriginal so the rest
// of the pi-client surface (used transitively by AssistantCalendarPanel etc.)
// stays intact.
vi.mock("@/lib/agent/pi-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/pi-client")>();
  return {
    ...actual,
    rewindPoints: vi.fn().mockResolvedValue([
      { promptIndex: 0, promptPreview: "first prompt", timestamp: "2026-01-01T00:00:00Z" },
      { promptIndex: 1, promptPreview: "second prompt", timestamp: "2026-01-02T00:00:00Z" },
    ]),
    rewindExecute: vi.fn().mockResolvedValue(undefined),
    sessionFork: vi.fn().mockResolvedValue("forked-session-id-1234"),
  };
});

vi.mock("@/lib/platform/electron-api", () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

// Re-import the mocked module so we can assert call args on the stubs.
const { rewindExecute } = await import("@/lib/agent/pi-client");

describe("RewindBar wiring", () => {
  beforeEach(() => {
    window.confirm = vi.fn();
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
    // R4.1 — 模式下拉现在是 radiogroup,模式按钮 role="radio"。
    const modeBtn = await screen.findByRole("radio", { name: "仅对话" });
    fireEvent.click(modeBtn);
    expect(modeBtn).toHaveAttribute("aria-checked", "true");
    // 时间线动作按钮带 aria-label "回溯到第 N 步（仅对话）"以区分多个点。
    const actionBtn = await screen.findByRole("button", {
      name: /回溯到第\s*1\s*步.*仅对话/,
    });
    fireEvent.click(actionBtn);
    await waitFor(() => expect(onRewound).toHaveBeenCalled());
    expect(rewindExecute).toHaveBeenCalledWith("s1", 0, "conversation", true);
    expect(onToast).toHaveBeenCalled();
  });
});

describe("RewindBar a11y (R4.1)", () => {
  beforeEach(() => {
    window.confirm = vi.fn();
  });

  it("trigger has aria-haspopup=dialog + aria-expanded toggles open state", async () => {
    render(<RewindBar sessionId="s1" />);
    const trigger = screen.getByRole("button", { name: /回溯/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "true"),
    );
  });

  it("dropdown renders role=dialog + radiogroup for modes + listbox for timeline", async () => {
    render(<RewindBar sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /回溯/ }));
    expect(await screen.findByRole("dialog", { name: /回溯时间线/ })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: /回溯模式/ })).toBeTruthy();
    // Two points returned by the mock → two options.
    const options = await screen.findAllByRole("option");
    expect(options.length).toBe(2);
  });

  it("Escape closes the dropdown + returns focus to the trigger", async () => {
    render(<RewindBar sessionId="s1" />);
    const trigger = screen.getByRole("button", { name: /回溯/ });
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: /回溯时间线/ });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
  });

  it("Enter on a focused timeline item triggers rewind at that index", async () => {
    const onRewound = vi.fn();
    render(<RewindBar sessionId="s1" onRewound={onRewound} />);
    fireEvent.click(screen.getByRole("button", { name: /回溯/ }));
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    // ArrowDown moves to the second item.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => expect(onRewound).toHaveBeenCalled());
    expect(rewindExecute).toHaveBeenCalledWith("s1", 1, "all", true);
  });
});