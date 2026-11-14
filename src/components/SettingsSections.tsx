import { useAgentModelStore } from "@/stores/agent-model-store";
import { appConfirm } from "./AppDialog";
/**
 * Settings 面板的各个真实分区。
 *
 * 这些是 SettingsPanel.tsx 里除了"模型"以外的真实实现，替代之前的
 * "该分区即将上线"占位。每个分区对接 OpenBuddy 已有的能力：
 *  - personalize: 主题（接 ThemeProvider）+ 字号
 *  - shortcuts: 快捷键说明（纯展示 + localStorage 自定义）
 *  - memory: 资料库入口（接 memory_list + memory_rewrite）
 *  - help: 帮助 + 反馈入口（含 agent 内核信息）
 *  - security: 安全中心（权限规则入口 + folder trust 说明）
 *  - data: 数据管理（清理会话/缓存 + 打开 agent 目录）
 *  - general: 系统设置（cwd/工作目录 + 重启 agent）
 *  - account: 账户（agent auth 状态）
 *  - agent-settings / assistant: 引导到对应面板
 */
import { useCallback, useEffect, useState } from "react";
import {
  Sun,
  Moon,
  Type,
  Folder,
  Trash2,
  ExternalLink,
  RefreshCw,
  Shield,
  Database,
  Key,
  Mail,
  CheckCheck,
  Filter,
  Rows3,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { useUiPrefs } from "@/stores/ui-prefs-store";
import {
  accountGetApiKey,
  accountSetApiKey,
  agentsDefaultsGet,
  agentsDefaultsSave,
  commandsList,
  agentAuthStatus,
  internalReload,
  mcpList,
  memoryFlush,
  memoryRewrite,
  notificationClear,
  notificationList,
  notificationMarkAllRead,
  notificationMarkRead,
  permissionList,
  providersList,
  flattenModels,
  skillsList,
  subagentsConfigGet,
  subagentsConfigSave,
  webSearchConfigGet,
  webSearchConfigSave,
  type AuthStatus,
  type ModelOptionRow,
} from "@/lib/agent-client";
import type {
  AgentDefaults,
  McpServerEntry,
  NotificationEntry,
  NotificationKind,
  PermissionRule,
  SkillInfo,
  SlashCommand,
} from "@/lib/types";

const FONT_KEY = "openbuddy.fontSize";
const SHORTCUTS_KEY = "openbuddy.shortcuts";

const DEFAULT_SHORTCUTS: { key: string; action: string }[] = [
  { key: "Ctrl/Cmd + N", action: "新建任务" },
  { key: "Ctrl/Cmd + K", action: "搜索会话" },
  { key: "Ctrl/Cmd + ,", action: "打开设置" },
  { key: "Ctrl/Cmd + B", action: "切换侧栏" },
  { key: "Ctrl/Cmd + Enter", action: "发送消息" },
  { key: "Shift + Enter", action: "换行" },
  { key: "Esc", action: "停止生成 / 关闭对话框" },
  { key: "/ ", action: "触发技能/命令补全" },
  { key: "@ ", action: "引用对话文件" },
];

function SectionShell({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

// ---------- 个性化 ----------

export function PersonalizeSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const conciseMode = useUiPrefs((s) => s.conciseMode);
  const setPrefs = useUiPrefs((s) => s.setPrefs);
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem(FONT_KEY);
    return saved ? Number(saved) : 13;
  });

  useEffect(() => {
    localStorage.setItem(FONT_KEY, String(fontSize));
    document.documentElement.style.setProperty("--openbuddy-font-size", `${fontSize}px`);
    document.body.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  return (
    <SectionShell
      title="个性化"
      desc="调整外观和字号。主题切换立即生效，字号应用到整个界面。"
    >
      <div className="settings-row">
        <div className="settings-row__label">
          {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
          <span>主题</span>
        </div>
        <div className="settings-row__control theme-toggle">
          <button
            className={`theme-toggle__btn ${theme === "light" ? "theme-toggle__btn--active" : ""}`}
            onClick={() => setTheme("light")}
          >
            <Sun size={14} /> 浅色
          </button>
          <button
            className={`theme-toggle__btn ${theme === "dark" ? "theme-toggle__btn--active" : ""}`}
            onClick={() => setTheme("dark")}
          >
            <Moon size={14} /> 深色
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <Type size={16} />
          <span>字号</span>
          <span className="settings-row__hint">（{fontSize}px）</span>
        </div>
        <div className="settings-row__control">
          <input
            type="range"
            min={11}
            max={18}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
          <button className="settings-reset" onClick={() => setFontSize(13)}>
            重置
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <Rows3 size={16} />
          <span>简洁模式</span>
          <span className="settings-row__hint">回复完成后把思考与工具步骤折叠成一行「已完成 · 用时」，只留最终答案</span>
        </div>
        <div className="settings-row__control">
          <label className="ob-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="简洁模式"
              checked={conciseMode}
              onChange={(e) => setPrefs({ conciseMode: e.target.checked })}
            />
            <span className="ob-switch__track" aria-hidden="true"><span className="ob-switch__thumb" /></span>
          </label>
        </div>
      </div>
    </SectionShell>
  );
}

// ---------- 快捷键 ----------

export function ShortcutsSettingsPanel() {
  const [shortcuts, setShortcuts] = useState<{ key: string; action: string }[]>(() => {
    try {
      const saved = localStorage.getItem(SHORTCUTS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore */
    }
    return DEFAULT_SHORTCUTS;
  });

  useEffect(() => {
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
  }, [shortcuts]);

  return (
    <SectionShell
      title="快捷键"
      desc="OpenBuddy 内置的快捷键。这些值保存在本地，重装会恢复默认。"
    >
      <ul className="shortcuts-list">
        {shortcuts.map((s, i) => (
          <li key={i} className="shortcuts-list__row">
            <span className="shortcuts-list__action">{s.action}</span>
            <kbd className="shortcuts-list__key">{s.key}</kbd>
          </li>
        ))}
      </ul>
      <button
        className="settings-reset"
        onClick={() => setShortcuts(DEFAULT_SHORTCUTS)}
      >
        重置为默认
      </button>
    </SectionShell>
  );
}

// ---------- 记忆 ----------

export function MemorySettingsPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleRewrite = async () => {
    if (!(await appConfirm({ title: "让 agent 用 LLM 重写所有记忆？" }))) return;
    setBusy(true);
    try {
      await memoryRewrite();
      setMsg("已触发重写，稍后在「更多/资料库」查看");
    } catch (e) {
      setMsg(`失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const handleFlush = async () => {
    setBusy(true);
    try {
      await memoryFlush();
      setMsg("已落盘");
    } catch (e) {
      setMsg(`失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="记忆"
      desc="agent 跨会话记忆的维护。记忆文件存在 应用数据目录/pi/memory/。"
    >
      <p className="settings-hint">
        agent 在对话中自动学习并写入 <code>MEMORY.md</code>。
        在侧栏「更多 / 资料库」可以查看和编辑具体内容。
      </p>
      <div className="settings-actions">
        <button className="settings-btn" onClick={handleFlush} disabled={busy}>
          <Database size={14} /> 强制落盘
        </button>
        <button className="settings-btn" onClick={handleRewrite} disabled={busy}>
          <RefreshCw size={14} /> LLM 重写
        </button>
      </div>
      {msg && <p className="settings-msg">{msg}</p>}
    </SectionShell>
  );
}

// ---------- 帮助与反馈 ----------

export function HelpSettingsPanel() {
  return (
    <SectionShell title="帮助与反馈" desc="常用链接和资源。">
      <ul className="help-list">
        <li>
          <ExternalLink size={14} />
          <a href="#" onClick={(e) => e.preventDefault()}>
            OpenBuddy 文档
          </a>
          <span className="help-list__hint">（即将上线）</span>
        </li>
        <li>
          <ExternalLink size={14} />
          <a
            href="https://github.com/badlogic/pi-mono/"
            target="_blank"
            rel="noreferrer"
          >
            Pi SDK 文档
          </a>
        </li>
        <li>
          <ExternalLink size={14} />
          <span>
            引擎包：<code>@earendil-works/pi-coding-agent</code>
          </span>
        </li>
      </ul>
      <p className="settings-hint">
        遇到问题？请检查：
        <br />
        1. API Key 是否已在「账户管理」或「模型」中配置
        <br />
        2. 「模型」tab 是否配置了至少一个 provider
        <br />
        3. 重启 OpenBuddy 后再试
      </p>
    </SectionShell>
  );
}

// ---------- 安全中心 ----------

export function SecuritySettingsPanel() {
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    permissionList()
      .then(setRules)
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SectionShell
      title="安全中心"
      desc="工具执行权限规则。在 Composer 底部的「默认权限」可以编辑。"
    >
      <div className="settings-row">
        <div className="settings-row__label">
          <Shield size={16} />
          <span>已配置规则</span>
        </div>
        <div className="settings-row__control">
          {loading ? "加载中…" : `${rules.length} 条`}
        </div>
      </div>
      {rules.length > 0 && (
        <ul className="rules-list">
          {rules.map((r, i) => (
            <li key={i} className={`rules-list__item rules-list__item--${r.action}`}>
              <span className="rules-list__action">{r.action}</span>
              <span className="rules-list__tool">{r.tool}</span>
              {r.pattern && <span className="rules-list__pattern">{r.pattern}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="settings-hint">
        agent 评估顺序：<code>deny</code> &gt; <code>ask</code> &gt; <code>allow</code>。
        修改需重启 agent 生效。
      </p>
    </SectionShell>
  );
}

// ---------- 数据管理 ----------

export function DataSettingsPanel() {
  const [agentHome, setAgentHome] = useState("");

  useEffect(() => {
    // 从环境推断 agent home 路径（前端无直接 API，给提示用）
    setAgentHome("应用数据目录/pi");
  }, []);

  const handleClearSessions = async () => {
    if (
      !(await appConfirm({
        title: "清理本地会话缓存？",
        message: "这只影响侧栏列表的显示，应用数据目录 pi/sessions/ 中的历史不会被删除。",
        confirmLabel: "清理",
        danger: true,
      }))
    ) {
      return;
    }
    localStorage.removeItem("openbuddy-state.json");
    alert("已清理。下次刷新会重新加载会话列表。");
  };

  return (
    <SectionShell title="数据管理" desc="本地缓存和 agent 数据目录。">
      <div className="settings-row">
        <div className="settings-row__label">
          <Folder size={16} />
          <span>agent 数据目录</span>
        </div>
        <div className="settings-row__control">
          <code>{agentHome}</code>
        </div>
      </div>
      <div className="settings-actions">
        <button
          className="settings-btn settings-btn--danger"
          onClick={handleClearSessions}
        >
          <Trash2 size={14} /> 清理本地会话缓存
        </button>
      </div>
      <p className="settings-hint">
        完全删除历史会话请在侧栏右键单个会话选「删除」。
      </p>
    </SectionShell>
  );
}

// ---------- 系统设置 ----------

export function GeneralSettingsPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleReload = async (kind: "mcp_all" | "skills" | "models") => {
    setBusy(true);
    try {
      await internalReload(kind);
      setMsg(`已触发 ${kind} 热重载`);
    } catch (e) {
      setMsg(`失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="系统设置"
      desc="热重载 agent 的配置视图。修改 config.toml 后无需重启整个应用。"
    >
      <div className="settings-actions">
        <button className="settings-btn" onClick={() => handleReload("mcp_all")} disabled={busy}>
          <RefreshCw size={14} /> 重载 MCP
        </button>
        <button className="settings-btn" onClick={() => handleReload("skills")} disabled={busy}>
          <RefreshCw size={14} /> 重载技能
        </button>
        <button className="settings-btn" onClick={() => handleReload("models")} disabled={busy}>
          <RefreshCw size={14} /> 重载模型
        </button>
      </div>
      {msg && <p className="settings-msg">{msg}</p>}
    </SectionShell>
  );
}

// ---------- 账户 ----------

export function AccountSettingsPanel() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // API key editor state.
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, k] = await Promise.all([
        agentAuthStatus().catch(() => null),
        accountGetApiKey().catch(() => null),
      ]);
      setAuth(a);
      setApiKey(k);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSaveKey = async () => {
    setBusy(true);
    try {
      await accountSetApiKey(keyDraft.trim() || null);
      setMsg(keyDraft.trim() ? "API Key 已保存" : "API Key 已清除");
      setEditingKey(false);
      setKeyDraft("");
      reload();
    } catch (e) {
      setMsg(`保存失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClearKey = async () => {
    if (!(await appConfirm({ title: "确定清除 xAI API Key？", confirmLabel: "清除", danger: true }))) return;
    setBusy(true);
    try {
      await accountSetApiKey(null);
      setMsg("API Key 已清除");
      reload();
    } catch (e) {
      setMsg(`清除失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const maskedKey = apiKey ? maskKey(apiKey) : null;

  return (
    <SectionShell
      title="API Key 管理"
      desc="xAI API Key（BYOK 认证）。无需浏览器登录 x.ai；设置 Key 或在「模型」tab 配置 BYOK provider 即可使用。"
    >
      {loading ? (
        <p className="settings-hint">加载中…</p>
      ) : (
        <>
          {/* BYOK providers */}
          {auth && auth.providers.length > 0 && (
            <div className="settings-row">
              <div className="settings-row__label">
                <span>BYOK 模型</span>
              </div>
              <div className="settings-row__control">
                <code>{auth.providers.join(", ")}</code>
              </div>
            </div>
          )}

          {/* API Key 管理 */}
          <div className="account-section">
            <h4 className="account-section__title">xAI API Key</h4>
            {!editingKey ? (
              <div className="settings-row">
                <div className="settings-row__label">
                  <Key size={16} />
                  <span>当前 Key</span>
                </div>
                <div className="settings-row__control">
                  {maskedKey ? (
                    <code>{showKey ? apiKey : maskedKey}</code>
                  ) : (
                    <span className="settings-warn">未设置</span>
                  )}
                  {maskedKey && (
                    <button
                      className="settings-reset"
                      onClick={() => setShowKey((v) => !v)}
                    >
                      {showKey ? "隐藏" : "显示"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="account-key-editor">
                <input
                  type="password"
                  className="account-key-editor__input"
                  placeholder="xai-..."
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  autoFocus
                />
                <div className="account-key-editor__actions">
                  <button
                    className="btn btn--ghost"
                    onClick={() => {
                      setEditingKey(false);
                      setKeyDraft("");
                    }}
                    disabled={busy}
                  >
                    取消
                  </button>
                  <button
                    className="btn btn--primary"
                    onClick={handleSaveKey}
                    disabled={busy}
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
            {!editingKey && (
              <div className="settings-actions">
                <button
                  className="settings-btn"
                  onClick={() => {
                    setKeyDraft(apiKey ?? "");
                    setEditingKey(true);
                  }}
                  disabled={busy}
                >
                  {apiKey ? "更换" : "设置"} API Key
                </button>
                {apiKey && (
                  <button
                    className="settings-btn settings-btn--danger"
                    onClick={handleClearKey}
                    disabled={busy}
                  >
                    清除
                  </button>
                )}
              </div>
            )}
            <p className="settings-hint">
              API Key 存在 <code>应用数据目录/pi/config</code>，并设置
              <code>XAI_API_KEY</code> 环境变量。BYOK 模型在「模型」tab 配置。
            </p>
          </div>

          {msg && <p className="settings-msg">{msg}</p>}

          {!auth?.ready && (
            <p className="settings-hint">
              未就绪。请设置 xAI API Key，或在「模型」tab 配置 BYOK provider。
            </p>
          )}
        </>
      )}
    </SectionShell>
  );
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

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

// ---------- 助理设置 ----------

const PERMISSION_OPTIONS: { value: string; label: string }[] = [
  { value: "ask", label: "审批模式（每次询问）" },
  { value: "auto", label: "自动模式（高风险操作询问）" },
  { value: "always-approve", label: "始终允许" },
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

// ---------- 智能体邮箱（会话通知中心）----------

const KIND_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "permission", label: "权限请求" },
  { key: "folder_trust", label: "文件夹信任" },
  { key: "task_update", label: "任务更新" },
  { key: "plan_mode", label: "计划模式" },
  { key: "mcp_status", label: "MCP 状态" },
  { key: "models_update", label: "模型更新" },
  { key: "summary", label: "会话标题" },
  { key: "session_complete", label: "会话完成" },
  { key: "error", label: "错误" },
];

/** AgentMailSettingsPanel — 智能体邮箱（重新定义为会话通知中心）。
 *
 *  WorkBuddy 的 agentMail 是腾讯邮箱集成（无 agent 对应）。OpenBuddy 把它
 *  重新定义为 agent 事件的通知收件箱：权限请求、文件夹信任、任务更新、
 *  plan 模式切换、MCP 状态、模型更新、会话完成等所有事件都会记到这里。
 *  用户可浏览/筛选/标记已读/清空。
 *
 *  数据存在 应用数据目录/pi/openbuddy-notifications.json（最多 200 条 FIFO）。
 *  写入由 App.tsx 的事件订阅回调触发（notificationAppend）。 */
export function AgentMailSettingsPanel() {
  const [entries, setEntries] = useState<NotificationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await notificationList());
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleMarkRead = useCallback(
    async (id: number) => {
      await notificationMarkRead(id);
      reload();
    },
    [reload],
  );

  const handleMarkAllRead = useCallback(async () => {
    await notificationMarkAllRead();
    reload();
  }, [reload]);

  const handleClear = useCallback(async () => {
    if (!(await appConfirm({ title: "确定清空所有通知？", confirmLabel: "清空", danger: true }))) return;
    await notificationClear();
    reload();
  }, [reload]);

  const filtered = entries.filter(
    (e) => filter === "all" || String(e.kind) === filter,
  );
  const unreadCount = entries.filter((e) => !e.read).length;

  return (
    <SectionShell
      title="智能体邮箱（通知中心）"
      desc="OpenBuddy 收到的所有 agent 事件通知：权限请求、文件夹信任、任务更新、计划模式、MCP 状态、会话完成等。数据存在 应用数据目录/pi/openbuddy-notifications.json。"
    >
      <div className="settings-actions">
        <button className="settings-btn" onClick={reload} disabled={loading}>
          <RefreshCw size={14} /> {loading ? "加载中…" : "刷新"}
        </button>
        <button
          className="settings-btn"
          onClick={handleMarkAllRead}
          disabled={entries.length === 0}
        >
          <CheckCheck size={14} /> 全部已读
        </button>
        <button
          className="settings-btn settings-btn--danger"
          onClick={handleClear}
          disabled={entries.length === 0}
        >
          <Trash2 size={14} /> 清空
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <Mail size={16} />
          <span>未读通知</span>
        </div>
        <div className="settings-row__control">
          <code>{unreadCount}</code> / {entries.length}
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="notification-filters">
        <Filter size={12} />
        {KIND_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`notification-filter ${
              filter === f.key ? "notification-filter--active" : ""
            }`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 通知列表 */}
      <div className="notification-list">
        {filtered.length === 0 && !loading && (
          <div className="notification-empty">
            <Mail size={32} color="var(--wb-text-tertiary)" />
            <p>暂无通知。当 agent 产生事件时（权限请求、任务完成等）会记录到这里。</p>
          </div>
        )}
        {filtered.map((entry) => (
          <div
            key={entry.id}
            className={`notification-row notification-row--${entry.severity} ${
              entry.read ? "notification-row--read" : ""
            }`}
          >
            <div
              className={`notification-row__dot notification-row__dot--${severityToDot(entry.severity)}`}
            />
            <div className="notification-row__body">
              <div className="notification-row__head">
                <span className="notification-row__kind">
                  {kindLabel(entry.kind as NotificationKind)}
                </span>
                <span className="notification-row__title">{entry.title}</span>
                {!entry.read && <span className="notification-row__unread">未读</span>}
              </div>
              {entry.body && (
                <pre className="notification-row__body-text">{entry.body}</pre>
              )}
              <div className="notification-row__meta">
                <span>{formatTime(entry.at)}</span>
                {entry.sessionId && (
                  <span className="notification-row__session">
                    会话 #{entry.sessionId.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
            {!entry.read && (
              <button
                className="notification-row__mark"
                onClick={() => handleMarkRead(entry.id)}
                title="标记已读"
              >
                <CheckCheck size={12} />
              </button>
            )}
          </div>
        ))}
        {loading && <div className="notification-empty">加载中…</div>}
      </div>
    </SectionShell>
  );
}

function kindLabel(kind: NotificationKind | string): string {
  const map: Record<string, string> = {
    permission: "权限请求",
    folder_trust: "文件夹信任",
    task_update: "任务更新",
    plan_mode: "计划模式",
    mcp_status: "MCP 状态",
    models_update: "模型更新",
    summary: "会话标题",
    session_complete: "会话完成",
    error: "错误",
    info: "信息",
  };
  return map[String(kind)] ?? String(kind);
}

function severityToDot(severity: string): string {
  switch (severity) {
    case "error":
      return "error";
    case "warn":
      return "warn";
    default:
      return "info";
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
