import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSmoothText } from "../use-smooth-text";

describe("useSmoothText", () => {
  let now = 0;
  let frames: FrameRequestCallback[] = [];
  const advance = (ms: number) => {
    const steps = Math.ceil(ms / 16);
    for (let i = 0; i < steps; i++) {
      now += 16;
      const run = frames;
      frames = [];
      act(() => run.forEach((cb) => cb(now)));
    }
  };
  beforeEach(() => {
    now = 0;
    frames = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    window.requestAnimationFrame = globalThis.requestAnimationFrame;
    window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("reveals a burst progressively and drains it quickly", () => {
    const { result, rerender } = renderHook(({ text, live }) => useSmoothText(text, live), { initialProps: { text: "", live: true } });
    rerender({ text: "x".repeat(400), live: true });
    advance(100);
    const partial = result.current.length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(400);
    advance(600);
    expect(result.current.length).toBeGreaterThan(partial);
    expect(result.current.length).toBeGreaterThan(250);
    advance(1600);
    expect(result.current).toBe("x".repeat(400));
  });

  it("keeps up with a steady stream with a bounded lag", () => {
    const { result, rerender } = renderHook(({ text, live }) => useSmoothText(text, live), { initialProps: { text: "", live: true } });
    let text = "";
    for (let i = 0; i < 60; i++) {
      text += "abcdef"; // ~180 chars/s at 33ms per chunk
      rerender({ text, live: true });
      advance(33);
    }
    expect(text.length - result.current.length).toBeLessThan(140);
  });

  it("shows everything at once when the stream ends or the text is replaced", () => {
    const { result, rerender } = renderHook(({ text, live }) => useSmoothText(text, live), { initialProps: { text: "", live: true } });
    rerender({ text: "streamed words that arrived at once", live: true });
    advance(100);
    expect(result.current.length).toBeGreaterThan(0);
    rerender({ text: "a different final snapshot", live: true });
    expect(result.current).toBe("a different final snapshot");
    rerender({ text: "done", live: false });
    expect(result.current).toBe("done");
  });

  it("never splits a surrogate pair", () => {
    const { result, rerender } = renderHook(({ text, live }) => useSmoothText(text, live), { initialProps: { text: "", live: true } });
    const emoji = "😀".repeat(50);
    rerender({ text: emoji, live: true });
    for (let i = 0; i < 20; i++) {
      advance(16);
      const last = result.current.charCodeAt(result.current.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });
});
