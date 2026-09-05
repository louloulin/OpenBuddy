import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Coins,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Settings,
  Shield,
  Wallet,
} from "lucide-react";
import { gatewayClient } from "../api/gateway-client";
import { clearTokens, loadUser } from "../auth/oidc-client";

const TENANT_STORAGE_KEY = "openbuddy.tenant.selected";

/**
 * 主布局：左侧导航 + 顶部状态条 + 内容区
 */
export function Layout() {
  const navigate = useNavigate();
  const user = loadUser();
  const [tenantId, setTenantId] = useState<string>(() => localStorage.getItem(TENANT_STORAGE_KEY) || "");
  const [tenants, setTenants] = useState<string[]>([]);
  const [health, setHealth] = useState<{ ok: boolean; version: string } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    const orgs = user?.organizations ?? [];
    setTenants(orgs);
    if (!tenantId && orgs.length > 0) {
      setTenantId(orgs[0]!);
      localStorage.setItem(TENANT_STORAGE_KEY, orgs[0]!);
    }
  }, [tenantId, user]);

  useEffect(() => {
    if (!tenantId) return;
    setHealthLoading(true);
    gatewayClient
      .health()
      .then((h) => setHealth({ ok: h.ok, version: h.version }))
      .catch(() => setHealth({ ok: false, version: "unknown" }))
      .finally(() => setHealthLoading(false));
  }, [tenantId]);

  const switchTenant = (tid: string) => {
    setTenantId(tid);
    localStorage.setItem(TENANT_STORAGE_KEY, tid);
  };

  const logout = () => {
    clearTokens();
    navigate("/login");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "100vh" }}>
      <aside style={{ background: "var(--wb-bg-secondary)", padding: 24, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
          <Shield size={24} color="var(--wb-text-brand)" />
          <strong style={{ fontSize: 16 }}>OpenBuddy</strong>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <NavItem to="/" icon={<LayoutDashboard size={16} />} label="Dashboard" end />
          <NavItem to="/billing/plans" icon={<CreditCard size={16} />} label="计费套餐" />
          <NavItem to="/billing/pricing" icon={<Coins size={16} />} label="积分定价" />
          <NavItem to="/reconciliation" icon={<BarChart3 size={16} />} label="成本对账" />
          <NavItem to="/wallets" icon={<Wallet size={16} />} label="共享钱包" />
          <NavItem to="/policy" icon={<Settings size={16} />} label="租户策略" />
          <NavItem to="/audit" icon={<FileText size={16} />} label="审计日志" />
        </nav>
        <div style={{ borderTop: "1px solid var(--wb-border-default)", paddingTop: 16, marginTop: 16 }}>
          <div style={{ color: "var(--wb-text-tertiary)", fontSize: 12, marginBottom: 4 }}>已登录用户</div>
          <div style={{ fontWeight: 600 }}>{user?.displayName ?? user?.preferred_username ?? user?.sub ?? "—"}</div>
          {user?.email && <div style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>{user.email}</div>}
          <button className="btn btn-secondary" onClick={logout} style={{ width: "100%", marginTop: 12, justifyContent: "center" }}>
            <LogOut size={14} /> 登出
          </button>
        </div>
      </aside>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <header
          style={{
            background: "var(--wb-bg-secondary)",
            padding: "16px 24px",
            borderBottom: "1px solid var(--wb-border-default)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ color: "var(--wb-text-tertiary)" }}>租户：</span>
            <select className="input" value={tenantId} onChange={(e) => switchTenant(e.target.value)}>
              {tenants.length === 0 ? (
                <option value="">无可用租户</option>
              ) : (
                tenants.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))
              )}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--wb-text-tertiary)", fontSize: 12 }}>Gateway:</span>
            {healthLoading ? (
              <span style={{ color: "var(--wb-text-tertiary)" }}>检测中…</span>
            ) : health?.ok ? (
              <span className="tag tag-ok">健康 · {health.version}</span>
            ) : (
              <span className="tag tag-err">不可达</span>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => window.location.reload()}
              style={{ padding: "4px 10px" }}
              aria-label="刷新"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </header>
        <main style={{ padding: 24, flex: 1, overflow: "auto" }}>
          <Outlet context={{ tenantId }} />
        </main>
      </div>
    </div>
  );
}

function NavItem({ to, icon, label, end }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--wb-radius-md)",
        color: isActive ? "var(--wb-text-primary)" : "var(--wb-text-secondary)",
        background: isActive ? "var(--wb-bg-tertiary)" : "transparent",
        fontWeight: isActive ? 600 : 400,
        textDecoration: "none",
      })}
    >
      {icon}
      {label}
    </NavLink>
  );
}
