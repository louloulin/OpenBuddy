/**
 * OpenBuddy 租户策略面板。
 *
 * 集中编辑当前租户的策略：状态（active / suspended / archived）、最大资源数、
 * Kill Switch、每日 token/积分预算、模型/MCP 白名单、New API Group。所有变更
 * 走 casdoor:tenant-policy-update，携带 expectedVersion 走 Gateway 乐观 CAS。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Power, RefreshCw, Save, Shield } from "lucide-react";
import {
  casdoorGetTenantPolicy,
  casdoorUpdateTenantPolicy,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorTenantPolicy, CasdoorTenantPolicyPatch, CasdoorTenantPolicyStatus } from "@openbuddy/auth-casdoor";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

const STATUS_LABEL: Record<CasdoorTenantPolicyStatus, string> = {
  active: "正常",
  suspended: "暂停",
  archived: "归档",
};

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

function splitList(value: string): string[] {
  return value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
}

export function TenantPolicyPanel() {
  const [policy, setPolicy] = useState<CasdoorTenantPolicy | null>(null);
  const [draft, setDraft] = useState<CasdoorTenantPolicyPatch>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const fresh = await casdoorGetTenantPolicy().catch((error) => {
        setMessage({ kind: "warn", text: `加载策略失败：${describeError(error)}` });
        return null;
      });
      setPolicy(fresh);
      if (fresh) {
        setDraft({
          status: fresh.status,
          maxResources: fresh.maxResources,
          modelAllowlist: fresh.modelAllowlist ?? [],
          mcpAllowlist: fresh.mcpAllowlist ?? [],
          killSwitch: fresh.killSwitch === true,
          maxTokensPerDay: fresh.maxTokensPerDay,
          maxPointsPerDay: fresh.maxPointsPerDay,
          newApiGroup: fresh.newApiGroup ?? "",
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirty = useMemo(() => {
    if (!policy) return false;
    if (draft.status !== undefined && draft.status !== policy.status) return true;
    if (draft.maxResources !== undefined && draft.maxResources !== policy.maxResources) return true;
    if (draft.killSwitch !== undefined && draft.killSwitch !== (policy.killSwitch === true)) return true;
    if ((draft.maxTokensPerDay ?? undefined) !== (policy.maxTokensPerDay ?? undefined)) return true;
    if ((draft.maxPointsPerDay ?? undefined) !== (policy.maxPointsPerDay ?? undefined)) return true;
    if (draft.newApiGroup !== undefined && draft.newApiGroup !== (policy.newApiGroup ?? "")) return true;
    const draftModels = (draft.modelAllowlist ?? []).slice().sort().join(",");
    const policyModels = (policy.modelAllowlist ?? []).slice().sort().join(",");
    if (draftModels !== policyModels) return true;
    const draftMcp = (draft.mcpAllowlist ?? []).slice().sort().join(",");
    const policyMcp = (policy.mcpAllowlist ?? []).slice().sort().join(",");
    if (draftMcp !== policyMcp) return true;
    return false;
  }, [draft, policy]);

  const handleSave = useCallback(async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const patch: CasdoorTenantPolicyPatch = {
        ...draft,
        expectedVersion: policy.version,
      };
      const updated = await casdoorUpdateTenantPolicy(patch);
      setPolicy(updated);
      setMessage({ kind: "ok", text: `策略已更新到版本 ${updated.version}` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setSaving(false);
    }
  }, [draft, policy]);

  if (!policy && !loading) {
    return (
      <SectionShell title="租户策略" desc="未获取到租户策略。请确认 Gateway 已配置并已登录。">
        {message && (
          <p
            className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
            data-testid="tenant-policy-message"
            role="alert"
          >
            {message.text}
          </p>
        )}
        <button className="settings-btn" onClick={reload}>重试</button>
      </SectionShell>
    );
  }

  return (
    <SectionShell
      title="租户策略"
      desc="管理当前租户的运行策略：状态、最大资源数、Kill Switch、每日 token 配额、模型/MCP 白名单以及 New API Group。所有变更携带 expectedVersion 做乐观并发控制。"
    >
      <div className="account-section" data-testid="tenant-policy-section">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <Shield size={16} /> 当前策略
          </h3>
          <button className="settings-btn" onClick={reload} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
        {policy && (
          <p className="settings-hint">
            当前版本：<strong>{policy.version}</strong>
            {policy.updatedAt ? ` · 更新于 ${new Date(policy.updatedAt).toLocaleString()}` : ""}
            {policy.updatedBy ? ` · ${policy.updatedBy}` : ""}
            {policy.tokensUsedToday !== undefined ? ` · 今日 token ${policy.tokensUsedToday.toLocaleString()}` : ""}
          </p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          <label>
            <span className="settings-hint">状态</span>
            <select
              data-testid="tenant-policy-status"
              value={draft.status ?? "active"}
              onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as CasdoorTenantPolicyStatus }))}
              style={{ width: "100%" }}
              disabled={!policy}
            >
              {(Object.keys(STATUS_LABEL) as CasdoorTenantPolicyStatus[]).map((status) => (
                <option key={status} value={status}>{STATUS_LABEL[status]}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="settings-hint">每日积分预算（留空不限）</span>
            <input
              data-testid="tenant-policy-max-points"
              type="number"
              min={0}
              step={1}
              value={draft.maxPointsPerDay ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((prev) => ({ ...prev, maxPointsPerDay: value === "" ? undefined : Math.max(0, Math.floor(Number(value) || 0)) }));
              }}
              style={{ width: "100%" }}
              disabled={!policy}
            />
          </label>
          <label>
            <span className="settings-hint">最大资源数</span>
            <input
              data-testid="tenant-policy-max-resources"
              type="number"
              min={0}
              step={1}
              value={draft.maxResources ?? 0}
              onChange={(event) => setDraft((prev) => ({ ...prev, maxResources: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))}
              style={{ width: "100%" }}
              disabled={!policy}
            />
          </label>
          <label>
            <span className="settings-hint">每日 token 配额（留空不限）</span>
            <input
              data-testid="tenant-policy-max-tokens"
              type="number"
              min={0}
              step={1}
              value={draft.maxTokensPerDay ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((prev) => ({ ...prev, maxTokensPerDay: value === "" ? undefined : Math.max(0, Math.floor(Number(value) || 0)) }));
              }}
              style={{ width: "100%" }}
              disabled={!policy}
            />
          </label>
          <label>
            <span className="settings-hint">New API Group</span>
            <input
              data-testid="tenant-policy-new-api-group"
              type="text"
              value={draft.newApiGroup ?? ""}
              onChange={(event) => setDraft((prev) => ({ ...prev, newApiGroup: event.target.value }))}
              style={{ width: "100%" }}
              disabled={!policy}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="settings-hint">模型白名单（逗号或换行分隔，留空=全部允许）</span>
            <textarea
              data-testid="tenant-policy-model-allowlist"
              rows={3}
              value={(draft.modelAllowlist ?? []).join("\n")}
              onChange={(event) => setDraft((prev) => ({ ...prev, modelAllowlist: splitList(event.target.value) }))}
              style={{ width: "100%", fontFamily: "monospace" }}
              disabled={!policy}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="settings-hint">MCP 白名单（逗号或换行分隔）</span>
            <textarea
              data-testid="tenant-policy-mcp-allowlist"
              rows={3}
              value={(draft.mcpAllowlist ?? []).join("\n")}
              onChange={(event) => setDraft((prev) => ({ ...prev, mcpAllowlist: splitList(event.target.value) }))}
              style={{ width: "100%", fontFamily: "monospace" }}
              disabled={!policy}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              data-testid="tenant-policy-kill-switch"
              type="checkbox"
              checked={draft.killSwitch === true}
              onChange={(event) => setDraft((prev) => ({ ...prev, killSwitch: event.target.checked }))}
              disabled={!policy}
            />
            <span className={draft.killSwitch ? "settings-msg--err" : "settings-hint"}>
              <Power size={12} /> Kill Switch（开启后所有 AI 请求立即被拒绝）
            </span>
          </label>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button
            className="settings-btn"
            data-testid="tenant-policy-save"
            onClick={handleSave}
            disabled={!policy || !dirty || saving}
          >
            <Save size={14} /> 保存
          </button>
        </div>
      </div>

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="tenant-policy-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default TenantPolicyPanel;
