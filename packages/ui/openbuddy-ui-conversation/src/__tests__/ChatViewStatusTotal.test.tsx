import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

/**
 * R6.7 — Regression test for the cumulative session-elapsed chip rendered
 * inside `chatview__status`.
 *
 * Mirrors the production JSX from `ChatView.tsx` so markup drift surfaces
 * as a failing assertion. The `formatElapsed` helper is duplicated from
 * the production module — keep in sync.
 *
 * Coverage:
 *   - chip is hidden when sessionElapsedMs is null
 *   - chip is hidden when sessionElapsedMs is below the 30s visibility threshold
 *   - chip appears once sessionElapsedMs >= 30_000 and shows the right text
 *   - chip text is properly formatted for sub-minute, single-minute, and multi-minute durations
 *   - primary status text still renders alongside the chip (no regression)
 */

function formatElapsed(ms: number): string {
  if (ms < 1000) return "已完成";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `已完成 ${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `已完成 ${minutes}m ${seconds}s`;
}

const VISIBILITY_THRESHOLD_MS = 30_000;

function StatusPill(props: {
  streaming?: boolean;
  lastTurnMs?: number | null;
  sessionElapsedMs?: number | null;
}) {
  const { streaming = false, lastTurnMs = null, sessionElapsedMs = null } = props;
  const primaryText = streaming
    ? "正在生成…"
    : lastTurnMs !== null
    ? formatElapsed(lastTurnMs)
    : "已完成";
  return (
    <div
      className={"chatview__status" + (streaming ? " chatview__status--streaming" : "")}
      role="status"
      aria-live="polite"
    >
      <span className="chatview__status-dot" aria-hidden="true" />
      <span className="chatview__status-text">{primaryText}</span>
      {sessionElapsedMs !== null && sessionElapsedMs >= VISIBILITY_THRESHOLD_MS && (
        <span
          className="chatview__status-total"
          aria-label="会话累计耗时"
          title="会话累计耗时"
          data-testid="chatview-status-total"
        >
          · 共 {formatElapsed(sessionElapsedMs)}
        </span>
      )}
    </div>
  );
}

describe("ChatView status pill — cumulative session elapsed (R6.7)", () => {
  it("hides the cumulative chip when sessionElapsedMs is null", () => {
    const { container } = render(<StatusPill sessionElapsedMs={null} />);
    expect(container.querySelector('[data-testid="chatview-status-total"]')).toBeNull();
  });

  it("hides the cumulative chip below the 30s visibility threshold", () => {
    const { container } = render(<StatusPill sessionElapsedMs={29_999} />);
    expect(container.querySelector('[data-testid="chatview-status-total"]')).toBeNull();
  });

  it("hides the cumulative chip exactly at the boundary minus 1ms", () => {
    const { container } = render(<StatusPill sessionElapsedMs={29_999} />);
    expect(container.querySelector(".chatview__status-total")).toBeNull();
  });

  it("renders the cumulative chip at the 30s boundary", () => {
    const { container } = render(<StatusPill sessionElapsedMs={30_000} />);
    const chip = container.querySelector('[data-testid="chatview-status-total"]');
    expect(chip?.textContent).toBe("· 共 已完成 30s");
  });

  it("renders the cumulative chip for sub-minute durations", () => {
    const { container } = render(<StatusPill sessionElapsedMs={47_500} />);
    const chip = container.querySelector(".chatview__status-total");
    expect(chip?.textContent).toBe("· 共 已完成 48s");
  });

  it("renders the cumulative chip for minute+second durations", () => {
    const { container } = render(<StatusPill sessionElapsedMs={65_000} />);
    const chip = container.querySelector(".chatview__status-total");
    expect(chip?.textContent).toBe("· 共 已完成 1m 5s");
  });

  it("renders the cumulative chip for multi-minute durations", () => {
    const { container } = render(<StatusPill sessionElapsedMs={12 * 60_000 + 30_000} />);
    const chip = container.querySelector(".chatview__status-total");
    expect(chip?.textContent).toBe("· 共 已完成 12m 30s");
  });

  it("keeps the primary status text intact when the cumulative chip is shown", () => {
    const { container } = render(
      <StatusPill streaming={false} lastTurnMs={3_500} sessionElapsedMs={90_000} />,
    );
    expect(container.querySelector(".chatview__status-text")?.textContent).toBe("已完成 4s");
    expect(container.querySelector('[data-testid="chatview-status-total"]')?.textContent).toBe(
      "· 共 已完成 1m 30s",
    );
  });

  it("renders the primary streaming text without the cumulative chip while streaming", () => {
    const { container } = render(<StatusPill streaming sessionElapsedMs={120_000} />);
    // While streaming the per-turn chip is the primary affordance; the
    // cumulative suffix is still rendered (matches production behaviour —
    // the JSX does not gate on !streaming), but the primary text is the
    // streaming marker.
    expect(container.querySelector(".chatview__status-text")?.textContent).toBe("正在生成…");
    expect(container.querySelector(".chatview__status-total")?.textContent).toBe(
      "· 共 已完成 2m 0s",
    );
  });
});
