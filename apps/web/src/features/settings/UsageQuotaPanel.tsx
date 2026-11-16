/**
 * 用量配额面板 —— weixinpay 计费替代的 UI。
 *
 * 数据来自宿主 `usage_snapshot`（pii W5.6）：引擎在每个回合结束后把该会话的累计 token / 费用
 * 记进 usage.json，面板按日 / 模型 / 专家聚合。这里的阈值只做本地提醒，不阻止发送；
 * 费用为按模型定价估算，实际以提供商账单为准。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCwIcon } from "@openbuddy/ui/icon/icons/index";
import { usageSnapshot } from "@openbuddy/client/agent-client";
import type { UsageSnapshot } from "@openbuddy/protocol/usage";
import { loadQuotaConfig, saveQuotaConfig, todayKey, monthKey, type QuotaConfig } from "@/features/settings/usage-quota";

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function UsageQuotaPanel() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<QuotaConfig | null>(null);
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setSnapshot(await usageSnapshot()); }
    catch (e) { setError(String(e).replace(/^Error:\s*/, "")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { setConfig(loadQuotaConfig()); void reload(); }, [reload]);

  const key = period === "daily" ? todayKey() : monthKey();
  const scoped = useMemo(() => {
    const sessions = (snapshot?.sessions ?? []).filter((entry) => (period === "daily" ? entry.at.slice(0, 10) === key : entry.at.slice(0, 7) === key));
    const tokens = sessions.reduce((sum, entry) => sum + entry.tokens.total, 0);
    const cost = sessions.reduce((sum, entry) => sum + entry.cost, 0);
    const byModel = new Map<string, { tokens: number; cost: number; sessions: number }>();
    for (const entry of sessions) {
      const name = entry.modelKey ?? "未知模型";
      const current = byModel.get(name) ?? { tokens: 0, cost: 0, sessions: 0 };
      byModel.set(name, { tokens: current.tokens + entry.tokens.total, cost: current.cost + entry.cost, sessions: current.sessions + 1 });
    }
    return { sessions, tokens, cost, byModel };
  }, [snapshot, period, key]);

  const limit = config?.tokenLimit ?? 0;
  const pct = limit > 0 ? Math.round((scoped.tokens / limit) * 100) : 0;
  const exceeded = limit > 0 && scoped.tokens >= limit;
  const near = limit > 0 && !exceeded && pct >= 80;

  const saveConfig = (next: QuotaConfig) => { saveQuotaConfig(next); setConfig(next); };

  return (
    <div className="quota-panel" role="region" aria-label="用量与配额">
      <div className="quota-panel__head">
        <span className="quota-panel__title">用量统计</span>
        <div className="quota-panel__period">
          {(["daily", "monthly"] as const).map((p) => (
            <button key={p} type="button" className={"quota-panel__period-btn" + (period === p ? " active" : "")} onClick={() => setPeriod(p)}>
              {p === "daily" ? "今日" : "本月"}
            </button>
          ))}
          <button type="button" className="quota-panel__period-btn" title="刷新" aria-label="刷新用量" disabled={loading} onClick={() => { void reload(); }}>
            <RefreshCwIcon size="sm" />
          </button>
        </div>
      </div>

      <p className="quota-panel__hint">数据来自本机各任务的真实用量（含缓存读取）。阈值只作提醒，不会阻止发送；费用按模型定价估算。</p>
      {error && <p className="res-panel__error" role="alert">{error}</p>}

      <div className="quota-panel__stats">
        <div className="quota-panel__stat">
          <span className="quota-panel__stat-value">{k(scoped.tokens)}</span>
          <span className="quota-panel__stat-label">Token</span>
        </div>
        <div className="quota-panel__stat">
          <span className="quota-panel__stat-value">{scoped.sessions.length}</span>
          <span className="quota-panel__stat-label">任务数</span>
        </div>
        <div className="quota-panel__stat">
          <span className="quota-panel__stat-value">${scoped.cost.toFixed(4)}</span>
          <span className="quota-panel__stat-label">估算费用</span>
        </div>
      </div>

      {limit > 0 && (
        <div className="quota-panel__quota">
          <div className="quota-panel__quota-head">
            <span>提醒进度</span>
            <span className={"quota-panel__quota-pct" + (exceeded ? " exceeded" : near ? " near" : "")}>
              {scoped.tokens.toLocaleString()} / {limit.toLocaleString()} ({pct}%)
            </span>
          </div>
          <div className="quota-panel__quota-bar">
            <div className={"quota-panel__quota-fill" + (exceeded ? " exceeded" : near ? " near" : "")} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          {exceeded && <span className="quota-panel__quota-warn">已达到提醒阈值，仍可发送</span>}
          {near && <span className="quota-panel__quota-warn">接近提醒阈值</span>}
        </div>
      )}

      {scoped.byModel.size > 0 && (
        <div className="quota-panel__models">
          <div className="quota-panel__models-title">按模型</div>
          {[...scoped.byModel.entries()].map(([model, value]) => (
            <div key={model} className="quota-panel__model-row">
              <span className="quota-panel__model-name">{model}</span>
              <span className="quota-panel__model-tokens">{k(value.tokens)} token</span>
              <span className="quota-panel__model-count">{value.sessions} 个任务</span>
              {value.cost > 0 && <span className="quota-panel__model-cost">${value.cost.toFixed(4)}</span>}
            </div>
          ))}
        </div>
      )}

      {snapshot && Object.keys(snapshot.byExpert).length > 0 && (
        <div className="quota-panel__models">
          <div className="quota-panel__models-title">按专家</div>
          {Object.entries(snapshot.byExpert).map(([expert, value]) => (
            <div key={expert} className="quota-panel__model-row">
              <span className="quota-panel__model-name">{expert}</span>
              <span className="quota-panel__model-tokens">{k(value.tokens)} token</span>
              <span className="quota-panel__model-count">{value.sessions} 个任务</span>
            </div>
          ))}
        </div>
      )}

      {snapshot && snapshot.sessions.length > 0 && (
        <div className="quota-panel__models">
          <div className="quota-panel__models-title">最近任务</div>
          {snapshot.sessions.slice(0, 6).map((entry) => (
            <div key={entry.sessionId} className="quota-panel__model-row">
              <span className="quota-panel__model-name" title={entry.cwd}>{entry.title || entry.cwd.split(/[\\/]/).pop() || "未命名任务"}</span>
              <span className="quota-panel__model-tokens">{k(entry.tokens.total)} token</span>
              <span className="quota-panel__model-count">{new Date(entry.at).toLocaleString()}</span>
              {entry.cost > 0 && <span className="quota-panel__model-cost">${entry.cost.toFixed(4)}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="quota-panel__config">
        <div className="quota-panel__config-title">提醒设置</div>
        <label className="quota-panel__config-row">
          <span>周期</span>
          <select value={config?.period ?? "daily"} onChange={(e) => saveConfig({ ...(config ?? { tokenLimit: 100000, period: "daily" }), period: e.target.value as "daily" | "monthly" })}>
            <option value="daily">每日</option>
            <option value="monthly">每月</option>
          </select>
        </label>
        <label className="quota-panel__config-row">
          <span>Token 提醒阈值</span>
          <input type="number" value={config?.tokenLimit ?? ""} placeholder="不提醒" onChange={(e) => saveConfig({ ...(config ?? { period: "daily" }), tokenLimit: parseInt(e.target.value, 10) || 0 })} />
        </label>
      </div>
    </div>
  );
}
