import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Coins, Plus, Save } from "lucide-react";
import { gatewayClient, type BillingPlan } from "../api/gateway-client";

interface Ctx {
  tenantId: string;
}

export function BillingPlans() {
  const { tenantId } = useOutletContext<Ctx>();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<BillingPlan>({
    id: "",
    name: "",
    currency: "CNY",
    priceMinor: 0,
    points: 0,
    pointsValidDays: 30,
    entitlementsValidDays: 30,
    active: true,
  });

  const reload = useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await gatewayClient.listBillingPlans(tenantId);
      setPlans(r.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    if (!tenantId || !draft.id.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await gatewayClient.upsertBillingPlan(tenantId, draft);
      await reload();
      setDraft({ ...draft, id: "", name: "" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!tenantId) return <p style={{ color: "var(--wb-text-tertiary)" }}>请先选择租户</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0 }}>计费套餐</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}><Plus size={16} /> 新建 / 修改套餐</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label="ID" value={draft.id} onChange={(v) => setDraft({ ...draft, id: v })} />
          <Field label="名称" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <Field label="货币" value={draft.currency} onChange={(v) => setDraft({ ...draft, currency: v.toUpperCase() })} />
          <Field label="价格（分）" type="number" value={draft.priceMinor} onChange={(v) => setDraft({ ...draft, priceMinor: Number(v) || 0 })} />
          <Field label="积分" type="number" value={draft.points} onChange={(v) => setDraft({ ...draft, points: Number(v) || 0 })} />
          <Field label="积分有效期（天）" type="number" value={draft.pointsValidDays ?? 0} onChange={(v) => setDraft({ ...draft, pointsValidDays: Number(v) || undefined })} />
          <Field label="权益有效期（天）" type="number" value={draft.entitlementsValidDays ?? 0} onChange={(v) => setDraft({ ...draft, entitlementsValidDays: Number(v) || undefined })} />
          <Field label="NewAPI Group" value={draft.newApiGroup ?? ""} onChange={(v) => setDraft({ ...draft, newApiGroup: v || undefined })} />
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy} style={{ marginTop: 12 }}>
          <Save size={14} /> {busy ? "保存中…" : "保存套餐"}
        </button>
        {error && <p style={{ color: "var(--wb-status-error)", marginTop: 8 }}>{error}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}><Coins size={16} /> 已配置套餐</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--wb-border-default)", textAlign: "left" }}>
              <th style={{ padding: 8 }}>ID</th>
              <th style={{ padding: 8 }}>名称</th>
              <th style={{ padding: 8 }}>价格</th>
              <th style={{ padding: 8 }}>积分</th>
              <th style={{ padding: 8 }}>有效期</th>
              <th style={{ padding: 8 }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid var(--wb-border-soft)" }}>
                <td style={{ padding: 8 }}>{p.id}</td>
                <td style={{ padding: 8 }}>{p.name}</td>
                <td style={{ padding: 8 }}>{(p.priceMinor / 100).toFixed(2)} {p.currency}</td>
                <td style={{ padding: 8 }}>{p.points.toLocaleString()}</td>
                <td style={{ padding: 8 }}>{p.pointsValidDays ?? "—"} 天</td>
                <td style={{ padding: 8 }}>
                  <span className={`tag ${p.active ? "tag-ok" : "tag-warn"}`}>{p.active ? "启用" : "停用"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {plans.length === 0 && <p style={{ color: "var(--wb-text-tertiary)" }}>暂无套餐</p>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (v: string) => void; type?: "text" | "number" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>{label}</span>
      <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
