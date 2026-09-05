import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Callback } from "../Callback";

/**
 * Callback 页面测试
 * - 验证正常回调跳转到 "/"
 * - 验证错误时显示失败页
 */

const mockHandleCallback = vi.fn();

vi.mock("../oidc-client", () => ({
  handleCallback: (...args: unknown[]) => mockHandleCallback(...args),
}));

describe("Callback", () => {
  beforeEach(() => {
    mockHandleCallback.mockReset();
  });

  it("renders loading state initially", () => {
    mockHandleCallback.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <MemoryRouter initialEntries={["/callback?code=abc&state=xyz"]}>
        <Routes>
          <Route path="/callback" element={<Callback />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/正在完成登录/)).toBeTruthy();
  });

  it("navigates to / after successful callback", async () => {
    mockHandleCallback.mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={["/callback?code=abc&state=xyz"]}>
        <Routes>
          <Route path="/callback" element={<Callback />} />
          <Route path="/" element={<div data-testid="dashboard">Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeTruthy();
    });
  });

  it("shows error page when callback fails", async () => {
    mockHandleCallback.mockRejectedValue(new Error("state mismatch"));
    render(
      <MemoryRouter initialEntries={["/callback?code=abc&state=xyz"]}>
        <Routes>
          <Route path="/callback" element={<Callback />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/登录失败/)).toBeTruthy();
      expect(screen.getByText(/state mismatch/)).toBeTruthy();
    });
  });
});
