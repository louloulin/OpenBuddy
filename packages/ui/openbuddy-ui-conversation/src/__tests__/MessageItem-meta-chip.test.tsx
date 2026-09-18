import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
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
 * R8.15 — model id + token-throughput chips in the meta row.
 *
 * Mirrors PI-Desktop's MessageMeta pattern: a small brand-tinted
 * pill carrying the producing model id, plus a neutral throughput
 * pill (\"42 tok/s\") when the completion count + duration are both
 * available.
 */
function makeAssistantMessage(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "m1",
    role: "assistant" as const,
    parts: [{ kind: "text" as const, text: "Hello!" }],
    complete: true,
    createdAt: now - 2_000,
    completedAt: now,
    ...overrides,
  };
}

describe("MessageItem — R8.15 model + throughput chips", () => {
  it("renders the .msg__meta-chip--model pill when modelId is present", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({ modelId: "claude-opus-4-7" })}
        streaming={false}
      />,
    );
    const pill = container.querySelector(".msg__meta-chip--model");
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toContain("claude-opus-4-7");
    expect(pill?.getAttribute("title")).toBe("model: claude-opus-4-7");
    // The pill must carry a lucide icon (Cpu).
    expect(pill?.querySelector("svg")).toBeTruthy();
  });

  it("renders the throughput pill when outputTokens + duration are both present", () => {
    const now = Date.now();
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({
          createdAt: now - 4_000,
          completedAt: now,
          outputTokens: 800,
        })}
        streaming={false}
      />,
    );
    const pill = container.querySelector(".msg__meta-chip--throughput");
    expect(pill).toBeTruthy();
    // 800 tokens / 4 seconds = 200 tok/s → rounded integer.
    expect(pill?.textContent).toMatch(/200 tok\/s/);
    // Tooltip carries the raw numbers for accessibility / debugging.
    expect(pill?.getAttribute("title")).toContain("800");
  });

  it("omits the throughput pill for sub-second turns (avoids inf-tok/s)", () => {
    const now = Date.now();
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({
          createdAt: now - 200,
          completedAt: now,
          outputTokens: 100,
        })}
        streaming={false}
      />,
    );
    expect(container.querySelector(".msg__meta-chip--throughput")).toBeNull();
  });

  it("does NOT render either chip while the turn is still streaming", () => {
    const now = Date.now();
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({
          id: "m2",
          role: "assistant",
          complete: false,
          parts: [{ kind: "text", text: "..." }],
          createdAt: now - 1000,
          modelId: "claude-opus-4-7",
          outputTokens: 42,
        })}
        streaming={true}
        streamingDurationMs={1000}
      />,
    );
    // Streaming chips would be misleading — the model id is known but
    // tok/s hasn't settled yet.
    expect(container.querySelector(".msg__meta-chip--model")).toBeNull();
    expect(container.querySelector(".msg__meta-chip--throughput")).toBeNull();
    // But the streaming pulse label still shows.
    const streaming = container.querySelector(".msg__meta--streaming");
    expect(streaming).toBeTruthy();
    expect(streaming?.textContent).toContain("正在生成");
  });

  it("renders both chips together when modelId + outputTokens + duration are set", () => {
    const now = Date.now();
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({
          createdAt: now - 5_000,
          completedAt: now,
          modelId: "claude-opus-4-7",
          outputTokens: 1000,
        })}
        streaming={false}
      />,
    );
    expect(container.querySelector(".msg__meta-chip--model")).toBeTruthy();
    expect(container.querySelector(".msg__meta-chip--throughput")).toBeTruthy();
    // R58 — outputTokens now also renders the "X out" chip alongside the
    // throughput chip, so the row carries 3 pills total (model +
    // output + throughput). inputTokens is absent so no input chip.
    expect(container.querySelector(".msg__meta-chip--output")).toBeTruthy();
    expect(container.querySelector(".msg__meta-chip--input")).toBeNull();
    const meta = container.querySelector(".msg__meta");
    const chips = meta?.querySelectorAll(".msg__meta-chip");
    expect(chips?.length).toBe(3);
  });
});
