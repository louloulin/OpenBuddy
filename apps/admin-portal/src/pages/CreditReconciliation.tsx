import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Download, RefreshCw } from "lucide-react";
import { gatewayClient, type ReconciliationReport } from "../api/gateway-client";

interface Ctx {
  tenantId: string;
}

export function CreditReconciliation() {
  const { tenantId } = useOutletContext<Ctx>();
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletFilter, setWalletFilter] = useState("");

  const reload = useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await gatewayClient.getReconciliation(tenantId, walletFilter || undefined);
      setReport(r.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tenantId, walletFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!tenantId) return <p style={{ color: "var(--wb-text-tertiary)" }}>请先选择租户</p>;
  if (error) return <p style={{ color: "var(--wb-status-error)" }}>{error}</p>;
  if (!report) return <p>加载中…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, flex: 1 }}>成本对账</h1>
        <input
          className="input"
          placeholder="Wallet ID（可选）"
          value={walletFilter}
          onChange={(e) => setWalletFilter(e.target.value)}
          style={{ width: 220 }}
        />
        <button className="btn btn-secondary" onClick={reload}>
          <RefreshCw size={14} /> 刷新
        </button>
        <button className="btn btn-secondary" disabled>
          <Download size={14} /> 导出 CSV（待补）
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>汇总</h2>
        <p>
          外部成本已抓取：
          {report.externalNewApiCostFetched ? (
            <span className="tag tag-ok">是（{report.externalSource ?? "new-api-import"}）</span>
          ) : (
            <span className="tag tag-warn">否（等待 Worker 运行）</span>
          )}
          {" · "}生成时间：<code>{report.generatedAt}</code>
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>按模型</h2>
        <BucketTable buckets={report.bucketsByModel} dim="模型" />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>按成员（subject）</h2>
        <BucketTable buckets={report.bucketsBySubject} dim="成员" />
      </div>
    </div>
  );
}

function BucketTable({ buckets, dim }: { buckets: ReconciliationReport["bucketsByModel"]; dim: string }) {
  const rows = Object.entries(buckets ?? {});
  if (rows.length === 0) return <p style={{ color: "var(--wb-text-tertiary)" }}>暂无数据</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--wb-border-default)", textAlign: "left" }}>
          <th style={{ padding: 8 }}>{dim}</th>
          <th style={{ padding: 8 }}>调用次数</th>
          <th style={{ padding: 8 }}>Tokens</th>
          <th style={{ padding: 8 }}>消耗积分</th>
          <th style={{ padding: 8 }}>上游成本</th>
          <th style={{ padding: 8 }}>外部成本</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, b]) => (
          <tr key={k} style={{ borderBottom: "1px solid var(--wb-border-soft)" }}>
            <td style={{ padding: 8 }}>{k}</td>
            <td style={{ padding: 8 }}>{b.requests.toLocaleString()}</td>
            <td style={{ padding: 8 }}>{b.totalTokens.toLocaleString()}</td>
            <td style={{ padding: 8 }}>{b.pointsSettled.toLocaleString()}</td>
            <td style={{ padding: 8 }}>{b.upstreamCost.toFixed(4)}</td>
            <td style={{ padding: 8 }}>{b.externalCost ? b.externalCost.toFixed(4) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
