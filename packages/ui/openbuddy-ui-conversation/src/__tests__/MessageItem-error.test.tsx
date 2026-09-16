import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageItem } from "../MessageItem";

import type { ChatMessage } from "@/stores/session-store";

vi.mock("../../../../ui/openbuddy-ui-workbench/src/pdfjs-loader", () => ({
  loadPdfJs: () => Promise.reject(new Error("pdfjs unavailable")),
}));

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

vi.mock("@openbuddy/ui-theme/client", () => ({
  useThemeSnapshot: (selector: (state: { current: () => string }) => unknown) =>
    selector({ current: () => "light" }),
}));
function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "asst-1",
    role: "assistant",
    parts: [],
    complete: true,
    ...overrides,
  };
}

describe("MessageItem error rendering (failed assistant turn)", () => {
  it("renders TurnErrorCard with the structured error message", () => {
    render(
      <MessageItem
        message={assistantMessage({
          error: {
            message: "429 速率限制：调用频率过高",
            code: "rate_limit_error",
          },
        })}
        streaming={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-error-code",
      "rate_limit_error",
    );
    expect(
      screen.getByText(/429 速率限制：调用频率过高/),
    ).toBeTruthy();
    expect(screen.getByText("已达到模型用量上限")).toBeTruthy();
  });

  it("renders a config-error card with a settings escape hatch", () => {
    const onOpenSettings = vi.fn();
    render(
      <MessageItem
        message={assistantMessage({
          error: { message: "401 invalid api key", code: "auth_error" },
        })}
        streaming={false}
        onOpenSettings={onOpenSettings}
      />,
    );
    const settingsBtn = screen.getByRole("button", { name: /去设置/ });
    settingsBtn.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("suppresses 复制 / MD buttons when the bubble has no plain text", () => {
    const onRetry = vi.fn();
    render(
      <MessageItem
        message={assistantMessage({
          error: { message: "boom", code: "aborted" },
        })}
        streaming={false}
        onRetry={onRetry}
      />,
    );
    // Footer is rendered for error bubbles so the retry affordance is visible,
    // but the copy/MD buttons require text — they should be hidden.
    expect(screen.queryByRole("button", { name: /复制纯文本/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /复制 Markdown/ })).toBeNull();
    // 重试 affordance is shown when onRetry is provided.
    const retry = screen.getByRole("button", { name: "重试" });
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("skips empty assistant bubbles that have no parts and no error", () => {
    const { container } = render(
      <MessageItem
        message={assistantMessage({ parts: [], complete: true })}
        streaming={false}
      />,
    );
    // The bubble container is omitted entirely so the transcript never shows
    // a header-with-nothing. There is no `.msg--assistant` element rendered.
    expect(container.querySelector(".msg--assistant")).toBeNull();
  });
});
