import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MessageItem } from "../MessageItem";

vi.mock("@openbuddy/ui-theme/client", () => ({
  useThemeSnapshot: (selector: (s: { current: () => string }) => unknown) =>
    selector({ current: () => "light" }),
}));

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

/**
 * R8.16 — smooth streaming→complete transition.
 *
 * When an assistant message flips from streaming → complete, the
 * `.msg--just-completed` class is applied for ~320ms so CSS can
 * fade + slide the freshly-settled bubble.
 */
function makeAssistantMessage(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "m1",
    role: "assistant" as const,
    parts: [{ kind: "text" as const, text: "streaming text…" }],
    complete: false,
    createdAt: now - 1000,
    ...overrides,
  };
}

describe("MessageItem — R8.16 streaming→complete transition", () => {
  it("applies .msg--just-completed for ~320ms after streaming→complete", () => {
    const msg = makeAssistantMessage();
    const { container, rerender } = render(
      <MessageItem sessionId="s1" message={msg} streaming={true} streamingDurationMs={1000} />,
    );
    expect(container.querySelector(".msg--just-completed")).toBeNull();
    // Flip the streaming flag + mark complete.
    rerender(
      <MessageItem
        sessionId="s1"
        message={{ ...msg, complete: true, completedAt: Date.now() }}
        streaming={false}
      />,
    );
    // The bubble must carry the just-completed class immediately after the flip.
    expect(container.querySelector(".msg--just-completed")).toBeTruthy();
  });

  it("does NOT apply .msg--just-completed when the message was never streaming", () => {
    // Historic message loaded from JSONL: complete from the start, never streamed.
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({ complete: true, completedAt: Date.now() })}
        streaming={false}
      />,
    );
    expect(container.querySelector(".msg--just-completed")).toBeNull();
  });

  it("clears .msg--just-completed after the timeout window expires", () => {
    vi.useFakeTimers();
    try {
      const msg = makeAssistantMessage();
      const { container, rerender } = render(
        <MessageItem sessionId="s1" message={msg} streaming={true} streamingDurationMs={1000} />,
      );
      rerender(
        <MessageItem
          sessionId="s1"
          message={{ ...msg, complete: true, completedAt: Date.now() }}
          streaming={false}
        />,
      );
      expect(container.querySelector(".msg--just-completed")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(container.querySelector(".msg--just-completed")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
