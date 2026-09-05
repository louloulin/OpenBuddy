import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Activity, Coins, CreditCard, Users } from "lucide-react";
import { gatewayClient, type ReconciliationReport } from "../api/gateway-client";

interface Ctx {
  tenantId: string;
}

/**
 * Dashboard：聚合关键指标
 * - 实时积分余额
 * - 最近 7 天消耗
 * - 活跃成员
 * - Gateway 健康
 */
export function Dashboard() {
  const { tenantId } = useOutletContext<Ctx>();
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    gatewayClient
      .getReconciliation(tenantId)
      .then((r) => setReport(r.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [tenantId]);

  if (!tenantId) return <Hint text="请先选择租户" />;
  if (error) return <Hint text={`加载失败：${error}`} kind="err" />;
  if (!report) return <Hint text="加载中…" />;

  const totals = Object.values(report.bucketsByModel).reduce(
    (acc, b) => ({
      requests: acc.requests + b.requests,
      tokens: acc.tokens + b.totalTokens,
      points: acc.points + b.pointsSettled,
      cost: acc.cost + b.upstreamCost,
    }),
    { requests: 0, tokens: 0, points: 0, cost: 0 },
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>Dashboard</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <Metric icon={<Activity size={20} />} label="本月调用次数" value={totals.requests.toLocaleString()} />
        <Metric icon={<Coins size={20} />} label="本月消耗积分" value={totals.points.toLocaleString()} />
        <Metric
          icon={<Users size={20} />}
          label="本月消耗 Tokens"
          value={totals.tokens.toLocaleString()}
        />
        <Metric
          icon={<CreditCard size={20} />}
          label="上游成本"
          value={totals.cost > 0 ? `${totals.cost.toFixed(4)} USD` : "—"}
        />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>最近对账（{report.scope}）</h2>
        <p style={{ color: "var(--wb-text-tertiary)", fontSize: 12 }}>
          生成时间：{new Date(report.generatedAt).toLocaleString()} · 外部成本已抓取：
          {report.externalNewApiCostFetched ? "✅" : "❌"}
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--wb-border-default)", textAlign: "left" }}>
              <th style={{ padding: 8 }}>模型</th>
              <th style={{ padding: 8 }}>调用次数</th>
              <th style={{ padding: 8 }}>Tokens</th>
              <th style={{ padding: 8 }}>消耗积分</th>
              <th style={{ padding: 8 }}>上游成本</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.bucketsByModel).map(([model, b]) => (
              <tr key={model} style={{ borderBottom: "1px solid var(--wb-border-soft)" }}>
                <td style={{ padding: 8 }}>{model}</td>
                <td style={{ padding: 8 }}>{b.requests.toLocaleString()}</td>
                <td style={{ padding: 8 }}>{b.totalTokens.toLocaleString()}</td>
                <td style={{ padding: 8 }}>{b.pointsSettled.toLocaleString()}</td>
                <td style={{ padding: 8 }}>{b.upstreamCost.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          background: "var(--wb-bg-tertiary)",
          borderRadius: "var(--wb-radius-md)",
          padding: 12,
          color: "var(--wb-text-brand)",
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ color: "var(--wb-text-tertiary)", fontSize: 12 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

function Hint({ text, kind = "warn" }: { text: string; kind?: "warn" | "err" }) {
  return (
    <div className={`tag tag-${kind}`} style={{ padding: 16, fontSize: 14 }}>
      {text}
    </div>
  );
}
