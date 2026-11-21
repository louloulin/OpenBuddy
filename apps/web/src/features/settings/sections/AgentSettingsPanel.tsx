import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  commandsList,
  mcpList,
  skillsList,
  subagentsConfigGet,
  subagentsConfigSave,
  webSearchConfigGet,
  webSearchConfigSave,
} from "@openbuddy/client/agent-client";
import type {
  McpServerEntry,
  SkillInfo,
  SlashCommand,
} from "@openbuddy/protocol/dto";
import { SectionShell } from "./shared";
import { AgentBehaviorSettings } from "./AgentBehaviorSettings";
import { useLocale } from "@/shared/i18n";

// ---------- 智能体设置 ----------

/**
 * 子代理深度 / Web 搜索 call `subagents_config_*` / `web_search_config_*`, which the host does not
 * implement (PENDING_COMMANDS; sub-agents arrive with 20261116-pii W3.4). Now that this section is
 * reachable from the settings nav, that block is switched off instead of deleted (plan D8) so the
 * panel makes no not_implemented calls; flip this once the host serves them.
 */
const RUNTIME_CONFIG_AVAILABLE = false;

/** AgentSettingsPanel — 汇总显示当前智能体配置（skills + MCP + slash 命令）。
 *  数据来自 agent 的 x.ai/skills/config、x.ai/mcp/list、x.ai/commands/list，
 *  与「专家·技能·连接器」面板的数据源相同，但这里是设置视图：只读 + 刷新 +
 *  跳转到对应管理面板。 */
export function AgentSettingsPanel() {
  const { t } = useLocale();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [subagentDepth, setSubagentDepth] = useState<number>(1);
  const [subagentDraft, setSubagentDraft] = useState<string>("1");
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(false);
  const [webSearchModel, setWebSearchModel] = useState<string>("");
  const [webSearchDraftModel, setWebSearchDraftModel] = useState<string>("");
  const [savingRuntime, setSavingRuntime] = useState(false);
  const [runtimeMsg, setRuntimeMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sk, mc, cmd, sa, ws] = await Promise.all([
        skillsList().catch(() => [] as SkillInfo[]),
        mcpList().catch(() => [] as McpServerEntry[]),
        commandsList().catch(() => [] as SlashCommand[]),
        RUNTIME_CONFIG_AVAILABLE ? subagentsConfigGet().catch(() => ({ maxDepth: 1 })) : { maxDepth: 1 },
        RUNTIME_CONFIG_AVAILABLE ? webSearchConfigGet().catch(() => ({ enabled: false, model: "" })) : { enabled: false, model: "" },
      ]);
      setSkills(sk);
      setServers(mc);
      setCommands(cmd);
      setSubagentDepth(sa.maxDepth);
      setSubagentDraft(String(sa.maxDepth));
      setWebSearchEnabled(ws.enabled);
      setWebSearchModel(ws.model);
      setWebSearchDraftModel(ws.model);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Save subagent max_depth. Clamped to ≥1 on the backend. */
  const saveSubagentDepth = useCallback(async () => {
    setSavingRuntime(true);
    setRuntimeMsg(null);
    try {
      const clamped = await subagentsConfigSave(Number(subagentDraft) || 1);
      setSubagentDepth(clamped);
      setSubagentDraft(String(clamped));
      setRuntimeMsg(t("agent.runtime.depth.saved", { n: clamped }));
    } catch (e) {
      setRuntimeMsg(t("agent.runtime.saveFailed", { error: String(e).replace(/^Error:\s*/, "") }));
    } finally {
      setSavingRuntime(false);
    }
  }, [subagentDraft, t]);

  /** Toggle web search on/off. */
  const saveWebSearch = useCallback(
    async (enable: boolean) => {
      setSavingRuntime(true);
      setRuntimeMsg(null);
      try {
        if (enable && !webSearchDraftModel.trim()) {
          setRuntimeMsg(t("agent.runtime.websearch.needModel"));
          setSavingRuntime(false);
          return;
        }
        await webSearchConfigSave(enable, webSearchDraftModel.trim() || undefined);
        setWebSearchEnabled(enable);
        setWebSearchModel(enable ? webSearchDraftModel.trim() : "");
        setRuntimeMsg(
          enable
            ? t("agent.runtime.websearch.enabled", { model: webSearchDraftModel.trim() })
            : t("agent.runtime.websearch.disabled"),
        );
      } catch (e) {
        setRuntimeMsg(t("agent.runtime.saveFailed", { error: String(e).replace(/^Error:\s*/, "") }));
      } finally {
        setSavingRuntime(false);
      }
    },
    [webSearchDraftModel, t],
  );

  const enabledSkills = skills.filter((s) => s.enabled);
  const disabledSkills = skills.filter((s) => !s.enabled);
  const enabledServers = servers.filter((s) => s.enabled);
  const disabledServers = servers.filter((s) => !s.enabled);
  const builtinCommands = commands.filter((c) => !c.source || c.source === "builtin");
  const skillCommands = commands.filter((c) => c.source === "skill");
  const pluginCommands = commands.filter((c) => c.source === "plugin");

  return (
    <SectionShell
      title={t("agent.title")}
      desc={t("agent.desc")}
    >
      {/* 运行行为 (20261116-pii W0.4): pi-settings.json via settings_agent_get / settings_agent_set. */}
      <AgentBehaviorSettings />
      <h3 className="agent-behavior__group-title">{t("agent.group.assets")}</h3>
      <div className="settings-actions">
        <button className="settings-btn" onClick={reload} disabled={loading}>
          <RefreshCw size={14} /> {loading ? t("agent.refresh.loading") : t("agent.refresh")}
        </button>
      </div>

      {error && <p className="settings-msg settings-msg--warn">{t("agent.loadError", { error })}</p>}

      {/* 汇总统计 */}
      <div className="agent-stats">
        <div className="agent-stats__item">
          <div className="agent-stats__num">{enabledSkills.length}</div>
          <div className="agent-stats__label">{t("agent.stats.enabledSkills")}</div>
          {disabledSkills.length > 0 && (
            <div className="agent-stats__sub">{t("agent.stats.disabled", { n: disabledSkills.length })}</div>
          )}
        </div>
        <div className="agent-stats__item">
          <div className="agent-stats__num">{enabledServers.length}</div>
          <div className="agent-stats__label">{t("agent.stats.connectedMcp")}</div>
          {disabledServers.length > 0 && (
            <div className="agent-stats__sub">{t("agent.stats.disabled", { n: disabledServers.length })}</div>
          )}
        </div>
        <div className="agent-stats__item">
          <div className="agent-stats__num">{commands.length}</div>
          <div className="agent-stats__label">{t("agent.stats.slashCommands")}</div>
          <div className="agent-stats__sub">
            {t("agent.stats.commandBreakdown", {
              builtin: builtinCommands.length,
              skill: skillCommands.length,
              plugin: pluginCommands.length,
            })}
          </div>
        </div>
      </div>

      {/* 技能列表 */}
      <details className="agent-section" open>
        <summary className="agent-section__title">
          {t("agent.skills.title", { n: skills.length })}
        </summary>
        <div className="agent-section__body">
          {skills.length === 0 ? (
            <p className="settings-hint">{t("agent.skills.empty")}</p>
          ) : (
            <ul className="agent-list">
              {skills.map((s) => (
                <li
                  key={s.name + (s.path ?? "")}
                  className={`agent-list__item ${s.enabled ? "" : "agent-list__item--muted"}`}
                >
                  <span className="agent-list__name">{s.displayName ?? s.name}</span>
                  {s.scope && (
                    <span className="agent-list__badge">{scopeLabel(s.scope, t)}</span>
                  )}
                  <span
                    className={`agent-list__status ${
                      s.enabled ? "agent-list__status--on" : "agent-list__status--off"
                    }`}
                  >
                    {s.enabled ? t("agent.status.enabled") : t("agent.status.disabled")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {/* MCP 连接器列表 */}
      <details className="agent-section">
        <summary className="agent-section__title">
          {t("agent.mcp.title", { n: servers.length })}
        </summary>
        <div className="agent-section__body">
          {servers.length === 0 ? (
            <p className="settings-hint">
              {t("agent.mcp.empty.before")} <code>应用数据目录/pi/config.toml</code> {t("agent.mcp.empty.between")} <code>[mcp_servers.*]</code> {t("agent.mcp.empty.after")}
            </p>
          ) : (
            <ul className="agent-list">
              {servers.map((s) => (
                <li
                  key={s.name}
                  className={`agent-list__item ${s.enabled ? "" : "agent-list__item--muted"}`}
                >
                  <span className="agent-list__name">{s.name}</span>
                  {s.transport && (
                    <span className="agent-list__badge">{s.transport}</span>
                  )}
                  {s.source && (
                    <span className="agent-list__badge">{scopeLabel(s.source, t)}</span>
                  )}
                  <span
                    className={`agent-list__status ${
                      s.enabled ? "agent-list__status--on" : "agent-list__status--off"
                    }`}
                  >
                    {s.enabled ? t("agent.status.enabled") : t("agent.status.disabled")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {/* Slash 命令 */}
      <details className="agent-section">
        <summary className="agent-section__title">
          {t("agent.commands.title", { n: commands.length })}
        </summary>
        <div className="agent-section__body">
          {commands.length === 0 ? (
            <p className="settings-hint">{t("agent.commands.empty")}</p>
          ) : (
            <ul className="agent-list">
              {commands.map((c) => (
                <li key={c.name} className="agent-list__item">
                  <code className="agent-list__name">/{c.name}</code>
                  {c.source && (
                    <span className="agent-list__badge">{c.source}</span>
                  )}
                  {c.description && (
                    <span className="agent-list__desc">{c.description}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {/* 运行时配置：子代理深度 + Web 搜索 (off until the host serves them, see RUNTIME_CONFIG_AVAILABLE) */}
      {RUNTIME_CONFIG_AVAILABLE && <details className="agent-section" open>
        <summary className="agent-section__title">{t("agent.runtime.title")}</summary>
        <div className="agent-section__body">
          {/* 子代理嵌套深度 */}
          <div className="agent-runtime-row">
            <div className="agent-runtime-row__label">
              <span className="agent-runtime-row__name">{t("agent.runtime.depth.name")}</span>
              <span className="agent-runtime-row__hint">
                {t("agent.runtime.depth.hint", { depth: subagentDepth })}
              </span>
            </div>
            <div className="agent-runtime-row__control">
              <input
                type="number"
                min={1}
                max={10}
                className="settings-input settings-input--narrow"
                value={subagentDraft}
                onChange={(e) => setSubagentDraft(e.target.value)}
                disabled={savingRuntime}
              />
              <button
                className="settings-btn"
                onClick={saveSubagentDepth}
                disabled={savingRuntime || subagentDraft === String(subagentDepth)}
              >
                {savingRuntime ? t("agent.runtime.save.saving") : t("agent.runtime.save")}
              </button>
            </div>
          </div>

          {/* Web 搜索开关 */}
          <div className="agent-runtime-row">
            <div className="agent-runtime-row__label">
              <span className="agent-runtime-row__name">{t("agent.runtime.websearch.name")}</span>
              <span className="agent-runtime-row__hint">
                {t("agent.runtime.websearch.hint.before")}
                {webSearchEnabled ? (
                  <span>{webSearchModel ? t("agent.runtime.websearch.current", { model: webSearchModel }) : t("agent.runtime.websearch.current.unset")}</span>
                ) : (
                  <span>{t("agent.runtime.websearch.current.off")}</span>
                )}
                {t("agent.runtime.websearch.hint.after")}
              </span>
            </div>
            <div className="agent-runtime-row__control">
              <input
                type="text"
                className="settings-input"
                placeholder={t("agent.runtime.websearch.placeholder")}
                value={webSearchDraftModel}
                onChange={(e) => setWebSearchDraftModel(e.target.value)}
                disabled={savingRuntime}
              />
              {webSearchEnabled ? (
                <button
                  className="settings-btn settings-btn--danger"
                  onClick={() => saveWebSearch(false)}
                  disabled={savingRuntime}
                >
                  {t("agent.runtime.websearch.off")}
                </button>
              ) : (
                <button
                  className="settings-btn"
                  onClick={() => saveWebSearch(true)}
                  disabled={savingRuntime || !webSearchDraftModel.trim()}
                >
                  {t("agent.runtime.websearch.on")}
                </button>
              )}
            </div>
          </div>

          {runtimeMsg && (
            <p className="settings-msg settings-msg--info">{runtimeMsg}</p>
          )}
        </div>
      </details>}

      <p className="settings-hint">
        {t("agent.footer.hint")}
      </p>
    </SectionShell>
  );
}

function scopeLabel(scope: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  switch (scope) {
    case "user":
      return t("agent.scope.user");
    case "local":
      return t("agent.scope.local");
    case "repo":
    case "project":
      return t("agent.scope.project");
    case "server":
      return t("agent.scope.server");
    case "bundled":
    case "builtin":
      return t("agent.scope.builtin");
    case "plugin":
      return t("agent.scope.plugin");
    default:
      return scope;
  }
}
