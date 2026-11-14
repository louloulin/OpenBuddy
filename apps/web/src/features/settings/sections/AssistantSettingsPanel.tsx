import { useAgentModelStore } from "@/features/models/state/agent-model-store";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Shield } from "lucide-react";
import {
  agentsDefaultsGet,
  agentsDefaultsSave,
  providersList,
  flattenModels,
  type ModelOptionRow,
} from "@openbuddy/client/agent-client";
import type { AgentDefaults } from "@openbuddy/protocol/dto";
import { SectionShell } from "./shared";

// ---------- 助理设置 ----------

const PERMISSION_OPTIONS: { value: string; label: string }[] = [
  { value: "ask", label: "审批模式（每次询问）" },
  { value: "auto", label: "自动模式（高风险操作询问）" },
  { value: "always-approve", label: "完全访问（不再询问）" },
];

/** AssistantSettingsPanel — 助理角色列表 + 新会话默认模型/权限偏好。
 *  agents 来自 应用数据目录/pi/agents/*.md；默认值写入 config.toml 的
 *  [models].default 和 [ui].default_selected_permission。 */
export function AssistantSettingsPanel() {
  const [providers, setProviders] = useState<ModelOptionRow[]>([]);
  const [defaults, setDefaults] = useState<AgentDefaults | null>(null);
  const [draft, setDraft] = useState<AgentDefaults>({
    defaultModel: "",
    defaultPermission: "ask",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const knownModelState = useAgentModelStore(state => Object.values(state.states).find(model => model.modelKey === draft.defaultModel));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [prov, def] = await Promise.all([
        providersList()
          .then(flattenModels)
          .catch(() => [] as ModelOptionRow[]),
        agentsDefaultsGet(),
      ]);
      setProviders(prov);
      setDefaults(def);
      setDraft(def);
      setDirty(false);
    } catch (error) {
      setMsg(`加载失败：${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const update = (patch: Partial<AgentDefaults>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await agentsDefaultsSave({ defaultModel: draft.defaultModel, defaultPermission: draft.defaultPermission, defaultThinkingLevel: draft.defaultThinkingLevel });
      setDefaults(draft);
      setDirty(false);
      setMsg("已保存，之后新建的会话将使用此默认配置。");
    } catch (e) {
      setMsg(`保存失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    if (defaults) {
      setDraft(defaults);
      setDirty(false);
    }
  };

  return (
    <SectionShell
      title="助理设置"
      desc="配置新建会话的默认模型与权限偏好。"
    >
      {loading ? (
        <p className="settings-hint">加载中…</p>
      ) : (
        <>
          {/* 默认模型 */}
          <div className="settings-row">
            <div className="settings-row__label">
              <span>新建会话默认模型</span>
            </div>
            <div className="settings-row__control">
              <select
                className="agent-select"
                value={draft.defaultModel}
                onChange={(e) => update({ defaultModel: e.target.value })}
              >
                <option value="">首个已配置模型</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.providerLabel} / {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="settings-hint">
            未指定时使用已配置的第一个可用模型。
          </p>

          <div className="settings-row">
            <label htmlFor="default-thinking-level">新会话默认思考等级</label>
            {knownModelState ? <select id="default-thinking-level" value={draft.defaultThinkingLevel ?? ""} onChange={event => update({ defaultThinkingLevel: event.target.value || undefined })}>
              <option value="">使用 Pi 默认等级</option>
              {knownModelState.availableThinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}
            </select> : <span>{draft.defaultThinkingLevel ?? "使用 Pi 默认等级"}；打开此模型的会话后可选择其实际支持等级。</span>}
          </div>

          {/* 默认权限选择 */}
          <div className="settings-row">
            <div className="settings-row__label">
              <Shield size={16} />
              <span>新会话权限模式</span>
            </div>
            <div className="settings-row__control">
              <select
                className="agent-select"
                value={draft.defaultPermission}
                onChange={(e) => update({ defaultPermission: e.target.value })}
              >
                {PERMISSION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="settings-actions">
            <button
              className="settings-btn"
              onClick={handleSave}
              disabled={busy || !dirty}
            >
              {busy ? "保存中…" : "保存偏好"}
            </button>
            {dirty && (
              <button className="settings-btn" onClick={handleReset} disabled={busy}>
                放弃
              </button>
            )}
            <button className="settings-btn" onClick={reload} disabled={busy}>
              <RefreshCw size={14} /> 重新加载
            </button>
          </div>

          {msg && <p className="settings-msg">{msg}</p>}


        </>
      )}
    </SectionShell>
  );
}
