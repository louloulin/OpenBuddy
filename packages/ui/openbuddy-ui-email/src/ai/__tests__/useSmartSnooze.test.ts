import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSmartSnooze, resolveSmartSnooze } from "../hooks/useSmartSnooze";

// 2026-09-21 is a Monday
const MONDAY = new Date("2026-09-21T10:00:00");

describe("useSmartSnooze (Chinese)", () => {
  it("下周一早 9 点 → next Monday 09:00", () => {
    const r = resolveSmartSnooze("下周一早 9 点", MONDAY);
    // Current Monday 09:00 already passed → next Monday
    expect(r.iso).toContain("2026-09-28");
    expect(r.display).toContain("09");
    expect(r.display).toContain("周一");
  });

  it("周一 9:00 → this Monday 09:00", () => {
    // Use a Sunday so Monday is tomorrow
    const SUNDAY = new Date("2026-09-20T10:00:00");
    const r = resolveSmartSnooze("周一 9 点", SUNDAY);
    expect(r.iso).toContain("2026-09-21");
    expect(r.display).toContain("09");
  });

  it("下午 3 点 → 15:00", () => {
    const r = resolveSmartSnooze("明天下午 3 点", MONDAY);
    expect(r.display).toContain("15");
    expect(r.display).toContain("明天");
  });

  it("今晚 8 点 → today 20:00 (since now is 10:00)", () => {
    const r = resolveSmartSnooze("今晚 8 点", MONDAY);
    expect(r.display).toContain("20");
  });

  it("明天 → tomorrow at 09:00", () => {
    const r = resolveSmartSnooze("明天", MONDAY);
    expect(r.iso).toContain("2026-09-22");
    expect(r.display).toContain("09");
  });

  it("周末 → Saturday at 10:00 default", () => {
    const r = resolveSmartSnooze("周末", MONDAY);
    expect(r.iso).toContain("2026-09-26"); // Saturday
  });

  it("unknown input falls back to 4 hours", () => {
    const r = resolveSmartSnooze("下个季度", MONDAY);
    expect(r.display).toBe("4h 后");
    expect(r.hoursFromNow).toBe(4);
  });
});

describe("useSmartSnooze (English)", () => {
  it("next week → +7 days", () => {
    const r = resolveSmartSnooze("next week", MONDAY);
    expect(r.hoursFromNow).toBeGreaterThan(24 * 6);
  });

  it("monday 9am → at least 24h from now", () => {
    const r = resolveSmartSnooze("monday 9am", MONDAY);
    expect(r.hoursFromNow).toBeGreaterThan(0);
    expect(r.display.toLowerCase()).toMatch(/mon/);
  });

  it("tomorrow → tomorrow at 09:00", () => {
    const r = resolveSmartSnooze("tomorrow", MONDAY);
    expect(r.iso).toContain("2026-09-22");
  });

  it("tonight 8pm → today 20:00", () => {
    const r = resolveSmartSnooze("tonight 8pm", MONDAY);
    expect(r.display).toContain("20");
  });

  it("next week → next Monday 09:00", () => {
    const r = resolveSmartSnooze("next week", MONDAY);
    expect(r.iso).toContain("2026-09-28");
  });
});

describe("useSmartSnooze (hook)", () => {
  it("returns memoized resolver", () => {
    const { result, rerender } = renderHook(() => useSmartSnooze());
    const first = result.current.resolve;
    rerender();
    expect(result.current.resolve).toBe(first);
  });
});

describe("useSmartSnooze — P3-7 扩展语义", () => {
  it("月底 → 本月最后一天 17:00", () => {
    // MONDAY = 2026-09-21,month end = 2026-09-30
    const r = resolveSmartSnooze("月底", MONDAY);
    expect(r.iso).toContain("2026-09-30");
    expect(r.display).toContain("17");
  });

  it("月末 → 本月最后一天", () => {
    const r = resolveSmartSnooze("月末提醒", MONDAY);
    expect(r.iso).toContain("2026-09-30");
  });

  it("下个月初 → 2026-10-01 09:00", () => {
    const r = resolveSmartSnooze("下个月初", MONDAY);
    expect(r.iso).toContain("2026-10-01");
    expect(r.display).toContain("09");
  });

  it("月初 → 2026-10-01 09:00", () => {
    const r = resolveSmartSnooze("月初", MONDAY);
    expect(r.iso).toContain("2026-10-01");
  });

  it("周末前 → 周五 17:00 默认 (current Monday → 2026-09-25)", () => {
    // "周末前" 不带时间,默认 17:00。
    const r = resolveSmartSnooze("周末前", MONDAY);
    expect(r.iso).toContain("2026-09-25");
    expect(r.display).toContain("周五");
    expect(r.display).toContain("17");
  });

  it("周五下午 3 点 → next Friday 15:00", () => {
    const r = resolveSmartSnooze("周五下午 3 点", MONDAY);
    expect(r.iso).toContain("2026-09-25");
    expect(r.display).toContain("15");
  });

  it("半个月后 → 14 天后", () => {
    const r = resolveSmartSnooze("半个月后", MONDAY);
    expect(r.iso).toContain("2026-10-05");
  });

  it("两周后 → 14 天后", () => {
    const r = resolveSmartSnooze("两周后", MONDAY);
    expect(r.iso).toContain("2026-10-05");
  });

  it("午饭后 → 今天 14:00", () => {
    const r = resolveSmartSnooze("午饭后", MONDAY);
    expect(r.iso).toContain("2026-09-21");
    expect(r.display).toContain("14");
  });

  // English aliases
  it("EN end of month → 2026-09-30 17:00", () => {
    const r = resolveSmartSnooze("end of month", MONDAY);
    expect(r.iso).toContain("2026-09-30");
  });

  it("EN after lunch → today 14:00", () => {
    const r = resolveSmartSnooze("after lunch", MONDAY);
    expect(r.display).toContain("14");
  });

  it("EN in two weeks → 14 days later", () => {
    const r = resolveSmartSnooze("in two weeks", MONDAY);
    expect(r.iso).toContain("2026-10-05");
  });

  it("EN start of next month → 2026-10-01", () => {
    const r = resolveSmartSnooze("start of next month", MONDAY);
    expect(r.iso).toContain("2026-10-01");
  });
});
