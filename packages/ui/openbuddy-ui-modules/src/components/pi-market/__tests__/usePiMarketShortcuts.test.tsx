import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePiMarketShortcuts } from "../usePiMarketShortcuts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePiMarketShortcuts", () => {
  it("does not bind when enabled=false", () => {
    const focusSearch = vi.fn();
    renderHook(() => usePiMarketShortcuts({ focusSearch, enabled: false }));
    const event = new KeyboardEvent("keydown", { key: "/" });
    window.dispatchEvent(event);
    expect(focusSearch).not.toHaveBeenCalled();
  });

  it("calls focusSearch when user presses '/' outside an input", () => {
    const focusSearch = vi.fn();
    renderHook(() => usePiMarketShortcuts({ focusSearch }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    });
    expect(focusSearch).toHaveBeenCalledTimes(1);
  });

  it("does NOT call focusSearch when '/' is pressed inside an input", () => {
    const focusSearch = vi.fn();
    renderHook(() => usePiMarketShortcuts({ focusSearch }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    });
    document.body.removeChild(input);
    expect(focusSearch).not.toHaveBeenCalled();
  });

  it("ignores modifier-key combos (cmd/ctrl/alt)", () => {
    const focusSearch = vi.fn();
    renderHook(() => usePiMarketShortcuts({ focusSearch }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", metaKey: true }));
    });
    expect(focusSearch).not.toHaveBeenCalled();
  });

  it("g + p triggers prevPage; g + P triggers nextPage", () => {
    const prevPage = vi.fn();
    const nextPage = vi.fn();
    const focusSearch = vi.fn();
    renderHook(() => usePiMarketShortcuts({ focusSearch, prevPage, nextPage }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    });
    expect(prevPage).toHaveBeenCalledTimes(1);
    expect(nextPage).not.toHaveBeenCalled();
    // next page
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "P" }));
    });
    expect(nextPage).toHaveBeenCalledTimes(1);
  });

  it("g sequence times out after 800ms", () => {
    vi.useFakeTimers();
    const prevPage = vi.fn();
    renderHook(() => usePiMarketShortcuts({ focusSearch: () => {}, prevPage }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    });
    expect(prevPage).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("non-special key after g cancels the sequence", () => {
    const prevPage = vi.fn();
    renderHook(() => usePiMarketShortcuts({ focusSearch: () => {}, prevPage }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    });
    expect(prevPage).not.toHaveBeenCalled();
  });

  it("unmount removes the listener", () => {
    const focusSearch = vi.fn();
    const { unmount } = renderHook(() => usePiMarketShortcuts({ focusSearch }));
    unmount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    });
    expect(focusSearch).not.toHaveBeenCalled();
  });
});
