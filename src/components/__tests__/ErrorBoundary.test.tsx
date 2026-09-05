import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../ErrorBoundary";

function Boom(): never {
  throw new Error("test boom");
}

function Quiet(): null {
  return null;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Silence React's noisy console.error from error boundaries.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <span data-testid="kid">safe</span>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("kid").textContent).toBe("safe");
  });

  it("shows fallback UI when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/界面出现错误/)).toBeTruthy();
  });

  it("uses custom title when provided", () => {
    render(
      <ErrorBoundary title="渲染失败">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("渲染失败")).toBeTruthy();
  });

  it("renders reset button by default", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("返回首页")).toBeTruthy();
    expect(screen.getByText("重新加载")).toBeTruthy();
  });

  it("hides reset button when showReset is false", () => {
    render(
      <ErrorBoundary showReset={false}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.queryByText("返回首页")).toBeNull();
    expect(screen.getByText("重新加载")).toBeTruthy();
  });

  it("exposes error details in collapsible section", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const details = screen.getByText(/查看错误详情/);
    expect(details).toBeTruthy();
  });

  it("logs the error with component stack", () => {
    const spy = vi.spyOn(console, "error");
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("ErrorBoundary"),
    );
    expect(call).toBeTruthy();
  });

  it("renders nothing unusual when children are normal", () => {
    const { container } = render(
      <ErrorBoundary>
        <Quiet />
      </ErrorBoundary>,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});