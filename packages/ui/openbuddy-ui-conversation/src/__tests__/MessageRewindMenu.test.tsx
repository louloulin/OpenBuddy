/**
 * MessageRewindMenu.test.tsx — Plan5 B.10
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MessageRewindMenu } from "../parts/MessageRewindMenu";

describe("MessageRewindMenu", () => {
  it("renders disabled when no promptIndex is provided", () => {
    const { container } = render(
      <MessageRewindMenu messageId="m-1" />,
    );
    const btn = container.querySelector('[data-testid="msg-rewind"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("renders enabled when promptIndex and sessionId are provided", () => {
    const { container } = render(
      <MessageRewindMenu messageId="m-1" promptIndex={2} sessionId="s-1" />,
    );
    const btn = container.querySelector('[data-testid="msg-rewind"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("invokes onRewind with the prompt index when clicked", () => {
    const onRewind = vi.fn();
    const { container } = render(
      <MessageRewindMenu
        messageId="m-1"
        promptIndex={3}
        sessionId="s-1"
        onRewind={onRewind}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="msg-rewind"]')!);
    expect(onRewind).toHaveBeenCalledWith({ promptIndex: 3 });
  });

  it("shows the fork button when allowFork + onFork are set", () => {
    const onFork = vi.fn();
    const { container } = render(
      <MessageRewindMenu messageId="m-1" promptIndex={0} allowFork onFork={onFork} />,
    );
    expect(container.querySelector('[data-testid="msg-fork"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid="msg-fork"]')!);
    expect(onFork).toHaveBeenCalled();
  });

  it("hides the fork button when allowFork is false", () => {
    const { container } = render(
      <MessageRewindMenu messageId="m-1" promptIndex={0} />,
    );
    expect(container.querySelector('[data-testid="msg-fork"]')).toBeNull();
  });

  it("reports toast on revert failure", () => {
    const onRewind = vi.fn(() => {
      throw new Error("oops");
    });
    const onToast = vi.fn();
    const { container } = render(
      <MessageRewindMenu
        messageId="m-1"
        promptIndex={0}
        sessionId="s-1"
        onRewind={onRewind}
        onToast={onToast}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="msg-rewind"]')!);
    // 微任务后捕获 toast
    return Promise.resolve().then(() => {
      expect(onToast).toHaveBeenCalledWith(expect.stringContaining("重发失败"));
    });
  });
});
