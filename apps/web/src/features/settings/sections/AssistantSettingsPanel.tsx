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
import { useLocale } from "@/shared/i18n";
import { SectionShell } from "./shared";

// ---------- 助理设置 ----------

/** 权限模式的选项文案随语言切换，因此按 t 构造。 */
function permissionOptions(t: (key: string, vars?: Record<string, string | number>) => string): { value: string; label: string }[] {
  return [
    { value: "ask", label: t("assistant.permissionAsk") },
    { value: "auto", label: t("assistant.permissionAuto") },
    { value: "always-approve", label: t("assistant.permissionAlways") },
  ];
}

/** AssistantSettingsPanel — 助理角色列表 + 新会话默认模型/权限偏好。
 *  agents 来自 应用数据目录/pi/agents/*.md；默认值写入 config.toml 的
 *  [models].default 和 [ui].default_selected_permission。 */
export function AssistantSettingsPanel() {
  const { t } = useLocale();
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
      setMsg(t("assistant.loadFailed", { error: String(error) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      setMsg(t("assistant.saved"));
    } catch (e) {
      setMsg(t("assistant.saveFailed", { error: String(e).replace(/^Error:\s*/, "") }));
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
      title={t("assistant.title")}
      desc={t("assistant.desc")}
    >
      {loading ? (
        <p className="settings-hint">{t("assistant.loading")}</p>
      ) : (
        <>
          {/* 默认模型 */}
          <div className="settings-row">
            <div className="settings-row__label">
              <span>{t("assistant.defaultModel")}</span>
            </div>
            <div className="settings-row__control">
              <select
                className="agent-select"
                value={draft.defaultModel}
                onChange={(e) => update({ defaultModel: e.target.value })}
              >
                <option value="">{t("assistant.firstModel")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.providerLabel} / {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="settings-hint">
            {t("assistant.defaultModelHint")}
          </p>

          <div className="settings-row">
            <label htmlFor="default-thinking-level">{t("assistant.thinkingLevel")}</label>
            {knownModelState ? <select id="default-thinking-level" value={draft.defaultThinkingLevel ?? ""} onChange={event => update({ defaultThinkingLevel: event.target.value || undefined })}>
              <option value="">{t("assistant.thinkingDefault")}</option>
              {knownModelState.availableThinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}
            </select> : <span>{t("assistant.thinkingLevelHint", { level: draft.defaultThinkingLevel ?? t("assistant.thinkingDefault") })}</span>}
          </div>

          {/* 默认权限选择 */}
          <div className="settings-row">
            <div className="settings-row__label">
              <Shield size={16} />
              <span>{t("assistant.permissionMode")}</span>
            </div>
            <div className="settings-row__control">
              <select
                className="agent-select"
                value={draft.defaultPermission}
                onChange={(e) => update({ defaultPermission: e.target.value })}
              >
                {permissionOptions(t).map((o) => (
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
              {busy ? t("assistant.saving") : t("assistant.save")}
            </button>
            {dirty && (
              <button className="settings-btn" onClick={handleReset} disabled={busy}>
                {t("assistant.discard")}
              </button>
            )}
            <button className="settings-btn" onClick={reload} disabled={busy}>
              <RefreshCw size={14} /> {t("assistant.reload")}
            </button>
          </div>

          {msg && <p className="settings-msg">{msg}</p>}


        </>
      )}
    </SectionShell>
  );
}
