/**
 * ToolCallCard duration display tests — Phase R3.0.
 *
 * Pins:
 *   - completed tools render "完成 1.2s" / "12s" / "1m 5s"
 *   - in_progress tools render "运行中 Ns" ticking at 1s
 *   - tools without startedAt (legacy data) render nothing for duration
 *   - formatToolDuration handles edge cases (0 ms, 999ms, etc.)
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToolCallCard, formatToolDuration, toolElapsedMs } from "../ToolCallCard";
import type { ToolCallView } from "@/stores/session-store";

function makeTc(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: "tc-1",
    title: "Read /tmp/a",
    kind: "read",
    status: "completed",
    content: [],
    ...overrides,
  };
}

describe("formatToolDuration", () => {
  it("returns null when startedAt is missing (legacy data)", () => {
    expect(formatToolDuration(undefined, "completed", 1_000_000)).toBeNull();
    expect(formatToolDuration(undefined, "in_progress", 1_000_000)).toBeNull();
  });

  it("formats sub-second durations as `Nms`", () => {
    const startedAt = 1_000_000;
    expect(formatToolDuration(startedAt, "completed", startedAt + 250)).toBe(
      "250ms",
    );
    expect(formatToolDuration(startedAt, "in_progress", startedAt + 1)).toBe("1ms");
  });

  it("formats single-second durations with no trailing zero", () => {
    const startedAt = 1_000_000;
    expect(formatToolDuration(startedAt, "completed", startedAt + 5_000)).toBe(
      "5.0s",
    );
  });

  it("formats multi-second durations as `Ns` for >=10s", () => {
    const startedAt = 1_000_000;
    expect(formatToolDuration(startedAt, "completed", startedAt + 12_500)).toBe(
      "13s",
    );
  });

  it("formats minute+ durations as `Nm Ms`", () => {
    const startedAt = 1_000_000;
    // 1m 5s = 65_000ms
    expect(formatToolDuration(startedAt, "completed", startedAt + 65_000)).toBe(
      "1m 5s",
    );
    // 2m 0s
    expect(formatToolDuration(startedAt, "completed", startedAt + 120_000)).toBe(
      "2m 0s",
    );
  });

  it("treats negative elapsed (clock skew) as 0ms", () => {
    const now = 1_000_000;
    expect(formatToolDuration(now + 5_000, "completed", now)).toBe("0ms");
  });
});

describe("ToolCallCard duration display", () => {
  it("does NOT render duration when startedAt is missing", () => {
    render(<ToolCallCard tc={makeTc({ status: "completed" })} />);
    expect(screen.queryByTestId("toolcall-duration")).toBeNull();
  });

  it("renders duration for completed tools", () => {
    const startedAt = Date.now() - 2_500;
    render(
      <ToolCallCard
        tc={makeTc({ status: "completed", startedAt })}
      />,
    );
    const dur = screen.getByTestId("toolcall-duration");
    // 2.5s rounds to "2.5s" (sub-10s precision)
    expect(dur.textContent).toBe("2.5s");
  });

  it("renders duration for failed tools", () => {
    const startedAt = Date.now() - 12_500;
    render(
      <ToolCallCard tc={makeTc({ status: "failed", startedAt })} />,
    );
    const dur = screen.getByTestId("toolcall-duration");
    expect(dur.textContent).toBe("13s");
  });

  it("renders duration for in_progress tools", () => {
    const startedAt = Date.now() - 3_500;
    render(
      <ToolCallCard tc={makeTc({ status: "in_progress", startedAt })} />,
    );
    expect(screen.getByTestId("toolcall-duration").textContent).toBe("3.5s");
  });

  it("includes duration in aria-label and title for accessibility", () => {
    const startedAt = Date.now() - 1_500;
    render(
      <ToolCallCard tc={makeTc({ status: "completed", startedAt })} />,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toMatch(/1\.5s/);
    expect(button.getAttribute("title")).toMatch(/1\.5s/);
  });

  it("does not include duration in title when startedAt is missing (graceful degradation)", () => {
    render(<ToolCallCard tc={makeTc({ status: "completed" })} />);
    const button = screen.getByRole("button");
    // Title should still include status, just no " · 1.5s" suffix
    expect(button.getAttribute("title")).not.toMatch(/·/);
  });

  it("in_progress duration ticks up via setInterval", () => {
    // Use vi.useFakeTimers + vi.setSystemTime so `Date.now()` stays in
    // sync with the fake timer — otherwise the gap between `startedAt`
    // and `Date.now()` blows up to real-time elapsed and the chip shows
    // 29 million minutes.
    vi.useFakeTimers();
    const base = new Date("2026-09-05T08:00:00Z").getTime();
    vi.setSystemTime(base);
    try {
      const startedAt = base;
      render(
        <ToolCallCard
          tc={makeTc({ status: "in_progress", startedAt })}
        />,
      );
      const dur = screen.getByTestId("toolcall-duration");
      // Initial value reflects 0ms gap
      expect(dur.textContent).toBe("0ms");
      // Advance 5s and let React process the tick
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByTestId("toolcall-duration").textContent).toBe("5.0s");
    } finally {
      vi.useRealTimers();
    }
  });
});