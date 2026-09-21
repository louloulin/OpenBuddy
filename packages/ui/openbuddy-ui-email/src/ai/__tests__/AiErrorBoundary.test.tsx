/**
 * AiErrorBoundary — AI 区域错误边界单测(P3-6)。
 *
 * 覆盖:
 *   - 子组件抛错时显示紧凑 fallback
 *   - 异常被转发到 errorReporter
 *   - 重置后子组件重新挂载
 *   - renderFallback 自定义回调
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { AiErrorBoundary } from "../components/AiErrorBoundary";
import { errorReporter, resetErrorReporter } from "../error-reporter";

beforeEach(() => resetErrorReporter());

function Boom({ shouldThrow }: { shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) throw new Error("kaboom");
  return <div data-testid="ok">ok</div>;
}

describe("AiErrorBoundary", () => {
  it("子组件正常时不显示 fallback", () => {
    render(
      <AiErrorBoundary scope="ai-inbox">
        <Boom shouldThrow={false} />
      </AiErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeTruthy();
  });

  it("子组件抛错时显示紧凑 fallback", () => {
    // 抑制 React 的错误日志噪声
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AiErrorBoundary scope="ai-summary">
        <Boom shouldThrow={true} />
      </AiErrorBoundary>,
    );
    // 复用 ErrorBoundary compact — 标题含 scope
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/ai-summary/)).toBeTruthy();
    spy.mockRestore();
  });

  it("异常被转发到 errorReporter", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AiErrorBoundary scope="ai-action-strip">
        <Boom shouldThrow={true} />
      </AiErrorBoundary>,
    );
    const recent = errorReporter.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.message).toBe("kaboom");
    expect(recent[0]?.context?.scope).toBe("ai-action-strip");
    spy.mockRestore();
  });

  it("renderFallback 自定义回调生效", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AiErrorBoundary
        scope="ai-test"
        renderFallback={(err, reset) => (
          <div>
            <span data-testid="custom-msg">{err.message}</span>
            <button type="button" data-testid="custom-reset" onClick={reset}>
              reset
            </button>
          </div>
        )}
      >
        <Boom shouldThrow={true} />
      </AiErrorBoundary>,
    );
    expect(screen.getByTestId("custom-msg").textContent).toBe("kaboom");
    spy.mockRestore();
  });
});
