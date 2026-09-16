/**
 * ToolCallCard-r8.2.test.tsx — visual / DOM contract tests for the
 * R8.2 tool-call polish. We mount ToolCallCard directly with a fake
 * ToolCallView and assert on the DOM that the right classes + data
 * attributes land where the CSS expects them.
 *
 * Coverage:
 *   - .toolcall--compact class is applied
 *   - .toolcall--ok / --run / --err modifier matches status
 *   - .toolcall__duration renders when startedAt is set
 *   - data-duration-ms is wired for test selectors / E2E
 *   - status mark class matches status
 *   - failed status keeps the duration visible (R8.2 colors it red via CSS)
 *   - clicking fires onOpen (preserves the drawer-open wiring)
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ToolCallCard } from "../ToolCallCard";
import type { ToolCallView } from "@/stores/session-store";

function baseTc(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: "tc-1",
    title: "ls -la /tmp",
    kind: "bash",
    status: "completed",
    content: [],
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_200,
    ...overrides,
  };
}

describe("ToolCallCard R8.2 polish", () => {
  it("applies the toolcall--compact class for inline transcript use", () => {
    const { container } = render(<ToolCallCard tc={baseTc()} />);
    const root = container.querySelector(".toolcall");
    expect(root).toBeTruthy();
    expect(root?.classList.contains("toolcall--compact")).toBe(true);
  });

  it("applies toolcall--ok for completed status", () => {
    const { container } = render(<ToolCallCard tc={baseTc({ status: "completed" })} />);
    const root = container.querySelector(".toolcall");
    expect(root?.classList.contains("toolcall--ok")).toBe(true);
    expect(root?.classList.contains("toolcall--err")).toBe(false);
    expect(root?.classList.contains("toolcall--run")).toBe(false);
  });

  it("applies toolcall--run for in_progress status", () => {
    const { container } = render(
      <ToolCallCard tc={baseTc({ status: "in_progress", completedAt: undefined })} />,
    );
    const root = container.querySelector(".toolcall");
    expect(root?.classList.contains("toolcall--run")).toBe(true);
  });

  it("applies toolcall--err for failed status", () => {
    const { container } = render(<ToolCallCard tc={baseTc({ status: "failed" })} />);
    const root = container.querySelector(".toolcall");
    expect(root?.classList.contains("toolcall--err")).toBe(true);
  });

  it("renders duration label + data-duration-ms when startedAt is set", () => {
    const { container } = render(
      <ToolCallCard
        tc={baseTc({
          status: "completed",
          startedAt: 1_000,
          completedAt: 2_200,
        })}
      />,
    );
    const duration = container.querySelector('[data-testid="toolcall-duration"]');
    expect(duration).toBeTruthy();
    expect(duration?.getAttribute("data-duration-ms")).toBe("1200");
    // 1.2s is the short human label for 1200ms.
    expect(duration?.textContent).toMatch(/1\.2s/);
  });

  it("omits duration label for legacy cards without startedAt", () => {
    const { container } = render(
      <ToolCallCard
        tc={baseTc({
          status: "completed",
          startedAt: undefined,
          completedAt: undefined,
        })}
      />,
    );
    expect(container.querySelector('[data-testid="toolcall-duration"]')).toBeNull();
  });

  it("status mark gets the right modifier class", () => {
    const cases = [
      { status: "completed" as const, cls: "toolcall__status-mark--completed" },
      { status: "failed" as const, cls: "toolcall__status-mark--failed" },
      { status: "in_progress" as const, cls: "toolcall__status-mark--in_progress" },
    ];
    for (const c of cases) {
      const { container } = render(<ToolCallCard tc={baseTc({ status: c.status })} />);
      const mark = container.querySelector(".toolcall__status-mark");
      expect(mark?.classList.contains(c.cls), `status ${c.status} → ${c.cls}`).toBe(true);
    }
  });

  it("fires onOpen with the original ToolCallView when clicked", () => {
    const onOpen = vi.fn();
    const tc = baseTc();
    const { container } = render(<ToolCallCard tc={tc} onOpen={onOpen} />);
    const btn = container.querySelector(".toolcall") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toBe(tc);
  });

  it("title attribute carries status + duration summary for screen readers", () => {
    const { container } = render(
      <ToolCallCard
        tc={baseTc({
          status: "failed",
          startedAt: 1_000,
          completedAt: 5_500,
        })}
      />,
    );
    const btn = container.querySelector(".toolcall") as HTMLButtonElement;
    expect(btn.title).toMatch(/失败/);
    expect(btn.title).toMatch(/4\.5s|4500/);
  });
});
