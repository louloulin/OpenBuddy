/**
 * R58 — Input / output token chips on MessageMeta.
 *
 * Verifies that when the message carries `inputTokens` and `outputTokens`
 * from the provider, the meta chip renders:
 *   - `<formatted> in` chip with Hash icon
 *   - `<formatted> out` chip with Zap icon
 *   - `<throughput> tok/s` chip when durationMs >= 1s
 *
 * Backward compat: when inputTokens / outputTokens are absent (pre-R58
 * history), the chip is skipped — no visual regression.
 */
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

function makeAssistantMessage(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "m1",
    role: "assistant" as const,
    parts: [{ kind: "text" as const, text: "Hello!" }],
    complete: true,
    createdAt: now - 12 * 1000,
    completedAt: now,
    ...overrides,
  };
}

describe("MessageItem — R58 input / output token chips", () => {
  it("renders the input chip when inputTokens is set", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({ inputTokens: 1234 })}
        streaming={false}
      />,
    );
    const input = container.querySelector(".msg__meta-chip--input");
    expect(input).toBeTruthy();
    expect(input?.textContent).toMatch(/1\.2k in/);
    expect(input?.getAttribute("title")).toContain("1234 prompt tokens");
  });

  it("renders the output chip when outputTokens is set", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({ outputTokens: 256 })}
        streaming={false}
      />,
    );
    const out = container.querySelector(".msg__meta-chip--output");
    expect(out).toBeTruthy();
    expect(out?.textContent).toMatch(/256 out/);
  });

  it("renders both chips in reading order: in → out → tok/s", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({
          inputTokens: 5000,
          outputTokens: 200,
          // 12s duration → tok/s should render
        })}
        streaming={false}
      />,
    );
    const chips = Array.from(
      container.querySelectorAll(".msg__meta-chip--input, .msg__meta-chip--output, .msg__meta-chip--throughput"),
    );
    expect(chips).toHaveLength(3);
    expect(chips[0].classList.contains("msg__meta-chip--input")).toBe(true);
    expect(chips[1].classList.contains("msg__meta-chip--output")).toBe(true);
    expect(chips[2].classList.contains("msg__meta-chip--throughput")).toBe(true);
  });

  it("hides input/output chips while streaming (only timestamp + spinner)", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({ inputTokens: 1000, outputTokens: 100, complete: false })}
        streaming={true}
      />,
    );
    expect(container.querySelector(".msg__meta-chip--input")).toBeNull();
    expect(container.querySelector(".msg__meta-chip--output")).toBeNull();
    // Streaming label is rendered instead
    expect(container.querySelector(".msg__meta")?.textContent).toContain("正在生成");
  });

  it("backward compat: chips absent when tokens are missing (no visual regression)", () => {
    const { container } = render(
      <MessageItem sessionId="s1" message={makeAssistantMessage()} streaming={false} />,
    );
    expect(container.querySelector(".msg__meta-chip--input")).toBeNull();
    expect(container.querySelector(".msg__meta-chip--output")).toBeNull();
  });

  it("formats large token counts with k/m suffix", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage({ inputTokens: 250_000, outputTokens: 1500 })}
        streaming={false}
      />,
    );
    expect(container.querySelector(".msg__meta-chip--input")?.textContent).toMatch(/250k in/);
    expect(container.querySelector(".msg__meta-chip--output")?.textContent).toMatch(/1\.5k out/);
  });
});
