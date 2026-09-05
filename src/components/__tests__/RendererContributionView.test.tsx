import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RendererSlotView } from "@openbuddy/ui-workbench";

describe("RendererSlotView", () => {
  it("does not expose internal slot metadata when no component is registered", () => {
    const { container } = render(
      <RendererSlotView
        entry={{
          options: { name: "conversation.input.overlay", id: "user-questions" },
          component: undefined,
          registrant: "deepseek-compat",
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(container.textContent).not.toContain("user-questions");
    expect(container.textContent).not.toContain("conversation.input.overlay");
  });

  it("only renders an explicit user-facing fallback", () => {
    const { container } = render(
      <RendererSlotView
        entry={{
          options: { name: "home.action", id: "welcome", label: "打开欢迎页", renderFallback: true },
          component: undefined,
        }}
      />,
    );

    expect(container).toHaveTextContent("打开欢迎页");
  });
});
