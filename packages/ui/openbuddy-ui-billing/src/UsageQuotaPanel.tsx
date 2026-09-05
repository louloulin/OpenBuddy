/**
 * 本地用量观察面板。
 *
 * 展示日/月 token 用量统计、按模型分组和本地提醒配置。
 * 企业积分、余额、订单和正式配额以 Resource Gateway 服务端账本为准；
 * 本面板的数据只保存在当前桌面用户的 localStorage，不能用于财务结算。
 */
import { useEffect, useState } from "react";
import {
  loadUsage,
  summarizeUsage,
  checkQuota,
  loadQuotaConfig,
  saveQuotaConfig,
  todayKey,
  monthKey,
  type UsageRecord,
  type QuotaConfig,
} from "@/lib/billing/usage-quota";
import { casdoorGetCredits, casdoorGetSelectedCreditWalletCredits, casdoorGetSelectedCreditWalletId, casdoorStatus } from "@/lib/casdoor/casdoor-client";
import type { CasdoorCreditAccount } from "@openbuddy/auth-casdoor";

export function UsageQuotaPanel() {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [config, setConfig] = useState<QuotaConfig | null>(null);
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const [account, setAccount] = useState<CasdoorCreditAccount | null>(null);
  const [accountScope, setAccountScope] = useState<string | null>(null);

  useEffect(() => {
    setRecords(loadUsage());
    setConfig(loadQuotaConfig());
    let disposed = false;
    void (async () => {
      try {
        const status = await casdoorStatus();
        if (status.status !== "signed_in" || !status.tenantContext.activeTenantId) return;
        const walletId = await casdoorGetSelectedCreditWalletId();
        const next = walletId ? await casdoorGetSelectedCreditWalletCredits() : await casdoorGetCredits();
        if (!disposed) {
          setAccount(next);
          setAccountScope(walletId ? `共享钱包 ${walletId}` : "个人积分账户");
        }
      } catch {
        // 本地观察面板在 Gateway 不可用时仍可正常显示。
      }
    })();
    return () => { disposed = true; };
  }, []);

  const key = period === "daily" ? todayKey() : monthKey();
  const filtered = records.filter((r) =>
    period === "daily" ? r.date === key : r.date.startsWith(key),
  );
  const summary = summarizeUsage(filtered);
  const quota = config
    ? checkQuota(records, { ...config, period })
    : null;

  const saveConfig = (next: QuotaConfig) => {
    saveQuotaConfig(next);
    setConfig(next);
  };

  return (
    <div className="quota-panel" role="region" aria-label="用量与配额">
      {/* 周期切换 */}
      <div className="quota-panel__head">
        <span className="quota-panel__title">本地用量观察</span>
        <div className="quota-panel__period">
          {(["daily", "monthly"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={"quota-panel__period-btn" + (period === p ? " active" : "")}
              onClick={() => setPeriod(p)}
            >
              {p === "daily" ? "今日" : "本月"}
            </button>
          ))}
        </div>
      </div>

      {/* 汇总数字 */}
      <div className="quota-panel__stats">
        <div className="quota-panel__stat">
          <span className="quota-panel__stat-value">{summary.totalTokens.toLocaleString()}</span>
          <span className="quota-panel__stat-label">总 Token</span>
        </div>
        <div className="quota-panel__stat">
          <span className="quota-panel__stat-value">{summary.count}</span>
          <span className="quota-panel__stat-label">调用次数</span>
        </div>
        {summary.totalCost > 0 && (
          <div className="quota-panel__stat">
            <span className="quota-panel__stat-value">${summary.totalCost.toFixed(4)}</span>
          <span className="quota-panel__stat-label">本地估算（非账单）</span>
          </div>
        )}
      </div>

      {account && (
        <div className="quota-panel__quota" data-testid="usage-quota-server-account">
          <div className="quota-panel__quota-head">
            <span>服务端积分账户 · {accountScope}</span>
            <span>{account.available.toLocaleString()} 可用</span>
          </div>
          <div className="quota-panel__models-title">
            余额 {account.balance.toLocaleString()} · 预留 {account.reserved.toLocaleString()} · 累计消耗 {account.lifetimeConsumed.toLocaleString()}
          </div>
        </div>
      )}

      {/* 配额进度条 */}
      {quota && (
        <div className="quota-panel__quota">
          <div className="quota-panel__quota-head">
            <span>配额</span>
            <span className={"quota-panel__quota-pct" + (quota.exceeded ? " exceeded" : quota.nearLimit ? " near" : "")}>
              {quota.used.toLocaleString()} / {quota.limit.toLocaleString()} ({quota.pct}%)
            </span>
          </div>
          <div className="quota-panel__quota-bar">
            <div
              className={"quota-panel__quota-fill" + (quota.exceeded ? " exceeded" : quota.nearLimit ? " near" : "")}
              style={{ width: `${Math.min(100, quota.pct)}%` }}
            />
          </div>
          {quota.exceeded && <span className="quota-panel__quota-warn">⚠ 已超限</span>}
          {quota.nearLimit && <span className="quota-panel__quota-warn">⚠ 接近上限</span>}
        </div>
      )}

      {/* 按模型分组 */}
      {Object.keys(summary.byModel).length > 0 && (
        <div className="quota-panel__models">
          <div className="quota-panel__models-title">按模型</div>
          {Object.entries(summary.byModel).map(([model, s]) => (
            <div key={model} className="quota-panel__model-row">
              <span className="quota-panel__model-name">{model}</span>
              <span className="quota-panel__model-tokens">{s.tokens.toLocaleString()} token</span>
              <span className="quota-panel__model-count">{s.count} 次</span>
              {s.cost > 0 && <span className="quota-panel__model-cost">${s.cost.toFixed(4)}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 配额设置 */}
      <div className="quota-panel__config">
        <div className="quota-panel__config-title">本地提醒设置</div>
        <label className="quota-panel__config-row">
          <span>周期</span>
          <select
            value={config?.period ?? "daily"}
            onChange={(e) => saveConfig({ ...(config ?? { tokenLimit: 100000, period: "daily" }), period: e.target.value as "daily" | "monthly" })}
          >
            <option value="daily">每日</option>
            <option value="monthly">每月</option>
          </select>
        </label>
        <label className="quota-panel__config-row">
          <span>Token 上限</span>
          <input
            type="number"
            value={config?.tokenLimit ?? ""}
            placeholder="不限"
            onChange={(e) => saveConfig({ ...(config ?? { period: "daily" }), tokenLimit: parseInt(e.target.value, 10) || 0 })}
          />
        </label>
      </div>
      <p className="settings-hint">企业积分余额、真实 usage、订单和对账请查看“扣费账户 / 企业计费 / 成本对账”；服务端 Gateway 账本才是唯一计费事实源。</p>
    </div>
  );
}
