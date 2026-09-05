import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Coins, Save } from "lucide-react";
import { gatewayClient, type CreditPricingEntry } from "../api/gateway-client";

interface Ctx {
  tenantId: string;
}

interface Draft extends Omit<CreditPricingEntry, "model"> {
  model: string;
  dirty: boolean;
}

export function CreditPricing() {
  const { tenantId } = useOutletContext<Ctx>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await gatewayClient.listCreditPricing(tenantId);
      setDrafts(
        r.data.map((p) => ({
          ...p,
          dirty: false,
        })),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = (model: string, patch: Partial<Draft>) => {
    setDrafts((curr) =>
      curr.map((d) => (d.model === model ? { ...d, ...patch, dirty: true } : d)),
    );
  };

  const save = async (model: string) => {
    if (!tenantId) return;
    const draft = drafts.find((d) => d.model === model);
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await gatewayClient.updateCreditPricing(tenantId, {
        inputPointsPerThousand: draft.inputPointsPerThousand,
        outputPointsPerThousand: draft.outputPointsPerThousand,
        minimumPoints: draft.minimumPoints,
        inputCostPerMillion: draft.inputCostPerMillion,
        outputCostPerMillion: draft.outputCostPerMillion,
        costCurrency: draft.costCurrency,
      });
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const dirtyCount = useMemo(() => drafts.filter((d) => d.dirty).length, [drafts]);

  if (!tenantId) return <p style={{ color: "var(--wb-text-tertiary)" }}>请先选择租户</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0 }}>
        <Coins size={20} /> 积分定价
        {dirtyCount > 0 && (
          <span className="tag tag-warn" style={{ marginLeft: 12 }}>{dirtyCount} 项待保存</span>
        )}
      </h1>

      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--wb-border-default)", textAlign: "left" }}>
              <th style={{ padding: 8 }}>模型</th>
              <th style={{ padding: 8 }}>输入（积分/1k）</th>
              <th style={{ padding: 8 }}>输出（积分/1k）</th>
              <th style={{ padding: 8 }}>最低积分</th>
              <th style={{ padding: 8 }}>输入成本</th>
              <th style={{ padding: 8 }}>输出成本</th>
              <th style={{ padding: 8 }}>货币</th>
              <th style={{ padding: 8 }}>成本来源</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.model} style={{ borderBottom: "1px solid var(--wb-border-soft)" }}>
                <td style={{ padding: 8, fontWeight: 600 }}>{d.model}</td>
                <td style={{ padding: 8 }}>
                  <NumInput value={d.inputPointsPerThousand} onChange={(v) => update(d.model, { inputPointsPerThousand: v })} />
                </td>
                <td style={{ padding: 8 }}>
                  <NumInput value={d.outputPointsPerThousand} onChange={(v) => update(d.model, { outputPointsPerThousand: v })} />
                </td>
                <td style={{ padding: 8 }}>
                  <NumInput value={d.minimumPoints} onChange={(v) => update(d.model, { minimumPoints: v })} />
                </td>
                <td style={{ padding: 8 }}>
                  <NumInput value={d.inputCostPerMillion ?? 0} onChange={(v) => update(d.model, { inputCostPerMillion: v })} />
                </td>
                <td style={{ padding: 8 }}>
                  <NumInput value={d.outputCostPerMillion ?? 0} onChange={(v) => update(d.model, { outputCostPerMillion: v })} />
                </td>
                <td style={{ padding: 8 }}>
                  <input className="input" value={d.costCurrency ?? ""} onChange={(e) => update(d.model, { costCurrency: e.target.value.toUpperCase() })} style={{ width: 70 }} />
                </td>
                <td style={{ padding: 8, color: "var(--wb-text-tertiary)", fontSize: 12 }}>{d.costSource ?? "—"}</td>
                <td style={{ padding: 8 }}>
                  {d.dirty && (
                    <button className="btn btn-primary" disabled={busy} onClick={() => save(d.model)} style={{ padding: "4px 10px" }}>
                      <Save size={12} /> 保存
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {drafts.length === 0 && <p style={{ color: "var(--wb-text-tertiary)" }}>尚未配置模型定价</p>}
      </div>

      {error && <p style={{ color: "var(--wb-status-error)" }}>{error}</p>}
      <p style={{ color: "var(--wb-text-tertiary)", fontSize: 12 }}>
        调价只影响新发起的 AI 请求；进行中的 reservation/consume/refund 仍使用旧价快照。成本来源由 NewAPI Worker 导入，运营不能修改。
      </p>
    </div>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      className="input"
      type="number"
      style={{ width: 80 }}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  );
}
