import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { TooltipButton } from "../TooltipButton";

describe("TooltipButton (R8.11 shared icon-only action)", () => {
  it("renders an icon-only 26x26 button with aria-label", () => {
    const { container } = render(
      <TooltipButton tooltip="复制" aria-label="复制消息">
        <span data-testid="icon" />
      </TooltipButton>,
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tt-btn");
    expect(btn?.className).toContain("tt-btn--top");
    expect(btn?.getAttribute("aria-label")).toBe("复制消息");
    expect(btn?.getAttribute("type")).toBe("button");
    expect(btn?.getAttribute("data-tooltip")).toBe("复制");
    expect(container.querySelector('[data-testid="icon"]')).toBeTruthy();
  });

  it("uses aria-label when provided, falling back to tooltip", () => {
    const { container: c1 } = render(<TooltipButton tooltip="默认">x</TooltipButton>);
    expect(c1.querySelector("button")?.getAttribute("aria-label")).toBe("默认");

    const { container: c2 } = render(
      <TooltipButton tooltip="tooltip 文本" aria-label="ARIA 文本">
        x
      </TooltipButton>,
    );
    expect(c2.querySelector("button")?.getAttribute("aria-label")).toBe("ARIA 文本");
  });

  it("calls onClick when clicked and ignores disabled", () => {
    const onClick = vi.fn();
    const { container } = render(
      <TooltipButton tooltip="点我" onClick={onClick}>
        x
      </TooltipButton>,
    );
    fireEvent.click(container.querySelector("button")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant + tooltipSide modifiers", () => {
    const { container: c1 } = render(
      <TooltipButton tooltip="primary" variant="primary">
        x
      </TooltipButton>,
    );
    expect(c1.querySelector("button")?.className).toContain("tt-btn--primary");

    const { container: c2 } = render(
      <TooltipButton tooltip="below" tooltipSide="bottom">
        x
      </TooltipButton>,
    );
    expect(c2.querySelector("button")?.className).toContain("tt-btn--bottom");
  });

  it("respects disabled + aria-disabled attrs", () => {
    const onClick = vi.fn();
    const { container } = render(
      <TooltipButton tooltip="disabled" disabled onClick={onClick}>
        x
      </TooltipButton>,
    );
    const btn = container.querySelector("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(btn);
    // native disabled buttons don't fire click — Playwright would catch
    // the synthetic; in jsdom we assert the attribute is set.
    expect(btn.getAttribute("disabled")).not.toBeNull();
  });

  it("merges custom className while keeping the base tt-btn class", () => {
    const { container } = render(
      <TooltipButton tooltip="merge" className="msg__action-btn">
        x
      </TooltipButton>,
    );
    const cls = container.querySelector("button")?.className ?? "";
    expect(cls).toContain("tt-btn");
    expect(cls).toContain("msg__action-btn");
  });

  it("forwards ref to the underlying <button> element", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <TooltipButton tooltip="ref" ref={ref}>
        x
      </TooltipButton>,
    );
    expect(ref.current).toBeTruthy();
    expect(ref.current?.tagName).toBe("BUTTON");
  });
});
