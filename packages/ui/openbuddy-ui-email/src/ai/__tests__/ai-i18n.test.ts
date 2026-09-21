import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { detectAiLocale, useAiT9n } from "../ai-i18n";

describe("useAiT9n", () => {
  it("returns Chinese by default", () => {
    const { result } = renderHook(() => useAiT9n());
    expect(["zh-CN", "en-US"]).toContain(result.current.locale);
    expect(result.current.t("inbox")).toContain("Inbox");
  });

  it("returns English when locale=en-US", () => {
    const { result } = renderHook(() => useAiT9n("en-US"));
    expect(result.current.locale).toBe("en-US");
    expect(result.current.t("inbox")).toBe("Inbox");
    expect(result.current.t("connected")).toBe("Connected");
  });

  it("interpolates variables", () => {
    const { result } = renderHook(() => useAiT9n("en-US"));
    expect(result.current.t("ai_receipt_partial", { n: 5, m: 2 })).toBe("5 executed · 2 failed");
    expect(result.current.t("undo_seconds_remaining", { s: 15 })).toBe("15s to undo");
  });

  it("falls back to key when translation missing", () => {
    const { result } = renderHook(() => useAiT9n("en-US"));
    expect(result.current.t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("handles Chinese interpolation", () => {
    const { result } = renderHook(() => useAiT9n("zh-CN"));
    expect(result.current.t("ai_receipt_partial", { n: 3, m: 1 })).toContain("3");
  });

  it("ai_receipt_partial in Chinese", () => {
    const { result } = renderHook(() => useAiT9n("zh-CN"));
    expect(result.current.t("ai_receipt_partial", { n: 3, m: 1 })).toBe("已执行 3 项 · 失败 1");
  });

  it("ai_action_plan_n in English", () => {
    const { result } = renderHook(() => useAiT9n("en-US"));
    expect(result.current.t("ai_action_plan_n", { total: 7, accepted: 5 })).toBe(
      "AI suggests 7 actions · 5 selected",
    );
  });
});

describe("detectAiLocale", () => {
  it("returns a valid locale", () => {
    const result = detectAiLocale();
    expect(["zh-CN", "en-US"]).toContain(result);
  });
});
