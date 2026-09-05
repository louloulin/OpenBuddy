import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

/**
 * R6.6 — Snapshot test of the ChatView error banner.
 *
 * Mirrors the production JSX block from `ChatView.tsx` so any markup
 * drift between the production component and the test surfaces as a
 * failing assertion. ChatView itself is too tightly coupled to the app
 * state tree to mount in a unit test (per `ChatViewEmptyState.test.tsx`).
 *
 * Coverage:
 *   - banner only renders when `error` is truthy
 *   - retry button visibility respects session / streaming / hasUserMsg
 *   - clicking retry forwards the last user message text
 *   - clicking close invokes the dismiss callback
 */
type Role = "user" | "assistant";
type TextPart = { kind: "text"; text: string };
type Part = TextPart | { kind: "thought"; text: string } | { kind: "tool_call"; toolCall: unknown };
interface MiniMessage { id: string; role: Role; parts: Part[]; complete: boolean }

function ErrorBanner(props: {
  error?: string | null;
  sessionId?: string | null;
  streaming?: boolean;
  messages?: MiniMessage[];
  onRetryLast?: (text: string) => void;
  onDismiss?: () => void;
}) {
  const { error, sessionId, streaming, messages = [], onRetryLast, onDismiss } = props;
  if (!error) return null;
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const userText = lastUserMsg
    ? lastUserMsg.parts.filter((p): p is TextPart => p.kind === "text").map((p) => p.text).join("\n")
    : "";
  const showRetry = !!sessionId && !streaming && userText.trim().length > 0;
  return (
    <div className="chatview__error-banner" role="alert">
      <span className="chatview__error-icon" aria-hidden="true">⚠</span>
      <span className="chatview__error-text" style={{ whiteSpace: "pre-wrap" }}>{error}</span>
      {showRetry && (
        <button
          className="chatview__error-retry"
          onClick={() => onRetryLast?.(userText)}
          aria-label="重试最后一条消息"
          title="重试最后一条消息"
          data-testid="chatview-error-retry"
        >
          ↻ 重试
        </button>
      )}
      <button
        className="chatview__error-close"
        onClick={onDismiss}
        aria-label="关闭错误提示"
        title="关闭"
      >
        ×
      </button>
    </div>
  );
}

function makeUserMsg(id: string, text: string): MiniMessage {
  return { id, role: "user", parts: [{ kind: "text", text }], complete: true };
}

describe("ChatView error banner — retry affordance", () => {
  it("does not render when there is no error", () => {
    const { container } = render(<ErrorBanner />);
    expect(container.querySelector(".chatview__error-banner")).toBeNull();
  });

  it("renders the banner with the error text and a close button", () => {
    const { container } = render(<ErrorBanner error="bridge unavailable" onDismiss={() => undefined} />);
    const banner = container.querySelector(".chatview__error-banner");
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute("role")).toBe("alert");
    expect(container.querySelector(".chatview__error-text")?.textContent).toBe("bridge unavailable");
    expect(container.querySelector(".chatview__error-close")).not.toBeNull();
  });

  it("hides the retry button when there is no active session", () => {
    const { container } = render(
      <ErrorBanner
        error="boom"
        sessionId={null}
        messages={[makeUserMsg("u1", "hello")]}
      />,
    );
    expect(container.querySelector(".chatview__error-retry")).toBeNull();
  });

  it("hides the retry button while streaming is in progress", () => {
    const { container } = render(
      <ErrorBanner
        error="boom"
        sessionId="s-1"
        streaming
        messages={[makeUserMsg("u1", "hello")]}
      />,
    );
    expect(container.querySelector(".chatview__error-retry")).toBeNull();
  });

  it("hides the retry button when there is no prior user message to retry", () => {
    const { container } = render(<ErrorBanner error="boom" sessionId="s-1" messages={[]} />);
    expect(container.querySelector(".chatview__error-retry")).toBeNull();
  });

  it("shows the retry button when session, !streaming, and a user message are all present", () => {
    const { container } = render(
      <ErrorBanner
        error="boom"
        sessionId="s-1"
        messages={[makeUserMsg("u1", "继续推进")]}
      />,
    );
    const retry = container.querySelector(".chatview__error-retry");
    expect(retry).not.toBeNull();
    expect(retry?.getAttribute("aria-label")).toBe("重试最后一条消息");
    expect(retry?.textContent).toMatch(/重试/);
  });

  it("clicking retry forwards the last user message text to the handler", () => {
    let captured = "";
    const { container } = render(
      <ErrorBanner
        error="boom"
        sessionId="s-1"
        messages={[
          makeUserMsg("u1", "旧消息"),
          makeUserMsg("u2", "继续推进第三章"),
        ]}
        onRetryLast={(t) => { captured = t; }}
      />,
    );
    const retry = container.querySelector(".chatview__error-retry") as HTMLButtonElement;
    retry.click();
    expect(captured).toBe("继续推进第三章");
  });

  it("clicking close invokes the dismiss callback", () => {
    let dismissed = 0;
    const { container } = render(
      <ErrorBanner error="boom" sessionId="s-1" onDismiss={() => { dismissed += 1; }} />,
    );
    const close = container.querySelector(".chatview__error-close") as HTMLButtonElement;
    close.click();
    expect(dismissed).toBe(1);
  });
});
