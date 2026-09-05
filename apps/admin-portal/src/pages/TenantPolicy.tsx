import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Save, Settings, Shield } from "lucide-react";
import { gatewayClient, type TenantPolicy } from "../api/gateway-client";

interface Ctx {
  tenantId: string;
}

export function TenantPolicy() {
  const { tenantId } = useOutletContext<Ctx>();
  const [policy, setPolicy] = useState<TenantPolicy | null>(null);
  const [draft, setDraft] = useState<TenantPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await gatewayClient.getTenantPolicy(tenantId);
      setPolicy(r.data);
      setDraft(r.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    if (!tenantId || !draft) return;
    setBusy(true);
    setError(null);
    try {
      const r = await gatewayClient.patchTenantPolicy(tenantId, {
        status: draft.status,
        maxResources: draft.maxResources,
        killSwitch: draft.killSwitch,
        modelAllowlist: draft.modelAllowlist,
        mcpAllowlist: draft.mcpAllowlist,
        maxTokensPerDay: draft.maxTokensPerDay,
        maxPointsPerDay: draft.maxPointsPerDay,
        newApiGroup: draft.newApiGroup,
      });
      setPolicy(r.data);
      setDraft(r.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!tenantId) return <p style={{ color: "var(--wb-text-tertiary)" }}>请先选择租户</p>;
  if (!draft || !policy) return <p>加载中…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0 }}><Settings size={20} /> 租户策略</h1>

      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          <label>
            <span style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>状态</span>
            <select className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as TenantPolicy["status"] })} style={{ width: "100%" }}>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="archived">archived</option>
            </select>
          </label>

          <label>
            <span style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>最大资源数</span>
            <input className="input" type="number" value={draft.maxResources} onChange={(e) => setDraft({ ...draft, maxResources: Number(e.target.value) || 0 })} style={{ width: "100%" }} />
          </label>

          <label>
            <span style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>NewAPI Group</span>
            <input className="input" value={draft.newApiGroup ?? ""} onChange={(e) => setDraft({ ...draft, newApiGroup: e.target.value || undefined })} style={{ width: "100%" }} />
          </label>

          <label>
            <span style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>每日 Token 上限</span>
            <input className="input" type="number" value={draft.maxTokensPerDay ?? 0} onChange={(e) => setDraft({ ...draft, maxTokensPerDay: Number(e.target.value) || undefined })} style={{ width: "100%" }} />
          </label>

          <label>
            <span style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>每日积分上限</span>
            <input className="input" type="number" value={draft.maxPointsPerDay ?? 0} onChange={(e) => setDraft({ ...draft, maxPointsPerDay: Number(e.target.value) || undefined })} style={{ width: "100%" }} />
          </label>

          <label>
            <span style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>模型白名单（逗号分隔）</span>
            <input className="input" value={(draft.modelAllowlist ?? []).join(",")} onChange={(e) => setDraft({ ...draft, modelAllowlist: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} style={{ width: "100%" }} />
          </label>

          <label>
            <span style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>MCP 白名单（逗号分隔）</span>
            <input className="input" value={(draft.mcpAllowlist ?? []).join(",")} onChange={(e) => setDraft({ ...draft, mcpAllowlist: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} style={{ width: "100%" }} />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--wb-bg-primary)", padding: 12, borderRadius: "var(--wb-radius-md)" }}>
            <input type="checkbox" checked={draft.killSwitch ?? false} onChange={(e) => setDraft({ ...draft, killSwitch: e.target.checked })} />
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Shield size={14} /> Kill Switch（启用后所有 AI 请求会被 503 拒绝）
            </span>
          </label>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
            <Save size={14} /> {busy ? "保存中…" : "保存"}
          </button>
          <button className="btn btn-secondary" onClick={reload} disabled={busy || !dirty}>重置</button>
        </div>

        {error && <p style={{ color: "var(--wb-status-error)", marginTop: 8 }}>{error}</p>}
        <p style={{ marginTop: 8, color: "var(--wb-text-tertiary)", fontSize: 12 }}>
          当前 version: <code>{policy.version}</code> · updatedAt: <code>{policy.updatedAt}</code>
        </p>
      </div>
    </div>
  );
}
