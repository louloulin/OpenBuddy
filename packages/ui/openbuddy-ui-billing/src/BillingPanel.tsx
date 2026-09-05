/**
 * OpenBuddy 企业计费面板（套餐目录 + 订单 + 退款/过期）。
 *
 * 渲染层订阅 Gateway `/v1/tenants/:tenantId/billing/{plans,orders}` 端点，
 * 通过 `casdoor:billing-*` IPC 通道调用本地代理。所有操作在主进程侧进行
 * 权限校验（`tenant.billing.read/write` 和 `tenant.billing.catalog.write`），
 * 渲染层只负责展示与触发。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, RefreshCw, ShoppingCart, Undo2, XCircle } from "lucide-react";
import {
  casdoorListBillingPlans,
  casdoorGetBillingSubscription,
  casdoorListBillingOrders,
  casdoorCreateBillingOrder,
  casdoorRefundBillingOrder,
  casdoorExpireBillingOrder,
  casdoorStatus,
  casdoorTenantHealth,
  casdoorGetSelectedCreditWalletId,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorBillingOrder, CasdoorBillingOrderStatus, CasdoorBillingPlan, CasdoorBillingSubscription } from "@openbuddy/auth-casdoor";
import type { CasdoorTenantHealth } from "@openbuddy/auth-casdoor";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

const STATUS_LABEL: Record<CasdoorBillingOrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  failed: "失败",
  refunded: "已退款",
  expired: "已过期",
  cancelled: "已取消",
};

function formatPrice(plan: CasdoorBillingPlan): string {
  const amount = plan.priceMinor / 100;
  return `${plan.currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function orderTotalAmount(order: CasdoorBillingOrder): string {
  return `${order.currency} ${(order.amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) {
    return error.message.replace(/^Error:\s*/, "");
  }
  return String(error).replace(/^Error:\s*/, "");
}

export function BillingPanel() {
  const [plans, setPlans] = useState<CasdoorBillingPlan[]>([]);
  const [orders, setOrders] = useState<CasdoorBillingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [busyOrderNo, setBusyOrderNo] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"refund" | "expire" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [tenantHealth, setTenantHealth] = useState<CasdoorTenantHealth | null>(null);
  const [subscription, setSubscription] = useState<CasdoorBillingSubscription | null>(null);
  const [selectedWalletId, setSelectedWalletId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const session = await casdoorStatus().catch(() => null);
      const activeTenantId = session?.tenantContext.activeTenantId;
      setTenantId(activeTenantId ?? null);
      setSubject(session?.identity?.subject ?? null);
      if (!activeTenantId) {
        setPlans([]);
        setOrders([]);
        setSubscription(null);
        return;
      }
      const [list, listOrders, currentSubscription, health, walletId] = await Promise.all([
        casdoorListBillingPlans().catch((error) => {
          setMessage({ kind: "warn", text: `加载套餐失败：${describeError(error)}` });
          return [] as CasdoorBillingPlan[];
        }),
        casdoorListBillingOrders(50).catch((error) => {
          setMessage({ kind: "warn", text: `加载订单失败：${describeError(error)}` });
          return [] as CasdoorBillingOrder[];
        }),
        casdoorGetBillingSubscription().catch(() => null),
        casdoorTenantHealth().catch(() => null),
        casdoorGetSelectedCreditWalletId().catch(() => undefined),
      ]);
      setPlans(list.filter((plan) => plan.active));
      setOrders(listOrders);
      setSubscription(currentSubscription);
      setTenantHealth((health && "tenantId" in health) ? health : null);
      setSelectedWalletId(walletId);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const orderById = useMemo(() => {
    const map = new Map<string, CasdoorBillingOrder>();
    for (const order of orders) map.set(order.orderNo, order);
    return map;
  }, [orders]);

  const handleCreate = useCallback(async (planId: string) => {
    setBusyPlanId(planId);
    try {
      const order = await casdoorCreateBillingOrder({
        planId,
        ...(selectedWalletId ? { walletId: selectedWalletId } : {}),
        idempotencyKey: `web:${planId}:${Date.now().toString(36)}`,
        expiresInSeconds: 1800,
      });
      await reload();
      setMessage({ kind: "ok", text: `订单 ${order.orderNo} 已创建（${STATUS_LABEL[order.status]}）` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setBusyPlanId(null);
    }
  }, [reload, selectedWalletId]);

  const handleOrderAction = useCallback(async (orderNo: string, action: "refund" | "expire") => {
    setBusyOrderNo(orderNo);
    setBusyAction(action);
    try {
      const updated = action === "refund"
        ? await casdoorRefundBillingOrder(orderNo)
        : await casdoorExpireBillingOrder(orderNo);
      await reload();
      setMessage({
        kind: "ok",
        text: `订单 ${updated.orderNo} → ${STATUS_LABEL[updated.status]}（${orderTotalAmount(updated)}）`,
      });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setBusyOrderNo(null);
      setBusyAction(null);
    }
  }, [reload]);

  return (
    <SectionShell
      title="企业计费"
      desc="浏览套餐目录、为当前租户下单、跟踪订单状态。商业结算与 Gateway 账本保持强一致；退款/过期会在积分账本中产生对冲流水。"
    >
      {!tenantId ? (
        <p className="settings-hint">请先登录企业账户并选择租户，再查看套餐目录。</p>
      ) : (
        <p className="settings-hint">当前租户：<strong>{tenantId}</strong>{subject ? ` · 主体：${subject}` : ""} · 充值目标：<strong data-testid="casdoor-billing-target">{selectedWalletId ? `共享钱包 ${selectedWalletId}` : "个人积分账户"}</strong></p>
      )}

      {tenantHealth && (tenantHealth.policy.maxTokensPerDay !== undefined || tenantHealth.policy.maxPointsPerDay !== undefined) && (
        <div className="account-section" data-testid="casdoor-billing-quota">
          <div className="account-section__header">
            <h3 className="account-section__title">租户配额</h3>
            <span className="settings-hint">
              状态：<strong>{tenantHealth.policy.status}</strong>
              {tenantHealth.policy.killSwitch ? <span className="settings-msg--err"> · 已熔断</span> : null}
            </span>
          </div>
          {tenantHealth.policy.maxTokensPerDay !== undefined && (
            <p className="settings-hint">
              今日 token：<strong>{tenantHealth.policy.tokensUsedToday.toLocaleString()}</strong> / {tenantHealth.policy.maxTokensPerDay.toLocaleString()}
              {(() => {
                const ratio = tenantHealth.policy.maxTokensPerDay > 0
                  ? tenantHealth.policy.tokensUsedToday / tenantHealth.policy.maxTokensPerDay
                  : 0;
                const tone = ratio >= 1 ? "settings-msg--err" : ratio >= 0.8 ? "settings-msg--warn" : "";
                return <span className={tone}> · 已用 {(ratio * 100).toFixed(1)}%</span>;
              })()}
            </p>
          )}
          {tenantHealth.policy.maxPointsPerDay !== undefined && (
            <p className="settings-hint">
              今日积分：<strong>{tenantHealth.policy.pointsUsedToday.toLocaleString()}</strong> / {tenantHealth.policy.maxPointsPerDay.toLocaleString()}
              {tenantHealth.policy.pointsReservedToday ? ` · 预留 ${tenantHealth.policy.pointsReservedToday.toLocaleString()}` : ""}
            </p>
          )}
          <p className="settings-hint">
            资源数：{Object.entries(tenantHealth.resources).map(([kind, count]) => `${kind}=${count}`).join(" · ") || "无"}
            {" · 活跃会话 "}{tenantHealth.activeSessions}{" · 撤销成员 "}{tenantHealth.revokedMembers}
          </p>
        </div>
      )}

      {subscription && subscription.status === "active" && (
        <div className="account-section" data-testid="casdoor-billing-subscription">
          <div className="account-section__header">
            <h3 className="account-section__title">当前生效订阅</h3>
            <span className="settings-hint">{subscription.planId} · {subscription.orderNo}</span>
          </div>
            <p className="settings-hint">生效时间：{new Date(subscription.startedAt).toLocaleString()}</p>
            {subscription.entitlementsExpiresAt && <p className="settings-hint">权益到期：{new Date(subscription.entitlementsExpiresAt).toLocaleString()}</p>}
          <p className="settings-hint">
            权益快照：{subscription.entitlements.maxTokensPerDay !== undefined ? `每日 ${subscription.entitlements.maxTokensPerDay.toLocaleString()} tokens` : "不限 token"}
            {subscription.entitlements.maxPointsPerDay !== undefined ? ` · 每日 ${subscription.entitlements.maxPointsPerDay.toLocaleString()} 积分` : " · 不限积分"}
            {subscription.entitlements.newApiGroup ? ` · Group ${subscription.entitlements.newApiGroup}` : ""}
          </p>
        </div>
      )}

      <div className="account-section" data-testid="casdoor-billing-plans">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <CreditCard size={16} /> 套餐目录
          </h3>
          <button className="settings-btn" onClick={reload} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
        {loading && plans.length === 0 ? (
          <p className="settings-hint">正在加载套餐…</p>
        ) : plans.length === 0 ? (
          <p className="settings-hint">暂无激活套餐。请联系管理员配置 <code>tenant.billing.catalog.write</code> 权限。</p>
        ) : (
          <ul className="shortcuts-list" data-testid="casdoor-billing-plans-list">
            {plans.map((plan) => (
              <li key={plan.id} className="shortcuts-list__row">
                <div className="shortcuts-list__row-meta">
                  <span className="shortcuts-list__action">{plan.name} · {formatPrice(plan)}</span>
                  <span className="shortcuts-list__key">{plan.points.toLocaleString()} 积分{plan.pointsValidDays ? ` · 积分 ${plan.pointsValidDays} 天` : " · 积分永久有效"}{plan.entitlementsValidDays ? ` · 权益 ${plan.entitlementsValidDays} 天` : " · 权益永久有效"}{plan.description ? ` · ${plan.description}` : ""}</span>
                  {plan.features.length > 0 && (
                    <span className="shortcuts-list__key">特性：{plan.features.join("、")}</span>
                  )}
                </div>
                <button
                  className="settings-btn"
                  data-testid={`casdoor-billing-buy-${plan.id}`}
                  onClick={() => handleCreate(plan.id)}
                  disabled={busyPlanId === plan.id || !tenantId}
                >
                  <ShoppingCart size={14} /> 下单
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="account-section" data-testid="casdoor-billing-orders">
        <div className="account-section__header">
          <h3 className="account-section__title">最近订单</h3>
          <span className="settings-hint">共 {orders.length} 条</span>
        </div>
        {orders.length === 0 ? (
          <p className="settings-hint">暂无订单。下单后会在此处显示，并可发起退款或过期。</p>
        ) : (
          <ul className="shortcuts-list" data-testid="casdoor-billing-orders-list">
            {orders.map((order) => {
              const plan = plans.find((entry) => entry.id === order.planId);
              return (
                <li key={order.orderNo} className="shortcuts-list__row">
                  <div className="shortcuts-list__row-meta">
                    <span className="shortcuts-list__action">
                      {plan?.name ?? order.planId} · {orderTotalAmount(order)}
                    </span>
                    <span className="shortcuts-list__key">
                      订单号：{order.orderNo} · {STATUS_LABEL[order.status]} · {order.points.toLocaleString()} 积分
                    </span>
                    <span className="shortcuts-list__key">充值账户：{order.walletId ? `共享钱包 ${order.walletId}` : "个人积分账户"}</span>
                    {order.pointsValidDays && <span className="shortcuts-list__key">积分有效期：{order.pointsValidDays} 天{order.pointsExpiresAt ? ` · 到期 ${new Date(order.pointsExpiresAt).toLocaleString()}` : "（支付后计算）"}</span>}
                    {order.entitlementsValidDays && <span className="shortcuts-list__key">权益有效期：{order.entitlementsValidDays} 天{order.entitlementsExpiresAt ? ` · 到期 ${new Date(order.entitlementsExpiresAt).toLocaleString()}` : "（支付后计算）"}</span>}
                    <span className="shortcuts-list__key">
                      创建 {new Date(order.createdAt).toLocaleString()} · 过期 {new Date(order.expiresAt).toLocaleString()}
                    </span>
                    {order.paidAt && <span className="shortcuts-list__key">支付 {new Date(order.paidAt).toLocaleString()}</span>}
                    {order.paymentId && <span className="shortcuts-list__key">渠道：{order.paymentChannel ?? "—"} · 流水：{order.paymentId}</span>}
                    {order.failureReason && <span className="shortcuts-list__key">失败原因：{order.failureReason}</span>}
                  </div>
                  <div className="shortcuts-list__row-actions">
                    <button
                      className="settings-btn"
                      data-testid={`casdoor-billing-refund-${order.orderNo}`}
                      onClick={() => handleOrderAction(order.orderNo, "refund")}
                      disabled={order.status !== "paid" || busyOrderNo === order.orderNo}
                    >
                      <Undo2 size={14} /> 退款
                    </button>
                    <button
                      className="settings-btn settings-btn--ghost"
                      data-testid={`casdoor-billing-expire-${order.orderNo}`}
                      onClick={() => handleOrderAction(order.orderNo, "expire")}
                      disabled={order.status !== "pending" || busyOrderNo === order.orderNo}
                    >
                      <XCircle size={14} /> 标记过期
                    </button>
                    {busyOrderNo === order.orderNo && busyAction && <span className="settings-hint">处理中…</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {orderById.size === 0 && null}
      </div>

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="casdoor-billing-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default BillingPanel;
