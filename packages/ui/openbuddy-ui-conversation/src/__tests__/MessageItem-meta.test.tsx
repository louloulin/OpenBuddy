import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MessageItem } from "../MessageItem";

// MessageItem calls useThemeSnapshot internally; mock it to return "light".
vi.mock("@openbuddy/ui-theme/client", () => ({
  useThemeSnapshot: (selector: (s: { current: () => string }) => unknown) =>
    selector({ current: () => "light" }),
}));

// MessageItem calls the renderer-plugin-runtime hooks to discover plugin
// contributions; mock them to return empty arrays.
vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

/**
 * R8.14 — Per-message meta chip:
 *   - assistant complete bubble shows relative timestamp + duration chip
 *   - assistant streaming bubble shows the "X 正在生成…" pulse label
 *   - user bubble shows the timestamp alone (no duration)
 *   - bubbles without `createdAt` fall through cleanly (no chip)
 */
function makeAssistantMessage(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "m1",
    role: "assistant" as const,
    parts: [{ kind: "text" as const, text: "Hello!" }],
    complete: true,
    createdAt: now - 5 * 60 * 1000,
    completedAt: now,
    ...overrides,
  };
}

function makeUserMessage(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "u1",
    role: "user" as const,
    parts: [{ kind: "text" as const, text: "Hi" }],
    complete: true,
    createdAt: now - 60 * 1000,
    ...overrides,
  };
}

describe("MessageItem — R8.14 per-message meta chip", () => {
  it("renders the .msg__meta chip with relative timestamp on a complete assistant bubble", () => {
    const { container } = render(
      <MessageItem sessionId="s1" message={makeAssistantMessage()} streaming={false} />,
    );
    const meta = container.querySelector(".msg__meta");
    expect(meta).toBeTruthy();
    // 5 分钟前 for the 5-minute-old message
    expect(meta?.textContent).toContain("5 分钟前");
    // Duration chip renders when completedAt - createdAt > 0
    const detail = meta?.querySelector(".msg__meta-detail");
    expect(detail).toBeTruthy();
    expect(detail?.textContent).toMatch(/\d+s/);
  });

  it("renders the .msg__meta--streaming pulse label while the turn is in-flight", () => {
    const now = Date.now();
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={{
          id: "m2",
          role: "assistant",
          parts: [{ kind: "text", text: "partial…" }],
          complete: false,
          createdAt: now - 12_000,
        }}
        streaming={true}
        streamingDurationMs={12_000}
      />,
    );
    const meta = container.querySelector(".msg__meta.msg__meta--streaming");
    expect(meta).toBeTruthy();
    expect(meta?.textContent).toContain("正在生成");
    expect(meta?.textContent).toContain("12s");
  });

  it("renders the .msg__meta--user chip with a relative timestamp on user bubbles", () => {
    const { container } = render(
      <MessageItem sessionId="s1" message={makeUserMessage()} streaming={false} />,
    );
    const meta = container.querySelector(".msg__meta--user");
    expect(meta).toBeTruthy();
    // 1 minute ago
    expect(meta?.textContent).toContain("分钟前");
    // User bubbles never show the duration detail chip.
    expect(meta?.querySelector(".msg__meta-detail")).toBeNull();
  });

  it("does not render any .msg__meta when createdAt is missing (backward-compat)", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={{
          id: "m3",
          role: "assistant",
          parts: [{ kind: "text", text: "old" }],
          complete: true,
          // createdAt 是可选的(legacy transcripts 允许缺失),运行时用
          // guard 处理。这里不再需要 @ts-expect-error。
        }}
        streaming={false}
      />,
    );
    expect(container.querySelector(".msg__meta")).toBeNull();
    expect(container.querySelector(".msg__meta--user")).toBeNull();
  });

  it("renders the lucide Hourglass icon for streaming messages", () => {
    const now = Date.now();
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={{
          id: "m4",
          role: "assistant",
          parts: [],
          complete: false,
          createdAt: now - 1000,
        }}
        streaming={true}
        streamingDurationMs={1000}
      />,
    );
    const icon = container.querySelector(".msg__meta--streaming .msg__meta-icon svg");
    expect(icon).toBeTruthy();
  });

  it("renders the lucide Clock3 icon for completed messages", () => {
    const { container } = render(
      <MessageItem sessionId="s1" message={makeAssistantMessage()} streaming={false} />,
    );
    const icon = container.querySelector(".msg__meta .msg__meta-icon svg");
    expect(icon).toBeTruthy();
  });
});
