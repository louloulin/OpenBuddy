/**
 * OpenBuddy Gateway 健康面板。
 *
 * 拉取 Casdoor Resource Gateway 的全局健康（store / latency / version）以及
 * 当前租户的运维指标（policy status / kill switch / 模型白名单长度 / 当日
 * token / 资源分布 / 撤销成员数 / 活跃会话数 / SIEM 投递状态）。在
 * Gateway 未配置时显示 `configured: false` 友好提示；否则按租户维
 * 度展示完整运行时视图。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, AlertTriangle } from "lucide-react";
import {
  casdoorGatewayHealth,
  casdoorTenantHealth,
  casdoorStatus,
} from "@/lib/casdoor/casdoor-client";
import type {
  CasdoorGatewayHealth,
  CasdoorTenantHealth,
} from "@openbuddy/auth-casdoor";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

function describeError(error: unknown): string {
  if (!error) return "加载失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

function StatusBadge({ ok, testIdPrefix }: { ok: boolean; testIdPrefix: string }) {
  return (
    <span
      className={`account-badge ${ok ? "account-badge--ok" : "account-badge--err"}`}
      data-testid={`${testIdPrefix}-${ok ? "ok" : "down"}`}
    >
      {ok ? "ok" : "down"}
    </span>
  );
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function GatewayHealthPanel() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [gateway, setGateway] = useState<CasdoorGatewayHealth | null>(null);
  const [tenant, setTenant] = useState<CasdoorTenantHealth | null>(null);
  const [gatewayConfigured, setGatewayConfigured] = useState<boolean>(true);
  const [tenantConfigured, setTenantConfigured] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const session = await casdoorStatus().catch(() => null);
      setTenantId(session?.tenantContext.activeTenantId ?? null);

      const gwRaw = await casdoorGatewayHealth().catch((error) => {
        setMessage({ kind: "warn", text: `加载 Gateway 健康失败：${describeError(error)}` });
        return null;
      });
      if (gwRaw && "configured" in gwRaw && gwRaw.configured === false) {
        setGateway(null);
        setGatewayConfigured(false);
      } else if (gwRaw) {
        setGateway(gwRaw as CasdoorGatewayHealth);
        setGatewayConfigured(true);
      } else {
        setGateway(null);
        setGatewayConfigured(true);
      }

      if (session?.tenantContext.activeTenantId) {
        const tnRaw = await casdoorTenantHealth().catch((error) => {
          setMessage({ kind: "warn", text: `加载租户健康失败：${describeError(error)}` });
          return null;
        });
        if (tnRaw && "configured" in tnRaw && tnRaw.configured === false) {
          setTenant(null);
          setTenantConfigured(false);
        } else if (tnRaw) {
          setTenant(tnRaw as CasdoorTenantHealth);
          setTenantConfigured(true);
        } else {
          setTenant(null);
          setTenantConfigured(true);
        }
      } else {
        setTenant(null);
        setTenantConfigured(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const tokenUsage = useMemo(() => {
    if (!tenant) return null;
    const used = tenant.policy.tokensUsedToday;
    const limit = tenant.policy.maxTokensPerDay;
    if (typeof limit !== "number" || limit <= 0) return { used, limit: null as number | null };
    return { used, limit, ratio: Math.min(1, used / limit) };
  }, [tenant]);

  const budgetLabel = (budget: NonNullable<CasdoorTenantHealth["budgets"]>["tokens"] | undefined, unit: string) => {
    if (!budget || budget.status === "unlimited") return `${unit}不限额`;
    const utilization = typeof budget.utilizationPercent === "number" ? `（${budget.utilizationPercent}%）` : "";
    return `${budget.committed} / ${budget.limit} ${unit}${utilization}`;
  };

  return (
    <SectionShell
      title="网关与租户健康"
      desc="查看 Casdoor Resource Gateway 的全局运行状态，以及当前租户的策略、资源分布、撤销成员、活跃会话和 SIEM 投递配置。"
    >
      {!tenantId ? (
        <p className="settings-hint">请先登录并选择租户，再查看网关健康。</p>
      ) : (
        <p className="settings-hint">当前租户：<strong>{tenantId}</strong></p>
      )}

      <div className="settings-actions">
        <button className="settings-btn" onClick={reload} disabled={loading}>
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {!gatewayConfigured ? (
        <div className="account-section" data-testid="gateway-health-gateway-section">
          <div className="account-section__header">
            <h3 className="account-section__title">
              <Activity size={16} /> Gateway 健康
            </h3>
          </div>
          <p className="settings-hint" data-testid="gateway-health-gateway-unconfigured">
            <AlertTriangle size={12} /> Gateway 尚未配置：请先在 @openbuddy/auth-casdoor (resource-backend) 的 baseUrl 中填入 Resource Gateway 实例地址。
          </p>
        </div>
      ) : gateway ? (
        <div className="account-section" data-testid="gateway-health-gateway-section">
          <div className="account-section__header">
            <h3 className="account-section__title">
              <Activity size={16} /> Gateway 健康
            </h3>
            <StatusBadge ok={gateway.ok} testIdPrefix="gateway-health-badge" />
          </div>
          <ul className="shortcuts-list">
            <li className="shortcuts-list__row" data-testid="gateway-health-row-store">
              <span className="shortcuts-list__action">存储后端</span>
              <span className="shortcuts-list__key">{gateway.store}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="gateway-health-row-version">
              <span className="shortcuts-list__action">版本</span>
              <span className="shortcuts-list__key">{gateway.version}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="gateway-health-row-latency">
              <span className="shortcuts-list__action">延迟</span>
              <span className="shortcuts-list__key">{gateway.latencyMs} ms</span>
            </li>
            {gateway.error && (
              <li className="shortcuts-list__row" data-testid="gateway-health-row-error">
                <span className="shortcuts-list__action">错误</span>
                <span className="shortcuts-list__key">{gateway.error}</span>
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="settings-hint" data-testid="gateway-health-gateway-empty">暂无 Gateway 健康数据。</p>
      )}

      {!tenantConfigured ? (
        <div className="account-section" data-testid="gateway-health-tenant-section">
          <div className="account-section__header">
            <h3 className="account-section__title">
              <Activity size={16} /> 租户健康
            </h3>
          </div>
          <p className="settings-hint" data-testid="gateway-health-tenant-unconfigured">
            <AlertTriangle size={12} /> 当前未选择租户，无法拉取租户维度健康。
          </p>
        </div>
      ) : tenant ? (
        <div className="account-section" data-testid="gateway-health-tenant-section">
          <div className="account-section__header">
            <h3 className="account-section__title">
              <Activity size={16} /> 租户健康 · {tenant.tenantId}
            </h3>
            <StatusBadge ok={tenant.ok} testIdPrefix="gateway-health-tenant-badge" />
          </div>
          <ul className="shortcuts-list">
            <li className="shortcuts-list__row" data-testid="gateway-health-tenant-policy-status">
              <span className="shortcuts-list__action">策略状态</span>
              <span className="shortcuts-list__key">
                {tenant.policy.status}
                {tenant.policy.killSwitch ? " · KILL SWITCH ON" : ""}
              </span>
            </li>
            <li className="shortcuts-list__row" data-testid="gateway-health-tenant-quota">
              <span className="shortcuts-list__action">每日 token 配额</span>
              <span className="shortcuts-list__key">
                {tokenUsage?.limit
                  ? `${tenant.policy.tokensUsedToday} / ${tokenUsage.limit}（${Math.round((tokenUsage.ratio ?? 0) * 100)}%）`
                  : `${tenant.policy.tokensUsedToday} / 无上限`}
              </span>
            </li>
            {tenant.policy.maxPointsPerDay !== undefined && (
              <li className="shortcuts-list__row" data-testid="gateway-health-tenant-points-quota">
                <span className="shortcuts-list__action">每日积分预算</span>
                <span className="shortcuts-list__key">
                  {tenant.policy.pointsUsedToday} / {tenant.policy.maxPointsPerDay}
                  {tenant.policy.pointsReservedToday ? ` · 预留 ${tenant.policy.pointsReservedToday}` : ""}
                </span>
              </li>
            )}
            {tenant.budgets && <>
              <li className="shortcuts-list__row" data-testid="gateway-health-tenant-token-budget">
                <span className="shortcuts-list__action">Token 预算风险</span>
                <span className="shortcuts-list__key">{budgetLabel(tenant.budgets.tokens, "tokens")} · {tenant.budgets.tokens.status}</span>
              </li>
              <li className="shortcuts-list__row" data-testid="gateway-health-tenant-points-budget">
                <span className="shortcuts-list__action">积分预算风险</span>
                <span className="shortcuts-list__key">{budgetLabel(tenant.budgets.points, "积分")} · {tenant.budgets.points.status}</span>
              </li>
            </>}
            <li className="shortcuts-list__row" data-testid="gateway-health-tenant-allowlists">
              <span className="shortcuts-list__action">白名单</span>
              <span className="shortcuts-list__key">
                模型 {tenant.policy.modelAllowlist} · MCP {tenant.policy.mcpAllowlist}
              </span>
            </li>
            <li className="shortcuts-list__row" data-testid="gateway-health-tenant-resources">
              <span className="shortcuts-list__action">资源分布</span>
              <span className="shortcuts-list__key">
                {Object.keys(tenant.resources).length === 0
                  ? "—"
                  : Object.entries(tenant.resources)
                      .map(([type, count]) => `${type}=${count}`)
                      .join(" · ")}
              </span>
            </li>
            <li className="shortcuts-list__row" data-testid="gateway-health-tenant-revoked-members">
              <span className="shortcuts-list__action">已撤销成员</span>
              <span className="shortcuts-list__key">{tenant.revokedMembers}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="gateway-health-tenant-active-sessions">
              <span className="shortcuts-list__action">活跃会话</span>
              <span className="shortcuts-list__key">{tenant.activeSessions}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="gateway-health-tenant-siem">
              <span className="shortcuts-list__action">SIEM 投递</span>
              <span className="shortcuts-list__key">
                {tenant.siem
                  ? `${tenant.siem.kind}${tenant.siem.endpoint ? ` · ${tenant.siem.endpoint}` : ""}${tenant.siem.filePath ? ` · ${tenant.siem.filePath}` : ""}`
                  : "未配置"}
              </span>
            </li>
            <li className="shortcuts-list__row" data-testid="gateway-health-tenant-at">
              <span className="shortcuts-list__action">采样时间</span>
              <span className="shortcuts-list__key">{formatTimestamp(tenant.at)}</span>
            </li>
          </ul>
        </div>
      ) : (
        <p className="settings-hint" data-testid="gateway-health-tenant-empty">暂无租户健康数据。</p>
      )}

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="gateway-health-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default GatewayHealthPanel;
