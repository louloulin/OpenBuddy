/**
 * MarkdownInlineCode-r8.55.test.tsx — guard spec for the R8.55
 * inline code copy button (PI-Desktop parity).
 *
 * Before R8.55 the inline `<code>` chips had no way to copy their
 * text without the user manually selecting it. R8.55 wraps the
 * children in a `.md-inline-code__text` span and renders a small
 * `.md-inline-code__copy` button next to it that:
 *   - is hidden by default (opacity 0)
 *   - reveals itself on hover / focus-within / focus-visible
 *   - swaps Copy → Check for 2s after a successful clipboard call
 *   - falls back to document.execCommand when navigator.clipboard
 *     isn't available (restricted Electron / sandbox contexts)
 *
 * Coverage:
 *   - default render: button exists with Copy icon + 复制 aria-label
 *   - click handler invokes navigator.clipboard.writeText with code
 *   - on success: button shows Check icon + 已复制 aria-label
 *   - aria-label reverts to 复制 after the 2s timeout
 *   - the children wrap in a .md-inline-code__text span
 *   - click stops propagation so surrounding handlers don't fire
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { MarkdownInlineCode } from "../components/MarkdownInlineCode";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("R8.55 MarkdownInlineCode copy button", () => {
  it("renders a hidden copy button with Copy icon + 复制 aria-label by default", () => {
    const { container } = render(
      <MarkdownInlineCode>{"foo"}</MarkdownInlineCode>,
    );
    const code = container.querySelector("code.md-inline-code");
    expect(code).toBeTruthy();
    const btn = code!.querySelector("button.md-inline-code__copy");
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute("aria-label")).toBe("复制");
    expect(btn!.querySelector("svg")).toBeTruthy();
    expect(btn!.classList.contains("md-inline-code__copy--ok")).toBe(false);
  });

  it("wraps children in a .md-inline-code__text span so the button can sit beside them", () => {
    const { container } = render(
      <MarkdownInlineCode>{"bar baz"}</MarkdownInlineCode>,
    );
    const textSpan = container.querySelector(".md-inline-code__text");
    expect(textSpan).toBeTruthy();
    expect(textSpan!.textContent).toBe("bar baz");
  });

  it("clicking the button calls navigator.clipboard.writeText with the code text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const { container } = render(
      <MarkdownInlineCode>{"hello world"}</MarkdownInlineCode>,
    );
    const btn = container.querySelector(
      "button.md-inline-code__copy",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("after a successful copy the button switches to Check icon + 已复制 aria-label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const { container } = render(
      <MarkdownInlineCode>{"copied text"}</MarkdownInlineCode>,
    );
    const btn = container.querySelector(
      "button.md-inline-code__copy",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute("aria-label")).toBe("已复制");
    expect(btn.classList.contains("md-inline-code__copy--ok")).toBe(true);
  });

  it("reverts to 复制 aria-label 2s after a successful copy", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const { container } = render(
      <MarkdownInlineCode>{"timed"}</MarkdownInlineCode>,
    );
    const btn = container.querySelector(
      "button.md-inline-code__copy",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute("aria-label")).toBe("已复制");
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(btn.getAttribute("aria-label")).toBe("复制");
    expect(btn.classList.contains("md-inline-code__copy--ok")).toBe(false);
  });

  it("clicking the button stops event propagation so surrounding handlers don't fire", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const parentClick = vi.fn();
    const { container } = render(
      <div onClick={parentClick}>
        <MarkdownInlineCode>{"nested"}</MarkdownInlineCode>
      </div>,
    );
    const btn = container.querySelector(
      "button.md-inline-code__copy",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(parentClick).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("nested");
  });

  it("falls back to document.execCommand when navigator.clipboard throws", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;
    const { container } = render(
      <MarkdownInlineCode>{"fallback path"}</MarkdownInlineCode>,
    );
    const btn = container.querySelector(
      "button.md-inline-code__copy",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(btn.getAttribute("aria-label")).toBe("已复制");
  });
});
