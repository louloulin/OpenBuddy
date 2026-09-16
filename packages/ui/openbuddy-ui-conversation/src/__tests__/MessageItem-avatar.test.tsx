import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MessageItem } from "../MessageItem";

// MessageItem calls useThemeSnapshot internally; mock it to return "light".
vi.mock("@openbuddy/ui-theme/client", () => ({
  useThemeSnapshot: (selector: (s: { current: () => string }) => unknown) =>
    selector({ current: () => "light" }),
}));

// MessageItem calls the renderer-plugin-runtime hooks to discover plugin
// contributions; mock them to return empty arrays so the render path is
// pure.
vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

/**
 * R8.12 — Assistant avatar uses a lucide Sparkles icon inside a brand-
 * tinted gradient square, plus a small "AI" role badge next to the
 * Buddy name. Verifies the markup matches what production renders.
 */
function makeAssistantMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    role: "assistant" as const,
    parts: [{ kind: "text" as const, text: "Hello!" }],
    complete: true,
    ...overrides,
  };
}

describe("MessageItem — R8.12 assistant avatar visual", () => {
  it("renders the Sparkles icon inside .msg__avatar (no letter fallback)", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage()}
        streaming={false}
      />,
    );
    const avatar = container.querySelector(".msg__avatar");
    expect(avatar).toBeTruthy();
    expect(avatar?.getAttribute("aria-hidden")).toBe("true");
    // The avatar should contain an <svg> from lucide (Sparkles).
    const svg = avatar?.querySelector("svg");
    expect(svg).toBeTruthy();
    // No literal "B" letter remains (R7 had a text fallback).
    expect(avatar?.textContent?.trim()).toBe("");
  });

  it('renders the .msg__role badge with aria-label="AI assistant"', () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage()}
        streaming={false}
      />,
    );
    const role = container.querySelector(".msg__role");
    expect(role).toBeTruthy();
    expect(role?.getAttribute("aria-label")).toBe("AI assistant");
    expect(role?.textContent?.trim()).toBe("AI");
  });

  it("renders .msg__header containing avatar + name + role in DOM order", () => {
    const { container } = render(
      <MessageItem
        sessionId="s1"
        message={makeAssistantMessage()}
        streaming={false}
      />,
    );
    const header = container.querySelector(".msg__header");
    expect(header).toBeTruthy();
    const children = Array.from(header?.children ?? []);
    expect(children.length).toBe(3);
    expect(children[0].classList.contains("msg__avatar")).toBe(true);
    expect(children[1].classList.contains("msg__name")).toBe(true);
    expect(children[2].classList.contains("msg__role")).toBe(true);
  });
});
