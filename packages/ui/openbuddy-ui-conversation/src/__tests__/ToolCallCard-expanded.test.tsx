/**
 * ToolCallCard-expanded.test.tsx
 *
 * Phase B.3 测试:验证工具卡的 inline 展开/折叠。
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ToolCallCard } from "../ToolCallCard";
import type { ToolCallView } from "@openbuddy/ui-state/session-store";

function makeTc(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: "tc-1",
    title: "ls -la /tmp",
    kind: "bash",
    status: "completed",
    content: [],
    ...overrides,
  };
}

describe("ToolCallCard inline expand (Phase B.3)", () => {
  it("renders compact mode by default with expand toggle visible", () => {
    const { container } = render(<ToolCallCard tc={makeTc()} />);
    expect(container.querySelector(".toolcall--compact")).toBeTruthy();
    expect(container.querySelector('[data-testid="toolcall-expand"]')).toBeTruthy();
  });

  it("switches to expanded mode on double-click", () => {
    const { container } = render(<ToolCallCard tc={makeTc()} />);
    const card = container.querySelector(".toolcall") as HTMLElement;
    fireEvent.doubleClick(card);
    expect(container.querySelector('[data-testid="toolcall-expanded"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="toolcall-collapse"]')).toBeTruthy();
  });

  it("switches to expanded mode on Cmd+click", () => {
    const { container } = render(<ToolCallCard tc={makeTc()} />);
    const card = container.querySelector(".toolcall") as HTMLElement;
    fireEvent.click(card, { metaKey: true });
    expect(container.querySelector('[data-testid="toolcall-expanded"]')).toBeTruthy();
  });

  it("does not expand when expandMode=compact", () => {
    const { container } = render(
      <ToolCallCard tc={makeTc()} expandMode="compact" />,
    );
    const card = container.querySelector(".toolcall") as HTMLElement;
    fireEvent.doubleClick(card);
    expect(container.querySelector('[data-testid="toolcall-expand"]')).toBeNull();
    expect(container.querySelector('[data-testid="toolcall-expanded"]')).toBeNull();
  });

  it("renders expanded mode by default when expandMode=expanded", () => {
    const { container } = render(
      <ToolCallCard tc={makeTc()} expandMode="expanded" />,
    );
    expect(container.querySelector('[data-testid="toolcall-expanded"]')).toBeTruthy();
  });

  it("collapse toggle returns to compact", () => {
    const { container } = render(<ToolCallCard tc={makeTc()} />);
    const card = container.querySelector(".toolcall") as HTMLElement;
    fireEvent.doubleClick(card);
    const collapse = container.querySelector(
      '[data-testid="toolcall-collapse"]',
    ) as HTMLElement;
    fireEvent.click(collapse);
    expect(container.querySelector('[data-testid="toolcall-expanded"]')).toBeNull();
    expect(container.querySelector('[data-testid="toolcall-expand"]')).toBeTruthy();
  });

  it("fires onOpen on plain click", () => {
    const onOpen = vi.fn();
    const tc = makeTc();
    const { container } = render(<ToolCallCard tc={tc} onOpen={onOpen} />);
    const card = container.querySelector(".toolcall") as HTMLElement;
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
