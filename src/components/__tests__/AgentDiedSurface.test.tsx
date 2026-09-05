/**
 * R4.2 / UX-3 — agent-died recovery surface renderer-side contract.
 *
 * The Playwright spec tests/electron/agent-died.spec.ts asserts the
 * renderer mounts:
 *   1. at least one `role="status"` element
 *   2. at least one element with an `aria-live` attribute
 *
 * That spec needs an Electron launch and is flaky in CI; the renderer-
 * side contract is much cheaper to verify in vitest. This file asserts
 * the same invariants against the two components that supply those
 * surfaces, so a future change that removes them will fail here before
 * the heavier e2e runs.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StatusIndicator } from "../StatusIndicator";
import { Toast } from "@openbuddy/ui-primitives";

describe("agent-died recovery surface (renderer-side contract)", () => {
  it("StatusIndicator mounts role=status with aria-live even when no provider", () => {
    const { container } = render(<StatusIndicator connection="unknown" />);
    const root = container.firstChild as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root?.getAttribute("role")).toBe("status");
    expect(root?.getAttribute("aria-live")).toBe("polite");
    expect(root?.getAttribute("aria-atomic")).toBe("true");
  });

  it("StatusIndicator exposes the connection label for screen readers", () => {
    const { container } = render(<StatusIndicator connection="disconnected" />);
    expect(container.querySelector('[aria-label="连接状态：已断开"]')).not.toBeNull();
  });

  it("Toast queue mounts the aria-live wrapper even with an empty entries array", () => {
    const { container } = render(<Toast entries={[]} onDismiss={() => undefined} />);
    const stack = container.querySelector(".toast-stack");
    expect(stack).not.toBeNull();
    expect(stack?.getAttribute("role")).toBe("status");
    expect(stack?.getAttribute("aria-live")).toBe("polite");
  });

  it("Toast queue still renders each entry's role=status when populated", () => {
    const { container } = render(
      <Toast
        entries={[
          { id: "a", message: "agent died", kind: "error" },
        ]}
        onDismiss={() => undefined}
      />,
    );
    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses.length).toBeGreaterThanOrEqual(2);
  });
});