/**
 * R4.2 — StatusIndicator tests.
 *
 * Pure render assertions — the component has no side effects, just maps
 * props to ARIA-correct markup.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusIndicator } from "../StatusIndicator";

describe("StatusIndicator", () => {
  it("renders provider + model + connection label", () => {
    render(
      <StatusIndicator
        providerId="openai"
        providerLabel="OpenAI"
        modelLabel="gpt-5"
        connection="connected"
      />,
    );
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("gpt-5")).toBeTruthy();
    expect(screen.getByLabelText("连接状态：已连接")).toBeTruthy();
  });

  it("hides the rate-limit pill when not provided", () => {
    render(<StatusIndicator providerId="openai" connection="connected" />);
    expect(screen.queryByText(/速率限制/)).toBeNull();
  });

  it("renders rate-limit remaining in seconds when present", () => {
    render(
      <StatusIndicator
        providerId="openai"
        connection="connected"
        rateLimitRemainingMs={2500}
      />,
    );
    expect(screen.getByText(/2\.5s/)).toBeTruthy();
  });

  it("keeps the role=status wrapper mounted even when no provider is configured", () => {
    // R4.2 — no provider 信息(未配置场景)时,视觉上隐藏 chrome
    // 但保留 role="status" / aria-live wrapper,让
    // agent-died recovery surface(以及任何未来屏幕阅读器 announce
    // 连接状态变化)始终有 live region 可写入。ChatViewYield / Sidebar
    // 都默认挂载一个 connection="unknown" 的 StatusIndicator,所以
    // 即使 app 一启动还没选 model,DOM 里也至少有一个 role="status"。
    const { container } = render(<StatusIndicator connection="unknown" />);
    const root = container.firstChild as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root?.getAttribute("role")).toBe("status");
    expect(root?.getAttribute("aria-live")).toBe("polite");
    expect(root?.getAttribute("data-connection")).toBe("unknown");
    expect(root?.classList.contains("status-indicator--empty")).toBe(true);
    expect(screen.getByLabelText("连接状态：未知")).toBeTruthy();
  });
});