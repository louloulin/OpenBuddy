/**
 * SlashCommands — 20261031 Phase 0.6:菜单只在「/ 开头的词」时出现,且打开时
 * 自己接管 ↑ ↓ Enter Esc。此前任何 `/`(URL、路径)都会让 Composer 吞掉回车。
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SlashCommands } from "../SlashCommands";

vi.mock("@/lib/agent/pi-client", () => ({ commandsList: () => Promise.resolve([]) }));

function renderAt(text: string, onPick = vi.fn()) {
  render(<SlashCommands text={text} cursor={text.length} onPick={onPick} anchorRect={null} />);
  return onPick;
}

describe("SlashCommands keyboard + visibility", () => {
  it("does not open for a URL or a path", async () => {
    renderAt("看看 https://example.com/a");
    renderAt("src/app");
    await act(async () => {});
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter picks the highlighted command and is marked handled", async () => {
    const onPick = renderAt("/pla");
    expect(await screen.findByRole("listbox")).toBeTruthy();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(onPick).toHaveBeenCalledWith("/plan");
    expect(event.defaultPrevented).toBe(true);
  });

  it("ArrowDown moves the highlight", async () => {
    renderAt("/");
    await screen.findByRole("listbox");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
  });

  it("Esc closes the menu without picking", async () => {
    const onPick = renderAt("/");
    await screen.findByRole("listbox");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("ignores Enter while an IME is composing", async () => {
    const onPick = renderAt("/");
    await screen.findByRole("listbox");
    fireEvent.keyDown(window, { key: "Enter", isComposing: true });
    expect(onPick).not.toHaveBeenCalled();
  });
});
