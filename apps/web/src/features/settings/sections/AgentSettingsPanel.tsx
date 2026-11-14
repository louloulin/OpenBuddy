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

// ---------- 智能体设置 ----------

/** AgentSettingsPanel — 汇总显示当前智能体配置（skills + MCP + slash 命令）。
 *  数据来自 agent 的 x.ai/skills/config、x.ai/mcp/list、x.ai/commands/list，
 *  与「专家·技能·连接器」面板的数据源相同，但这里是设置视图：只读 + 刷新 +
 *  跳转到对应管理面板。 */
export function AgentSettingsPanel() {
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
        subagentsConfigGet().catch(() => ({ maxDepth: 1 })),
        webSearchConfigGet().catch(() => ({ enabled: false, model: "" })),
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
      setRuntimeMsg(`子代理深度已保存为 ${clamped}（重启 agent 后生效）`);
    } catch (e) {
      setRuntimeMsg(`保存失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setSavingRuntime(false);
    }
  }, [subagentDraft]);

  /** Toggle web search on/off. */
  const saveWebSearch = useCallback(
    async (enable: boolean) => {
      setSavingRuntime(true);
      setRuntimeMsg(null);
      try {
        if (enable && !webSearchDraftModel.trim()) {
          setRuntimeMsg("启用 Web 搜索需要指定一个模型 ID");
          setSavingRuntime(false);
          return;
        }
        await webSearchConfigSave(enable, webSearchDraftModel.trim() || undefined);
        setWebSearchEnabled(enable);
        setWebSearchModel(enable ? webSearchDraftModel.trim() : "");
        setRuntimeMsg(
          enable
            ? `Web 搜索已启用（模型 ${webSearchDraftModel.trim()}，重启 agent 后生效）`
            : "Web 搜索已关闭（重启 agent 后生效）",
        );
      } catch (e) {
        setRuntimeMsg(`保存失败：${String(e).replace(/^Error:\s*/, "")}`);
      } finally {
        setSavingRuntime(false);
      }
    },
    [webSearchDraftModel],
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
      title="智能体设置"
      desc="当前 agent 智能体的配置概览：已加载的技能、MCP 连接器和 slash 命令。数据来自 agent 的 x.ai/skills/config、x.ai/mcp/list、x.ai/commands/list。"
    >
      <div className="settings-actions">
        <button className="settings-btn" onClick={reload} disabled={loading}>
          <RefreshCw size={14} /> {loading ? "加载中…" : "刷新"}
        </button>
      </div>

      {error && <p className="settings-msg settings-msg--warn">加载失败：{error}</p>}

      {/* 汇总统计 */}
      <div className="agent-stats">
        <div className="agent-stats__item">
          <div className="agent-stats__num">{enabledSkills.length}</div>
          <div className="agent-stats__label">启用技能</div>
          {disabledSkills.length > 0 && (
            <div className="agent-stats__sub">+ {disabledSkills.length} 禁用</div>
          )}
        </div>
        <div className="agent-stats__item">
          <div className="agent-stats__num">{enabledServers.length}</div>
          <div className="agent-stats__label">已连接 MCP</div>
          {disabledServers.length > 0 && (
            <div className="agent-stats__sub">+ {disabledServers.length} 禁用</div>
          )}
        </div>
        <div className="agent-stats__item">
          <div className="agent-stats__num">{commands.length}</div>
          <div className="agent-stats__label">slash 命令</div>
          <div className="agent-stats__sub">
            {builtinCommands.length} 内置 · {skillCommands.length} 技能 · {pluginCommands.length} 插件
          </div>
        </div>
      </div>

      {/* 技能列表 */}
      <details className="agent-section" open>
        <summary className="agent-section__title">
          技能（{skills.length}）
        </summary>
        <div className="agent-section__body">
          {skills.length === 0 ? (
            <p className="settings-hint">暂无技能。在「专家·技能·连接器」面板添加。</p>
          ) : (
            <ul className="agent-list">
              {skills.map((s) => (
                <li
                  key={s.name + (s.path ?? "")}
                  className={`agent-list__item ${s.enabled ? "" : "agent-list__item--muted"}`}
                >
                  <span className="agent-list__name">{s.displayName ?? s.name}</span>
                  {s.scope && (
                    <span className="agent-list__badge">{scopeLabel(s.scope)}</span>
                  )}
                  <span
                    className={`agent-list__status ${
                      s.enabled ? "agent-list__status--on" : "agent-list__status--off"
                    }`}
                  >
                    {s.enabled ? "启用" : "禁用"}
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
          MCP 连接器（{servers.length}）
        </summary>
        <div className="agent-section__body">
          {servers.length === 0 ? (
            <p className="settings-hint">
              暂无连接器。编辑 <code>应用数据目录/pi/config.toml</code> 的 <code>[mcp_servers.*]</code> 段。
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
                    <span className="agent-list__badge">{scopeLabel(s.source)}</span>
                  )}
                  <span
                    className={`agent-list__status ${
                      s.enabled ? "agent-list__status--on" : "agent-list__status--off"
                    }`}
                  >
                    {s.enabled ? "启用" : "禁用"}
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
          slash 命令（{commands.length}）
        </summary>
        <div className="agent-section__body">
          {commands.length === 0 ? (
            <p className="settings-hint">暂无命令。</p>
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

      {/* 运行时配置：子代理深度 + Web 搜索 */}
      <details className="agent-section" open>
        <summary className="agent-section__title">运行时配置</summary>
        <div className="agent-section__body">
          {/* 子代理嵌套深度 */}
          <div className="agent-runtime-row">
            <div className="agent-runtime-row__label">
              <span className="agent-runtime-row__name">子代理嵌套深度</span>
              <span className="agent-runtime-row__hint">
                最大子代理派发层级（当前 {subagentDepth}）。深度 1 = 仅顶层派发，
                2 = 子代理可再派发子代理，以此类推。需重启 agent 生效。
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
                {savingRuntime ? "保存中…" : "保存"}
              </button>
            </div>
          </div>

          {/* Web 搜索开关 */}
          <div className="agent-runtime-row">
            <div className="agent-runtime-row__label">
              <span className="agent-runtime-row__name">Web 搜索</span>
              <span className="agent-runtime-row__hint">
                启用后 agent 可调用 web_search 工具联网搜索。需指定搜索模型 ID
                （{webSearchEnabled ? (
                  <span>当前：{webSearchModel || "未设置"}</span>
                ) : (
                  <span>当前：关闭</span>
                )}）。需重启 agent 生效。
              </span>
            </div>
            <div className="agent-runtime-row__control">
              <input
                type="text"
                className="settings-input"
                placeholder="搜索模型 ID，如 grok-3"
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
                  关闭
                </button>
              ) : (
                <button
                  className="settings-btn"
                  onClick={() => saveWebSearch(true)}
                  disabled={savingRuntime || !webSearchDraftModel.trim()}
                >
                  启用
                </button>
              )}
            </div>
          </div>

          {runtimeMsg && (
            <p className="settings-msg settings-msg--info">{runtimeMsg}</p>
          )}
        </div>
      </details>

      <p className="settings-hint">
        管理（启用/禁用/增删）在主界面「专家·技能·连接器」面板。修改后点刷新查看最新状态。
      </p>
    </SectionShell>
  );
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "user":
      return "用户";
    case "local":
      return "本地";
    case "repo":
    case "project":
      return "项目";
    case "server":
      return "服务器";
    case "bundled":
    case "builtin":
      return "内置";
    case "plugin":
      return "插件";
    default:
      return scope;
  }
}
