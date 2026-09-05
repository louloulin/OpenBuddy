import { Navigate, Outlet } from "react-router-dom";
import { loadTokens } from "./oidc-client";

/**
 * 全局路由守卫：未登录跳转到 /login，token 过期也跳。
 */
export function AuthGuard() {
  const tokens = loadTokens();
  if (!tokens) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
