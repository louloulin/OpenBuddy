import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAiShortcuts, AI_SHORTCUTS_HELP } from "../hooks/useAiShortcuts";

describe("useAiShortcuts", () => {
  it("exposes a non-empty shortcut list", () => {
    expect(AI_SHORTCUTS_HELP.length).toBeGreaterThan(0);
  });

  it("dispatches 'next' for J key", () => {
    const onShortcut = vi.fn();
    renderHook(() => useAiShortcuts({ onShortcut }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    expect(onShortcut).toHaveBeenCalledWith({ kind: "next" });
  });

  it("dispatches 'archive' for E key", () => {
    const onShortcut = vi.fn();
    renderHook(() => useAiShortcuts({ onShortcut }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });
    expect(onShortcut).toHaveBeenCalledWith({ kind: "archive" });
  });

  it("dispatches command for Cmd+K", () => {
    const onShortcut = vi.fn();
    renderHook(() => useAiShortcuts({ onShortcut }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(onShortcut).toHaveBeenCalledWith({ kind: "command" });
  });

  it("ignores events in input fields", () => {
    const onShortcut = vi.fn();
    renderHook(() => useAiShortcuts({ onShortcut }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    });
    expect(onShortcut).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("respects enabled = false", () => {
    const onShortcut = vi.fn();
    renderHook(() => useAiShortcuts({ enabled: false, onShortcut }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it("uses latest callback ref on stale closure", () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = renderHook(({ cb }) => useAiShortcuts({ onShortcut: cb }), { initialProps: { cb: a } });
    rerender({ cb: b });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ kind: "prev" });
  });
});
