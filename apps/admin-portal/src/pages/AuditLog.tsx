import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FileText } from "lucide-react";
import { gatewayClient, type AuditEntry } from "../api/gateway-client";

interface Ctx {
  tenantId: string;
}

export function AuditLog() {
  const { tenantId } = useOutletContext<Ctx>();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await gatewayClient.listAudit(tenantId, 200);
      setEntries(r.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!tenantId) return <p style={{ color: "var(--wb-text-tertiary)" }}>请先选择租户</p>;
  if (error) return <p style={{ color: "var(--wb-status-error)" }}>{error}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0 }}><FileText size={20} /> 审计日志</h1>

      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--wb-border-default)", textAlign: "left" }}>
              <th style={{ padding: 8 }}>时间</th>
              <th style={{ padding: 8 }}>事件</th>
              <th style={{ padding: 8 }}>主体</th>
              <th style={{ padding: 8 }}>资源</th>
              <th style={{ padding: 8 }}>动作</th>
              <th style={{ padding: 8 }}>结果</th>
              <th style={{ padding: 8 }}>Request ID</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid var(--wb-border-soft)" }}>
                <td style={{ padding: 8, fontSize: 12, color: "var(--wb-text-tertiary)" }}>
                  {new Date(e.timestamp).toLocaleString()}
                </td>
                <td style={{ padding: 8 }}>{e.event}</td>
                <td style={{ padding: 8, fontSize: 12 }}>{e.subject}</td>
                <td style={{ padding: 8, fontSize: 12 }}>{e.resource ?? "—"}</td>
                <td style={{ padding: 8, fontSize: 12 }}>{e.action ?? "—"}</td>
                <td style={{ padding: 8 }}>
                  <span className={`tag ${e.outcome === "success" ? "tag-ok" : "tag-err"}`}>{e.outcome}</span>
                </td>
                <td style={{ padding: 8, fontSize: 11, fontFamily: "monospace" }}>{e.requestId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p style={{ color: "var(--wb-text-tertiary)" }}>暂无审计日志</p>}
      </div>
    </div>
  );
}
