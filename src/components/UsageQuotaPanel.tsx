/**
 * 用量配额面板 —— weixinpay 计费替代的 UI。
 *
 * 展示日/月 token 用量统计 + 按模型分组 + 配额进度条 + 配额设置。
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
} from "@/lib/usage-quota";

export function UsageQuotaPanel() {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [config, setConfig] = useState<QuotaConfig | null>(null);
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");

  useEffect(() => {
    setRecords(loadUsage());
    setConfig(loadQuotaConfig());
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
        <span className="quota-panel__title">用量统计</span>
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

      <p className="quota-panel__hint">阈值仅作本地用量提醒，不会阻止发送。费用为估算，实际以提供商账单为准。</p>

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
            <span className="quota-panel__stat-label">估算费用</span>
          </div>
        )}
      </div>

      {/* 配额进度条 */}
      {quota && (
        <div className="quota-panel__quota">
          <div className="quota-panel__quota-head">
            <span>提醒进度</span>
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
          {quota.exceeded && <span className="quota-panel__quota-warn">已达到提醒阈值，仍可发送</span>}
          {quota.nearLimit && <span className="quota-panel__quota-warn">接近提醒阈值</span>}
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
        <div className="quota-panel__config-title">提醒设置</div>
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
          <span>Token 提醒阈值</span>
          <input
            type="number"
            value={config?.tokenLimit ?? ""}
            placeholder="不提醒"
            onChange={(e) => saveConfig({ ...(config ?? { period: "daily" }), tokenLimit: parseInt(e.target.value, 10) || 0 })}
          />
        </label>
      </div>
    </div>
  );
}
