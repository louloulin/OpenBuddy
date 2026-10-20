import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthGuard } from "../AuthGuard";

/**
 * AuthGuard 路由守卫测试
 * - 未登录 → 跳转到 /login
 * - 已登录 → 渲染 Outlet（嵌套路由）
 */

const mockLoadTokens = vi.fn();

vi.mock("../oidc-client", () => ({
  loadTokens: () => mockLoadTokens(),
}));

describe("AuthGuard", () => {
  // vitest.config sets `globals: false`, so @testing-library/react's automatic
  // afterEach cleanup never registers and each render() stacks onto the last
  // one's DOM. Same pattern as the other .tsx suites in packages/ui.
  afterEach(() => cleanup());

  beforeEach(() => {
    mockLoadTokens.mockReset();
  });

  it("redirects to /login when no tokens", () => {
    mockLoadTokens.mockReturnValue(null);
    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route element={<AuthGuard />}>
            <Route path="/protected" element={<div data-testid="protected">Protected</div>} />
          </Route>
          <Route path="/login" element={<div data-testid="login">Login Page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("login")).toBeTruthy();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("renders Outlet when tokens are valid", () => {
    mockLoadTokens.mockReturnValue({
      accessToken: "valid-jwt",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3600_000,
    });
    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route element={<AuthGuard />}>
            <Route path="/protected" element={<div data-testid="protected">Protected</div>} />
          </Route>
          <Route path="/login" element={<div data-testid="login">Login Page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("protected")).toBeTruthy();
    expect(screen.queryByTestId("login")).toBeNull();
  });

  it("redirects to /login when token expired (loadTokens returns null)", () => {
    mockLoadTokens.mockReturnValue(null); // loadTokens filters expired tokens
    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route element={<AuthGuard />}>
            <Route path="/protected" element={<div data-testid="protected">Protected</div>} />
          </Route>
          <Route path="/login" element={<div data-testid="login">Login Page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("login")).toBeTruthy();
  });
});
