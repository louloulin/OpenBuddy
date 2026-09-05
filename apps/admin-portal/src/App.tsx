import { Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "./auth/AuthGuard";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { BillingPlans } from "./pages/BillingPlans";
import { CreditPricing } from "./pages/CreditPricing";
import { CreditReconciliation } from "./pages/CreditReconciliation";
import { Wallets } from "./pages/Wallets";
import { TenantPolicy } from "./pages/TenantPolicy";
import { AuditLog } from "./pages/AuditLog";
import { Callback } from "./auth/Callback";
import { Login } from "./auth/Login";

/**
 * OpenBuddy Admin Portal · 顶层路由
 *
 * 路由表：
 *   /login                   未登录用户看到
 *   /callback                Casdoor OIDC 回调
 *   /                        Dashboard 总览
 *   /billing/plans           计费套餐（管理员）
 *   /billing/pricing         积分定价
 *   /reconciliation          成本对账
 *   /wallets                 共享钱包
 *   /policy                  租户策略
 *   /audit                   审计日志
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/callback" element={<Callback />} />
      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/billing/plans" element={<BillingPlans />} />
          <Route path="/billing/pricing" element={<CreditPricing />} />
          <Route path="/reconciliation" element={<CreditReconciliation />} />
          <Route path="/wallets" element={<Wallets />} />
          <Route path="/policy" element={<TenantPolicy />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
