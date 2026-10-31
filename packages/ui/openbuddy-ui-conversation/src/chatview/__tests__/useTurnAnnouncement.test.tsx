/**
 * 20261031 Phase 2.10 — 回合完成时读屏播报一次;新回合开始清空。
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTurnAnnouncement } from "../useTurnAnnouncement";

describe("useTurnAnnouncement", () => {
  it("只在 streaming true→false 时播报", () => {
    const { result, rerender } = renderHook(({ s }) => useTurnAnnouncement(s, "done"), {
      initialProps: { s: false },
    });
    expect(result.current).toBe("");
    rerender({ s: true });
    expect(result.current).toBe("");
    rerender({ s: false });
    expect(result.current).toBe("done");
    rerender({ s: true });
    expect(result.current).toBe("");
  });
});
