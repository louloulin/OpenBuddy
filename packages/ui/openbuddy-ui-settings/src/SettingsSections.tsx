/**
 * Settings 面板的各个真实分区。
 *
 * 这些是 SettingsPanel.tsx 里除了"模型"以外的真实实现。每个分区对接
 * OpenBuddy 已有的能力：
 *  - personalize: 主题（接 ThemeProvider）+ 字号
 *  - shortcuts: 快捷键说明（纯展示 + localStorage 自定义）
 *  - help: 帮助 + 反馈入口（含 pi 内核信息）
 *  - security: 安全中心（权限规则入口 + folder trust 说明）
 *  - data: 数据管理（清理会话/缓存 + 打开 pi 目录）
 *  - general: 系统设置（cwd/工作目录 + 重启 pi）
 *  - account: 账户（pi auth 状态）
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
} from "lucide-react";
import { useTheme, useThemeSnapshot } from "@openbuddy/ui-theme/client";
import {
  agentsDefaultsGet,
  agentsDefaultsSave,
  agentsList,
  commandsList,
  piAuthStatus,
  internalReload,
  mcpList,
  permissionList,
  providersList,
  flattenModels,
  skillsList,
  type AuthStatus,
  type ModelOptionRow,
} from "@/lib/agent/pi-client";
import {
  casdoorStatus,
  casdoorWorkbenchSummary,
  casdoorLoginCapabilities,
  casdoorLogin,
  casdoorRefresh,
  casdoorLogout,
  casdoorSelectTenant,
  casdoorOpenManagement,
  casdoorSaveConfig,
  casdoorAddUser,
  casdoorUpdateUser,
  casdoorDeleteUser,
  casdoorInviteUser,
  casdoorListAccountLinking,
  casdoorUnlinkAccount,
  casdoorGetOrganization,
  casdoorListUserSessions,
  casdoorDeleteSession,
  casdoorDeleteAllSessions,
  casdoorIntrospectToken,
  casdoorListWebhookSubscriptions,
  casdoorUpdateWebhookSubscriptions,
  CASDOOR_WEBHOOK_EVENT_TYPES,
  casdoorAddRole,
  casdoorUpdateRole,
  casdoorAddPermission,
  casdoorUpdatePermission,
  casdoorDeleteRole,
  casdoorDeletePermission,
  casdoorAddOrganization,
  casdoorUpdateOrganization,
  casdoorDeleteOrganization,
  casdoorAddGroup,
  casdoorUpdateGroup,
  casdoorDeleteGroup,
  casdoorAddRule,
  casdoorAuthorizeResource,
  casdoorUpdateRule,
  casdoorDeleteRule,
  casdoorListAudit,
  casdoorGetTenantPolicy,
  casdoorUpdateTenantPolicy,
  casdoorListTenantAudit,
  casdoorSetMemberRevocation,
  casdoorListMemberRevocations,
  casdoorGatewayHealth,
  casdoorTenantHealth,
  casdoorGetCredits,
  casdoorListCreditLedger,
  casdoorGetAiCapabilities,
  casdoorGetCommercialModelCatalog,
  casdoorDeliverWebhook,
  type CasdoorSessionView,
  type CasdoorWorkbenchSummary,
  type CasdoorAuditEvent,
  type CasdoorWebhookEvent,
  type CasdoorWebhookEventType,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorTenantPolicy } from "@openbuddy/auth-casdoor";
import type { CasdoorMemberRevocation } from "@openbuddy/auth-casdoor";
import type { CasdoorGatewayHealth, CasdoorTenantHealth } from "@openbuddy/auth-casdoor";
import type { CasdoorCreditAccount, CasdoorCreditLedgerEntry } from "@openbuddy/auth-casdoor";
import type { CasdoorAiCapabilities } from "@openbuddy/auth-casdoor";
import type { CasdoorCommercialModelCatalog } from "@openbuddy/auth-casdoor";
import type { CasdoorLoginCapabilities } from "@openbuddy/auth-casdoor";
import {
  casdoorListGroups,
  casdoorListOrganizations,
  casdoorListPermissions,
  casdoorListRoles,
  casdoorListRules,
  casdoorListUsers,
  type CasdoorGroupSummary,
  type CasdoorOrganizationSummary,
  type CasdoorPermissionSummary,
  type CasdoorRoleSummary,
  type CasdoorRuleSummary,
  type CasdoorUserSummary,
} from "@/lib/casdoor/casdoor-client";
import { listen } from "@/lib/platform/electron-api";
import { confirm, invoke } from "@/lib/platform/electron-api";
import type {
  AgentDefaults,
  AgentEntry,
  McpServerEntry,
  PermissionRule,
  SkillInfo,
  SlashCommand,
} from "@openbuddy/shared-types";

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
  // Subscribe to theme changes so the active button highlight tracks the
  // current theme. `useTheme().current()` alone returns a one-shot snapshot
  // that does not re-render this component when the user toggles themes —
  // see fix-renderer-pi-cors-and-theme-switch / A5.
  const themeService = useTheme();
  const theme = useThemeSnapshot((s) => s.current());
  const setTheme = (next: "light" | "dark") => themeService.setTheme(next);
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

// ---------- 关于 ----------

export function HelpSettingsPanel() {
  return (
    <SectionShell title="关于" desc="OpenBuddy 的版本、文档与反馈渠道。">
      <ul className="help-list">
        <li>
          <ExternalLink size={14} />
          <a href="https://github.com/openai/openai-cookbook" target="_blank" rel="noreferrer">
            OpenBuddy / Pi 使用文档
          </a>
        </li>
        <li>
          <ExternalLink size={14} />
          <a
            href="https://agentclientprotocol.com/"
            target="_blank"
            rel="noreferrer"
          >
            ACP 协议规范
          </a>
        </li>
        <li>
          <ExternalLink size={14} />
          <span>
            pi 内核路径：<code>vendor/pi-build</code>（submodule）
          </span>
        </li>
      </ul>
      <p className="settings-hint">
        遇到问题？请检查：
        <br />
        1. <code>~/.pi/auth.json</code> 是否存在（运行过 <code>pi login</code>）
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
        pi 评估顺序：<code>deny</code> &gt; <code>ask</code> &gt; <code>allow</code>。
        修改需重启 pi 生效。
      </p>
    </SectionShell>
  );
}

// ---------- 数据管理 ----------

export function DataSettingsPanel() {
  const [piHome, setPiHome] = useState("");

  useEffect(() => {
    // 从环境推断 pi home 路径（前端无直接 API，给提示用）
    setPiHome("~/.pi");
  }, []);

  const handleClearSessions = async () => {
    if (
      !confirm(
        "确定清理本地会话缓存？这只影响侧栏列表的显示，pi 的 ~/.pi/sessions/ 历史不会被删除。",
      )
    ) {
      return;
    }
    await invoke("agent:session-metadata-clear");
    alert("已清理。下次刷新会重新加载会话列表。");
  };

  return (
    <SectionShell title="数据管理" desc="本地缓存和 pi 数据目录。">
      <div className="settings-row">
        <div className="settings-row__label">
          <Folder size={16} />
          <span>pi 数据目录</span>
        </div>
        <div className="settings-row__control">
          <code>{piHome}</code>
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
      desc="热重载 pi 的配置视图。修改 config.toml 后无需重启整个应用。"
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
  const [casdoor, setCasdoor] = useState<CasdoorSessionView | null>(null);
  const [casdoorSummary, setCasdoorSummary] = useState<CasdoorWorkbenchSummary | null>(null);
  const [loginCapabilities, setLoginCapabilities] = useState<CasdoorLoginCapabilities | null>(null);
  const [credits, setCredits] = useState<CasdoorCreditAccount | null>(null);
  const [creditLedger, setCreditLedger] = useState<CasdoorCreditLedgerEntry[]>([]);
  const [aiCapabilities, setAiCapabilities] = useState<CasdoorAiCapabilities | { configured: false } | null>(null);
  const [commercialCatalog, setCommercialCatalog] = useState<CasdoorCommercialModelCatalog | { configured: false } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"default" | "sms" | "wechat" | "refresh" | "logout" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCasdoorConfig, setShowCasdoorConfig] = useState(false);
  const [casdoorDraft, setCasdoorDraft] = useState({ issuer: "", clientId: "", redirectUri: "", smsProviderHint: "", wechatProviderHint: "" });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c, summary, capabilities] = await Promise.all([
        piAuthStatus().catch(() => null),
        casdoorStatus().catch(() => null),
        casdoorWorkbenchSummary().catch(() => null),
        casdoorLoginCapabilities().catch(() => null),
      ]);
      setAuth(a);
      setCasdoor(c);
      setCasdoorSummary(summary);
      setLoginCapabilities(capabilities);
      if (c?.status === "signed_in" && c.tenantContext.activeTenantId) {
        const [account, ledger, capabilities, catalog] = await Promise.all([casdoorGetCredits().catch(() => null), casdoorListCreditLedger(20).catch(() => []), casdoorGetAiCapabilities().catch(() => null), casdoorGetCommercialModelCatalog().catch(() => null)]);
        setCredits(account);
        setCreditLedger(ledger);
        setAiCapabilities(capabilities);
        setCommercialCatalog(catalog);
      } else {
        setCredits(null);
        setCreditLedger([]);
        setAiCapabilities(null);
        setCommercialCatalog(null);
      }
      if (c) setCasdoorDraft({ issuer: c.config.issuer, clientId: c.config.clientId === "configured" ? "" : c.config.clientId, redirectUri: c.config.redirectUri, smsProviderHint: c.config.smsProviderHint, wechatProviderHint: c.config.wechatProviderHint });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let revocationUnlisten: (() => void) | undefined;
    void listen<CasdoorSessionView>("casdoor://auth", (event) => {
      if (!disposed) {
        setCasdoor(event.payload);
        void casdoorWorkbenchSummary().then(setCasdoorSummary).catch(() => undefined);
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    void listen<{ tenantId: string; subject: string; revoked: boolean; reason: string | null; at: string }>("casdoor://member-revocation", (event) => {
      if (disposed || !event.payload) return;
      if (event.payload.revoked) setMessage(`成员 ${event.payload.subject} 已被撤销访问（${event.payload.reason ?? "请查看审计"}）`);
      else setMessage(`成员 ${event.payload.subject} 已恢复访问`);
      void reload();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else revocationUnlisten = cleanup;
    });
    let webhookUnlisten: (() => void) | undefined;
    void listen<{ type: string; action: string; organization: string; impacted: string[]; at: string }>("casdoor://casdoor-webhook", (event) => {
      if (disposed || !event.payload) return;
      setMessage(`Casdoor webhook：${event.payload.type}.${event.payload.action} (${event.payload.organization}) 影响 ${event.payload.impacted.length} 项`);
      void reload();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else webhookUnlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
      revocationUnlisten?.();
      webhookUnlisten?.();
    };
  }, []);

  const [gatewayHealth, setGatewayHealth] = useState<CasdoorGatewayHealth | { configured: false } | null>(null);
  const [tenantHealth, setTenantHealth] = useState<CasdoorTenantHealth | { configured: false } | null>(null);
  const loadGatewayHealth = useCallback(async () => {
    setAdminError(null);
    try {
      const [gw, tn] = await Promise.all([casdoorGatewayHealth(), casdoorTenantHealth()]);
      setGatewayHealth(gw);
      setTenantHealth(tn);
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    }
  }, []);

  const login = useCallback(async (provider: "default" | "sms" | "wechat") => {
    setBusy(provider);
    setMessage(null);
    try {
      const result = await casdoorLogin(provider);
      if (!result.ok) setMessage(result.error);
      else setMessage(provider === "default" ? "已打开 Casdoor 企业登录页面" : provider === "sms" ? "已打开 Casdoor 短信登录页面" : "已打开 Casdoor 微信登录页面");
      await reload();
    } catch (error) {
      setMessage(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  }, [reload]);

  const logout = useCallback(async () => {
    setBusy("logout");
    setMessage(null);
    try {
      await casdoorLogout();
      await reload();
      setMessage("已退出企业账户");
    } catch (error) {
      setMessage(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  }, [reload]);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setMessage(null);
    try {
      await casdoorRefresh();
      await reload();
      setMessage("企业会话已刷新");
    } catch (error) {
      setMessage(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  }, [reload]);

  const selectTenant = useCallback(async (tenantId: string) => {
    if (!tenantId || tenantId === casdoor?.tenantContext.activeTenantId) return;
    setBusy("refresh");
    setMessage(null);
    try {
      const next = await casdoorSelectTenant(tenantId);
      setCasdoor(next);
      setMessage(`已切换到租户 ${tenantId}`);
      await reload();
    } catch (error) {
      setMessage(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  }, [casdoor?.tenantContext.activeTenantId, reload]);

  const openManagement = useCallback(async () => {
    try {
      await casdoorOpenManagement();
    } catch (error) {
      setMessage(String(error).replace(/^Error:\s*/, ""));
    }
  }, []);


  const [admin, setAdmin] = useState<{
    organizations: CasdoorOrganizationSummary[];
    users: CasdoorUserSummary[];
    roles: CasdoorRoleSummary[];
    permissions: CasdoorPermissionSummary[];
    groups: CasdoorGroupSummary[];
    rules: CasdoorRuleSummary[];
  } | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminAction, setAdminAction] = useState<string | null>(null);
  const [audit, setAudit] = useState<CasdoorAuditEvent[] | null>(null);
  const [tenantPolicy, setTenantPolicy] = useState<CasdoorTenantPolicy | null>(null);
  const [tenantPolicyDraft, setTenantPolicyDraft] = useState({ status: "active" as CasdoorTenantPolicy["status"], maxResources: "10000", modelAllowlist: "", mcpAllowlist: "", killSwitch: false, maxTokensPerDay: "", newApiGroup: "" });
  const [tenantAudit, setTenantAudit] = useState<CasdoorAuditEvent[] | null>(null);
  const [memberRevocations, setMemberRevocations] = useState<CasdoorMemberRevocation[] | null>(null);
  const [memberRevocationDraft, setMemberRevocationDraft] = useState({ subject: "", reason: "" });
  const [userDraft, setUserDraft] = useState({ name: "", displayName: "", email: "", phone: "" });
  const [inviteDraft, setInviteDraft] = useState({ email: "", role: "", group: "", hoursValid: "72" });
  const [inviteResult, setInviteResult] = useState<{ link?: string; token?: string; expiresAt?: string; email: string } | null>(null);
  const [accountLinking, setAccountLinking] = useState<{ rows: { type?: string; provider?: string; identifier?: string; displayName?: string; linkedAt?: string; enabled?: boolean }[]; owner: string; name: string } | null>(null);
  const [accountLinkingLoading, setAccountLinkingLoading] = useState(false);
  const [accountLinkingError, setAccountLinkingError] = useState<string | null>(null);
  const [accountLinkingAction, setAccountLinkingAction] = useState<string | null>(null);
  const [orgBranding, setOrgBranding] = useState<{ owner: string; name: string; displayName?: string; logo?: string; websiteUrl?: string; favicon?: string } | null>(null);
  const [orgBrandingLoading, setOrgBrandingLoading] = useState(false);
  const [sessions, setSessions] = useState<{ rows: { sessionId?: string; application?: string; deviceName?: string; ip?: string; createdAt?: string; expiresAt?: string; isOnline?: boolean }[]; owner: string; name: string } | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionAction, setSessionAction] = useState<string | null>(null);
  const [bulkSessionLoading, setBulkSessionLoading] = useState(false);
  const [securityCenterLoading, setSecurityCenterLoading] = useState(false);
  const [introspectInput, setIntrospectInput] = useState("");
  const [introspectResult, setIntrospectResult] = useState<{ active: boolean; sub?: string; username?: string; clientId?: string; scope?: string; exp?: number; iat?: number; tokenType?: string } | null>(null);
  const [introspectLoading, setIntrospectLoading] = useState(false);
  const [webhookSubscriptions, setWebhookSubscriptions] = useState<{ eventTypes: CasdoorWebhookEventType[]; source: "default-all" | "explicit" } | null>(null);
  const [webhookSubscriptionsLoading, setWebhookSubscriptionsLoading] = useState(false);
  const [webhookSubscriptionsSaving, setWebhookSubscriptionsSaving] = useState(false);
  const [roleDraft, setRoleDraft] = useState({ name: "", displayName: "", users: "", groups: "", roles: "", isEnabled: true });
  const [permissionDraft, setPermissionDraft] = useState({ name: "", displayName: "", users: "", groups: "", roles: "", model: "", resourceType: "", resources: "", actions: "read", effect: "allow", isEnabled: true });
  const [organizationDraft, setOrganizationDraft] = useState({ name: "", displayName: "", websiteUrl: "", disableSignin: false });
  const [groupDraft, setGroupDraft] = useState({ name: "", displayName: "", users: "", manager: "", contactEmail: "", type: "", parentId: "", isEnabled: true });
  const [ruleDraft, setRuleDraft] = useState({ name: "", type: "IP", action: "Deny", value: "", statusCode: "", reason: "" });
  const [ruleSimDraft, setRuleSimDraft] = useState({ subject: "", object: "", action: "read" });
  const [ruleSimResult, setRuleSimResult] = useState<{ allowed: boolean; ranAt: string; request: { subject: string; object: string; action: string } } | null>(null);
  const [ruleSimRunning, setRuleSimRunning] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const listValues = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
  const editKey = (kind: string, owner: string, name: string) => `${kind}:${owner}/${name}`;

  const loadAdminOverview = useCallback(async () => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      const [organizations, users, roles, permissions, groups, rules] = await Promise.all([
        casdoorListOrganizations(),
        casdoorListUsers(),
        casdoorListRoles(),
        casdoorListPermissions(),
        casdoorListGroups(),
        casdoorListRules(),
      ]);
      setAdmin({ organizations, users, roles, permissions, groups, rules });
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setAdminError(null);
    try {
      setAudit(await casdoorListAudit());
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    }
  }, []);

  const loadTenantPolicy = useCallback(async () => {
    try {
      const policy = await casdoorGetTenantPolicy();
      setTenantPolicy(policy);
      setTenantPolicyDraft({ status: policy.status, maxResources: String(policy.maxResources), modelAllowlist: policy.modelAllowlist?.join(", ") ?? "", mcpAllowlist: policy.mcpAllowlist?.join(", ") ?? "", killSwitch: policy.killSwitch === true, maxTokensPerDay: policy.maxTokensPerDay === undefined ? "" : String(policy.maxTokensPerDay), newApiGroup: policy.newApiGroup ?? "" });
    } catch (error) {
      setTenantPolicy(null);
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    }
  }, []);

  const saveTenantPolicy = useCallback(async () => {
    const maxResources = Number(tenantPolicyDraft.maxResources);
    if (!Number.isInteger(maxResources) || maxResources < 1) {
      setAdminError("租户资源配额必须是正整数");
      return;
    }
    setAdminAction("tenant-policy");
    setAdminError(null);
    try {
      const modelAllowlist = tenantPolicyDraft.modelAllowlist.split(",").map((item) => item.trim()).filter(Boolean);
      const mcpAllowlist = tenantPolicyDraft.mcpAllowlist.split(",").map((item) => item.trim()).filter(Boolean);
      const maxTokensPerDay = tenantPolicyDraft.maxTokensPerDay.trim() === "" ? undefined : Number(tenantPolicyDraft.maxTokensPerDay);
      if (maxTokensPerDay !== undefined && (!Number.isInteger(maxTokensPerDay) || maxTokensPerDay < 0)) {
        setAdminError("每日 token 配额必须是非负整数");
        return;
      }
      const newApiGroup = tenantPolicyDraft.newApiGroup.trim();
      if (newApiGroup && !/^[a-zA-Z0-9_.:-]{1,120}$/.test(newApiGroup)) {
        setAdminError("New API Group 只能包含字母、数字、下划线、点、冒号和连字符");
        return;
      }
      const policy = await casdoorUpdateTenantPolicy({ expectedVersion: tenantPolicy?.version, status: tenantPolicyDraft.status, maxResources, modelAllowlist, mcpAllowlist, killSwitch: tenantPolicyDraft.killSwitch, ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(newApiGroup ? { newApiGroup } : { newApiGroup: "" }) });
      setTenantPolicy(policy);
      setTenantPolicyDraft({ status: policy.status, maxResources: String(policy.maxResources), modelAllowlist: policy.modelAllowlist?.join(", ") ?? "", mcpAllowlist: policy.mcpAllowlist?.join(", ") ?? "", killSwitch: policy.killSwitch === true, maxTokensPerDay: policy.maxTokensPerDay === undefined ? "" : String(policy.maxTokensPerDay), newApiGroup: policy.newApiGroup ?? "" });
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [tenantPolicy, tenantPolicyDraft]);

  const loadTenantAudit = useCallback(async () => {
    setAdminError(null);
    try {
      setTenantAudit(await casdoorListTenantAudit(50));
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    }
  }, []);

  const adminOwner = casdoor?.tenantContext.activeTenantId ?? casdoor?.identity?.owner ?? casdoor?.identity?.organization ?? "built-in";
  const organizationOwner = admin?.organizations[0]?.owner ?? "admin";
  const canTenantGovern = Boolean(casdoor?.identity?.isAdmin || casdoor?.tenantContext.membership?.isTenantAdmin || casdoor?.tenantContext.membership?.tenantPermissions.some((permission) => ["tenant.policy.read", "tenant.policy.write", "tenant.audit.read", "tenant.settings.read", "tenant.settings.write"].includes(permission)));
  const canTenantLifecycle = Boolean(casdoor?.identity?.isAdmin || casdoor?.tenantContext.membership?.tenantPermissions.includes("tenant.lifecycle.write"));
  const canManageUsers = Boolean(casdoor?.identity?.isAdmin || casdoor?.tenantContext.membership?.isTenantAdmin || casdoor?.tenantContext.membership?.tenantPermissions.some((permission) => ["tenant.users.read", "tenant.users.write"].includes(permission)));

  const deliverTestWebhook = useCallback(async () => {
    setAdminError(null);
    try {
      const event: CasdoorWebhookEvent = { type: "user", action: "update", organization: adminOwner, user: "test-user" };
      await casdoorDeliverWebhook(event);
      await reload();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    }
  }, [adminOwner, reload]);

  const loadMemberRevocations = useCallback(async () => {
    setAdminError(null);
    try {
      const list = await casdoorListMemberRevocations();
      setMemberRevocations(list);
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
      setMemberRevocations(null);
    }
  }, []);

  const toggleUser = useCallback(async (user: CasdoorUserSummary) => {
    setAdminAction(`user:${user.name}`);
    setAdminError(null);
    try {
      const revoked = !user.isForbidden;
      const subject = `${user.owner}/${user.name}`;
      let revocation: Awaited<ReturnType<typeof casdoorSetMemberRevocation>> | null = null;
      if (user.owner === casdoor?.tenantContext.activeTenantId) {
        revocation = await casdoorSetMemberRevocation(subject, revoked, user.isForbidden ? "Casdoor 账户恢复" : "Casdoor 管理台禁用");
      }
      try {
        await casdoorUpdateUser({ owner: user.owner, name: user.name, isForbidden: revoked });
      } catch (error) {
        if (revocation?.configured) await casdoorSetMemberRevocation(subject, !revoked, "回滚 Casdoor 成员变更");
        throw error;
      }
      await loadAdminOverview();
      if (memberRevocations) await loadMemberRevocations();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [casdoor?.tenantContext.activeTenantId, loadAdminOverview, loadMemberRevocations, memberRevocations]);

  const revokeMember = useCallback(async (subject: string, reason: string) => {
    setAdminAction(`member-revoke:${subject}`);
    setAdminError(null);
    try {
      await casdoorSetMemberRevocation(subject, true, reason.trim() || "Casdoor 管理台撤销");
      await loadMemberRevocations();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadMemberRevocations]);

  const restoreMember = useCallback(async (subject: string) => {
    setAdminAction(`member-restore:${subject}`);
    setAdminError(null);
    try {
      await casdoorSetMemberRevocation(subject, false);
      await loadMemberRevocations();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadMemberRevocations]);

  const editUser = useCallback((user: CasdoorUserSummary) => {
    setEditing(editKey("user", user.owner, user.name));
    setUserDraft({ name: user.name, displayName: user.displayName ?? "", email: user.email ?? "", phone: user.phone ?? "" });
  }, []);

  const saveUser = useCallback(async (user: CasdoorUserSummary) => {
    setAdminAction(`user-save:${user.name}`);
    setAdminError(null);
    try {
      await casdoorUpdateUser({ owner: user.owner, name: user.name, displayName: userDraft.displayName.trim() || undefined, email: userDraft.email.trim() || undefined, phone: userDraft.phone.trim() || undefined, groups: user.groups ?? [] });
      setEditing(null);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview, userDraft]);

  const createUser = useCallback(async () => {
    if (!userDraft.name.trim()) return setAdminError("用户名不能为空");
    if (!userDraft.displayName.trim() && !userDraft.email.trim() && !userDraft.phone.trim()) return setAdminError("新用户至少需要显示名、邮箱或手机号");
    setAdminAction("user-add");
    setAdminError(null);
    try {
      await casdoorAddUser({
        owner: adminOwner,
        name: userDraft.name.trim(),
        displayName: userDraft.displayName.trim() || undefined,
        email: userDraft.email.trim() || undefined,
        phone: userDraft.phone.trim() || undefined,
      });
      setUserDraft({ name: "", displayName: "", email: "", phone: "" });
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [adminOwner, loadAdminOverview, userDraft]);

  const deleteUser = useCallback(async (user: CasdoorUserSummary) => {
    if (user.owner === "built-in" && user.name === "admin") return setAdminError("不能删除 Casdoor 内置管理员");
    if (!window.confirm(`确认删除用户 ${user.owner}/${user.name}？`)) return;
    setAdminAction(`user-delete:${user.name}`);
    setAdminError(null);
    try {
      await casdoorDeleteUser(user.owner, user.name);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview]);

  const inviteUser = useCallback(async () => {
    if (!canManageUsers) return setAdminError("当前租户没有 users.write 权限");
    const email = inviteDraft.email.trim();
    if (!email) return setAdminError("邀请邮箱不能为空");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setAdminError("邀请邮箱格式不合法");
    const owner = adminOwner.trim();
    if (!owner) return setAdminError("当前租户没有可邀请的 Casdoor 组织");
    setAdminAction("user-invite");
    setAdminError(null);
    setInviteResult(null);
    try {
      const hours = Number.parseInt(inviteDraft.hoursValid, 10);
      const result = await casdoorInviteUser({
        owner,
        email,
        role: inviteDraft.role.trim() || undefined,
        group: inviteDraft.group.trim() || undefined,
        hoursValid: Number.isFinite(hours) && hours > 0 ? hours : undefined,
      });
      setInviteResult({ email, link: result.link, token: result.token, expiresAt: result.expiresAt });
      setInviteDraft({ email: "", role: inviteDraft.role, group: inviteDraft.group, hoursValid: inviteDraft.hoursValid });
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [adminOwner, canManageUsers, inviteDraft, loadAdminOverview]);

  const loadAccountLinking = useCallback(async () => {
    const owner = adminOwner.trim();
    const userName = casdoorSummary?.identity?.subject.split("/").pop() ?? casdoor?.identity?.subject.split("/").pop() ?? "";
    if (!owner || !userName) {
      setAccountLinking(null);
      return;
    }
    setAccountLinkingLoading(true);
    setAccountLinkingError(null);
    try {
      const rows = await casdoorListAccountLinking(owner, userName);
      setAccountLinking({ rows, owner, name: userName });
    } catch (error) {
      setAccountLinkingError(String(error).replace(/^Error:\s*/, ""));
      setAccountLinking(null);
    } finally {
      setAccountLinkingLoading(false);
    }
  }, [adminOwner, casdoorSummary, casdoor?.identity?.subject]);

  const unlinkAccount = useCallback(async (option: { type?: string; identifier?: string }) => {
    if (!canManageUsers) return setAdminError("当前租户没有 users.write 权限");
    if (!accountLinking) return;
    const type = option.type?.trim() ?? "";
    const identifier = option.identifier?.trim() ?? "";
    if (!type || !identifier) return setAdminError("解绑请求缺少 type / identifier");
    if (!window.confirm(`确认解绑 ${type} 凭据 ${identifier}？`)) return;
    setAccountLinkingAction(`${type}:${identifier}`);
    setAdminError(null);
    try {
      await casdoorUnlinkAccount({ owner: accountLinking.owner, name: accountLinking.name, type, identifier });
      await loadAccountLinking();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAccountLinkingAction(null);
    }
  }, [accountLinking, canManageUsers, loadAccountLinking]);

  const loadOrgBranding = useCallback(async () => {
    const owner = adminOwner.trim();
    if (!owner) return;
    setOrgBrandingLoading(true);
    try {
      const branding = await casdoorGetOrganization(owner, owner);
      setOrgBranding({ owner, name: branding.name, displayName: branding.displayName, logo: branding.logo, websiteUrl: branding.websiteUrl, favicon: branding.favicon });
    } catch (error) {
      setOrgBranding(null);
      void error;
    } finally {
      setOrgBrandingLoading(false);
    }
  }, [adminOwner]);
  const loadSessions = useCallback(async () => {
    const owner = adminOwner.trim();
    const userName = casdoorSummary?.identity?.subject.split("/").pop() ?? casdoor?.identity?.subject.split("/").pop() ?? "";
    if (!owner || !userName) {
      setSessions(null);
      return;
    }
    setSessionsLoading(true);
    setAdminError(null);
    try {
      const rows = await casdoorListUserSessions(owner, userName);
      setSessions({ rows, owner, name: userName });
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
      setSessions(null);
    } finally {
      setSessionsLoading(false);
    }
  }, [adminOwner, casdoorSummary, casdoor?.identity?.subject]);

  const revokeSession = useCallback(async (sessionId: string | undefined) => {
    if (!sessionId) return;
    if (!canManageUsers) return setAdminError("当前租户没有 users.write 权限");
    if (!sessions) return;
    if (!window.confirm(`确认强制下线 session ${sessionId}？`)) return;
    setSessionAction(sessionId);
    setAdminError(null);
    try {
      await casdoorDeleteSession({ owner: sessions.owner, name: sessions.name, sessionId });
      await loadSessions();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setSessionAction(null);
    }
  }, [sessions, canManageUsers, loadSessions]);

  const revokeAllSessions = useCallback(async () => {
    if (!canManageUsers || !sessions) return;
    if (!window.confirm("确认下线当前用户的全部 Casdoor Session？此操作可能也会使当前设备退出，需要重新登录。")) return;
    setBulkSessionLoading(true);
    setAdminError(null);
    try {
      const result = await casdoorDeleteAllSessions(sessions.owner, sessions.name);
      await loadSessions();
      if (result.failed > 0) setAdminError(`批量下线完成：成功 ${result.revoked} 个，失败 ${result.failed} 个。`);
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setBulkSessionLoading(false);
    }
  }, [sessions, canManageUsers, loadSessions]);

  const introspectToken = useCallback(async () => {
    const token = introspectInput.trim();
    if (!token) return setAdminError("introspection 需要粘贴一个 access_token / refresh_token");
    if (!canManageUsers) return setAdminError("当前租户没有 users.read 权限");
    setIntrospectLoading(true);
    setAdminError(null);
    try {
      const result = await casdoorIntrospectToken({ token, tokenTypeHint: "access_token" });
      setIntrospectResult(result);
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
      setIntrospectResult(null);
    } finally {
      setIntrospectLoading(false);
    }
  }, [introspectInput, canManageUsers]);

  const loadWebhookSubscriptions = useCallback(async () => {
    const tenantId = adminOwner.trim();
    if (!tenantId) return;
    setWebhookSubscriptionsLoading(true);
    setAdminError(null);
    try {
      const result = await casdoorListWebhookSubscriptions(tenantId);
      setWebhookSubscriptions({ eventTypes: result.eventTypes, source: result.source });
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
      setWebhookSubscriptions(null);
    } finally {
      setWebhookSubscriptionsLoading(false);
    }
  }, [adminOwner]);

  const toggleWebhookSubscription = useCallback(async (eventType: CasdoorWebhookEventType) => {
    const tenantId = adminOwner.trim();
    if (!tenantId || !webhookSubscriptions) return;
    const eventTypes = webhookSubscriptions.eventTypes.includes(eventType)
      ? webhookSubscriptions.eventTypes.filter((value) => value !== eventType)
      : [...webhookSubscriptions.eventTypes, eventType];
    setWebhookSubscriptionsSaving(true);
    setAdminError(null);
    try {
      const result = await casdoorUpdateWebhookSubscriptions({ tenantId, eventTypes });
      setWebhookSubscriptions({ eventTypes: result.eventTypes, source: result.source });
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setWebhookSubscriptionsSaving(false);
    }
  }, [adminOwner, webhookSubscriptions]);

  const loadSecurityCenter = useCallback(async () => {
    setSecurityCenterLoading(true);
    setAdminError(null);
    try {
      await Promise.all([loadAccountLinking(), loadSessions(), loadWebhookSubscriptions()]);
    } finally {
      setSecurityCenterLoading(false);
    }
  }, [loadAccountLinking, loadSessions, loadWebhookSubscriptions]);


  const simulateRule = useCallback(async () => {
    const subject = ruleSimDraft.subject.trim();
    const object = ruleSimDraft.object.trim();
    const action = ruleSimDraft.action.trim();
    if (!subject) return setAdminError("模拟匹配：subject 不能为空（填写形如 built-in/alice）");
    if (!object) return setAdminError("模拟匹配：object 不能为空（填写资源 ID，如 project:readme）");
    if (!action) return setAdminError("模拟匹配：action 不能为空（read / write / delete）");
    setRuleSimRunning(true);
    setAdminError(null);
    try {
      const allowed = await casdoorAuthorizeResource({ resource: object, resourceId: object, action });
      setRuleSimResult({ allowed, ranAt: new Date().toISOString(), request: { subject, object, action } });
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setRuleSimRunning(false);
    }
  }, [ruleSimDraft]);

  const createRole = useCallback(async () => {
    if (!roleDraft.name.trim()) return setAdminError("角色名称不能为空");
    setAdminAction("role");
    setAdminError(null);
    try {
      await casdoorAddRole({
        owner: adminOwner,
        name: roleDraft.name.trim(),
        displayName: roleDraft.displayName.trim() || roleDraft.name.trim(),
        users: roleDraft.users.split(",").map((value) => value.trim()).filter(Boolean),
        isEnabled: roleDraft.isEnabled,
      });
      setRoleDraft({ name: "", displayName: "", users: "", groups: "", roles: "", isEnabled: true });
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [adminOwner, loadAdminOverview, roleDraft]);

  const editRole = useCallback((role: CasdoorRoleSummary) => {
    setEditing(editKey("role", role.owner, role.name));
    setRoleDraft({ name: role.name, displayName: role.displayName ?? "", users: (role.users ?? role.subUsers ?? []).join(", "), groups: (role.groups ?? []).join(", "), roles: (role.roles ?? role.subRoles ?? []).join(", "), isEnabled: role.isEnabled !== false });
  }, []);

  const saveRole = useCallback(async (role: CasdoorRoleSummary) => {
    setAdminAction(`role-save:${role.name}`);
    setAdminError(null);
    try {
      await casdoorUpdateRole({ owner: role.owner, name: role.name, displayName: roleDraft.displayName.trim() || role.name, users: listValues(roleDraft.users), groups: listValues(roleDraft.groups), roles: listValues(roleDraft.roles), isEnabled: roleDraft.isEnabled });
      setEditing(null);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview, roleDraft]);

  const createPermission = useCallback(async () => {
    if (!permissionDraft.name.trim()) return setAdminError("权限名称不能为空");
    setAdminAction("permission");
    setAdminError(null);
    try {
      await casdoorAddPermission({
        owner: adminOwner,
        name: permissionDraft.name.trim(),
        displayName: permissionDraft.displayName.trim() || permissionDraft.name.trim(),
        roles: permissionDraft.roles.split(",").map((value) => value.trim()).filter(Boolean),
        resources: permissionDraft.resources.split(",").map((value) => value.trim()).filter(Boolean),
        actions: permissionDraft.actions.split(",").map((value) => value.trim()).filter(Boolean),
        effect: permissionDraft.effect,
        isEnabled: permissionDraft.isEnabled,
      });
      setPermissionDraft({ name: "", displayName: "", users: "", groups: "", roles: "", model: "", resourceType: "", resources: "", actions: "read", effect: "allow", isEnabled: true });
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [adminOwner, loadAdminOverview, permissionDraft]);

  const editPermission = useCallback((permission: CasdoorPermissionSummary) => {
    setEditing(editKey("permission", permission.owner, permission.name));
    setPermissionDraft({ name: permission.name, displayName: permission.displayName ?? "", users: (permission.users ?? []).join(", "), groups: (permission.groups ?? []).join(", "), roles: (permission.roles ?? []).join(", "), model: permission.model ?? "", resourceType: permission.resourceType ?? "", resources: (permission.resources ?? []).join(", "), actions: (permission.actions ?? []).join(", "), effect: permission.effect ?? "allow", isEnabled: permission.isEnabled !== false });
  }, []);

  const savePermission = useCallback(async (permission: CasdoorPermissionSummary) => {
    setAdminAction(`permission-save:${permission.name}`);
    setAdminError(null);
    try {
      await casdoorUpdatePermission({ owner: permission.owner, name: permission.name, displayName: permissionDraft.displayName.trim() || permission.name, users: listValues(permissionDraft.users), groups: listValues(permissionDraft.groups), roles: listValues(permissionDraft.roles), model: permissionDraft.model.trim() || undefined, resourceType: permissionDraft.resourceType.trim() || undefined, resources: listValues(permissionDraft.resources), actions: listValues(permissionDraft.actions), effect: permissionDraft.effect, isEnabled: permissionDraft.isEnabled });
      setEditing(null);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview, permissionDraft]);

  const deleteRole = useCallback(async (role: CasdoorRoleSummary) => {
    if (!window.confirm(`确认删除角色 ${role.owner}/${role.name}？`)) return;
    setAdminAction(`delete-role:${role.name}`);
    setAdminError(null);
    try {
      await casdoorDeleteRole(role.owner, role.name);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview]);

  const deletePermission = useCallback(async (permission: CasdoorPermissionSummary) => {
    if (!window.confirm(`确认删除权限 ${permission.owner}/${permission.name}？`)) return;
    setAdminAction(`delete-permission:${permission.name}`);
    setAdminError(null);
    try {
      await casdoorDeletePermission(permission.owner, permission.name);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview]);

  const createOrganization = useCallback(async () => {
    if (!organizationDraft.name.trim()) return setAdminError("组织名称不能为空");
    setAdminAction("organization");
    setAdminError(null);
    try {
      await casdoorAddOrganization({ owner: organizationOwner, name: organizationDraft.name.trim(), displayName: organizationDraft.displayName.trim() || organizationDraft.name.trim(), websiteUrl: organizationDraft.websiteUrl.trim() || undefined });
      setOrganizationDraft({ name: "", displayName: "", websiteUrl: "", disableSignin: false });
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview, organizationDraft, organizationOwner]);

  const editOrganization = useCallback((organization: CasdoorOrganizationSummary) => {
    setEditing(editKey("organization", organization.owner, organization.name));
    setOrganizationDraft({ name: organization.name, displayName: organization.displayName ?? "", websiteUrl: organization.websiteUrl ?? "", disableSignin: organization.disableSignin === true });
  }, []);

  const saveOrganization = useCallback(async (organization: CasdoorOrganizationSummary) => {
    setAdminAction(`organization-save:${organization.name}`);
    setAdminError(null);
    try {
      await casdoorUpdateOrganization({ owner: organization.owner, name: organization.name, displayName: organizationDraft.displayName.trim() || organization.name, websiteUrl: organizationDraft.websiteUrl.trim() || undefined, disableSignin: organizationDraft.disableSignin });
      setEditing(null);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview, organizationDraft]);

  const deleteOrganization = useCallback(async (organization: CasdoorOrganizationSummary) => {
    if (!window.confirm(`确认删除组织 ${organization.owner}/${organization.name}？`)) return;
    setAdminAction(`delete-organization:${organization.name}`);
    setAdminError(null);
    try {
      await casdoorDeleteOrganization(organization.owner, organization.name);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview]);

  const createGroup = useCallback(async () => {
    if (!groupDraft.name.trim()) return setAdminError("群组名称不能为空");
    setAdminAction("group");
    setAdminError(null);
    try {
      await casdoorAddGroup({ owner: adminOwner, name: groupDraft.name.trim(), displayName: groupDraft.displayName.trim() || groupDraft.name.trim(), users: groupDraft.users.split(",").map((value) => value.trim()).filter(Boolean), isEnabled: true });
      setGroupDraft({ name: "", displayName: "", users: "", manager: "", contactEmail: "", type: "", parentId: "", isEnabled: true });
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [adminOwner, groupDraft, loadAdminOverview]);

  const editGroup = useCallback((group: CasdoorGroupSummary) => {
    setEditing(editKey("group", group.owner, group.name));
    setGroupDraft({ name: group.name, displayName: group.displayName ?? "", users: (group.users ?? []).join(", "), manager: "", contactEmail: "", type: "", parentId: group.parent ?? "", isEnabled: group.isEnabled !== false });
  }, []);

  const saveGroup = useCallback(async (group: CasdoorGroupSummary) => {
    setAdminAction(`group-save:${group.name}`);
    setAdminError(null);
    try {
      await casdoorUpdateGroup({ owner: group.owner, name: group.name, displayName: groupDraft.displayName.trim() || group.name, users: listValues(groupDraft.users), manager: groupDraft.manager.trim() || undefined, contactEmail: groupDraft.contactEmail.trim() || undefined, type: groupDraft.type.trim() || undefined, parentId: groupDraft.parentId.trim() || undefined, isEnabled: groupDraft.isEnabled });
      setEditing(null);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [groupDraft, loadAdminOverview]);

  const deleteGroup = useCallback(async (group: CasdoorGroupSummary) => {
    if (!window.confirm(`确认删除群组 ${group.owner}/${group.name}？`)) return;
    setAdminAction(`delete-group:${group.name}`);
    setAdminError(null);
    try {
      await casdoorDeleteGroup(group.owner, group.name);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview]);

  const createRule = useCallback(async () => {
    if (!ruleDraft.name.trim() || !ruleDraft.value.trim()) return setAdminError("规则名称和表达式不能为空");
    setAdminAction("rule");
    setAdminError(null);
    try {
      await casdoorAddRule({ owner: adminOwner, name: ruleDraft.name.trim(), type: ruleDraft.type, action: ruleDraft.action, expressions: [{ value: ruleDraft.value.trim() }], statusCode: ruleDraft.statusCode ? Number(ruleDraft.statusCode) : undefined, reason: ruleDraft.reason.trim() || undefined });
      setRuleDraft({ name: "", type: "IP", action: "Deny", value: "", statusCode: "", reason: "" });
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [adminOwner, loadAdminOverview, ruleDraft]);

  const editRule = useCallback((rule: CasdoorRuleSummary) => {
    setEditing(editKey("rule", rule.owner, rule.name));
    setRuleDraft({ name: rule.name, type: rule.type ?? "IP", action: rule.action ?? "Deny", value: rule.expressions ?? "", statusCode: rule.statusCode ? String(rule.statusCode) : "", reason: rule.reason ?? "" });
  }, []);

  const saveRule = useCallback(async (rule: CasdoorRuleSummary) => {
    setAdminAction(`rule-save:${rule.name}`);
    setAdminError(null);
    try {
      await casdoorUpdateRule({ owner: rule.owner, name: rule.name, type: ruleDraft.type, action: ruleDraft.action, expressions: [{ value: ruleDraft.value.trim() }], statusCode: ruleDraft.statusCode ? Number(ruleDraft.statusCode) : undefined, reason: ruleDraft.reason.trim() || undefined });
      setEditing(null);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview, ruleDraft]);

  const deleteRule = useCallback(async (rule: CasdoorRuleSummary) => {
    if (!window.confirm(`确认删除规则 ${rule.owner}/${rule.name}？`)) return;
    setAdminAction(`delete-rule:${rule.name}`);
    setAdminError(null);
    try {
      await casdoorDeleteRule(rule.owner, rule.name);
      await loadAdminOverview();
    } catch (error) {
      setAdminError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setAdminAction(null);
    }
  }, [loadAdminOverview]);

  const saveCasdoorConfig = useCallback(async () => {
    setMessage(null);
    try {
      const { clientId, ...configPatch } = casdoorDraft;
      await casdoorSaveConfig(clientId.trim() ? { ...configPatch, clientId: clientId.trim() } : configPatch);
      await reload();
      setShowCasdoorConfig(false);
      setMessage("Casdoor 配置已保存");
    } catch (error) {
      setMessage(String(error).replace(/^Error:\s*/, ""));
    }
  }, [casdoorDraft, reload]);

  return (
    <SectionShell
      title="账户与企业身份"
      desc="管理本地 BYOK 和 Casdoor 企业身份。短信、微信登录由 Casdoor Provider 托管。"
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

          <div className="account-section">
            <p className="settings-hint">
              API Key 由 Pi provider 管理。请在「模型」tab 添加 provider、配置 Base URL 和 API Key。
            </p>
          </div>

          {!auth?.ready && (
            <p className="settings-hint">
              未就绪。请在「模型」tab 配置 Pi provider 和 API Key。
            </p>
          )}

          <div className="account-section">
            <h3>Casdoor 企业登录</h3>
            {casdoorSummary?.status === "signed_in" && casdoorSummary.identity && casdoor ? (
              <>
                <div className="settings-row">
                  <div className="settings-row__label"><span>{casdoorSummary.identity.displayName ?? casdoorSummary.identity.subject}</span><span className="settings-row__hint">{casdoorSummary.identity.email ?? casdoorSummary.identity.phone ?? "已登录"}</span></div>
                  <div className="settings-row__control"><code>{casdoor.provider ?? "Casdoor"}</code></div>
                </div>
                <p className="settings-hint">组织：{casdoorSummary.identity.organizations.length ? casdoorSummary.identity.organizations.join(", ") : "未声明"} · 角色：{casdoorSummary.identity.roles.length ? casdoorSummary.identity.roles.join(", ") : "无"}</p>
                <div className="settings-row">
                  <div className="settings-row__label"><span>当前租户</span><span className="settings-row__hint">权限和管理操作均按当前租户隔离</span></div>
                  <div className="settings-row__control">
                    <select value={casdoor.tenantContext.activeTenantId ?? ""} onChange={(event) => void selectTenant(event.target.value)} disabled={busy !== null || casdoor.tenantContext.availableTenantIds.length === 0}>
                      {casdoor.tenantContext.availableTenantIds.length === 0 ? <option value="">无可用租户</option> : casdoor.tenantContext.availableTenantIds.map((tenantId) => <option key={tenantId} value={tenantId}>{tenantId}</option>)}
                    </select>
                  </div>
                </div>
                <p className="settings-hint">当前租户能力：{casdoor.tenantContext.membership?.capabilities.length ? casdoor.tenantContext.membership.capabilities.join(", ") : "默认拒绝"}</p>
                <p className="settings-hint">租户计费方案：{casdoor.tenantContext.plan ? <><span className="settings-tag" data-testid="casdoor-tenant-plan">{casdoor.tenantContext.plan}</span>{Object.keys(casdoor.tenantContext.plansByTenantId ?? {}).length > 1 ? <span> · 可用方案 {Object.entries(casdoor.tenantContext.plansByTenantId ?? {}).map(([tid, p]) => `${tid}=${p}`).join(", ")}</span> : null}</> : "未配置（请在 Casdoor 后台 Organization → plan 字段设置 free / team / enterprise）"}</p>
                {credits ? (
                  <div className="account-section" data-testid="casdoor-credit-account">
                    <h4>OpenBuddy 积分账户</h4>
                    <p className="settings-hint">余额：<strong>{credits.balance.toLocaleString()}</strong> 积分 · 可用：{credits.available.toLocaleString()} · 预扣：{credits.reserved.toLocaleString()} · 累计消费：{credits.lifetimeConsumed.toLocaleString()} · 已过期：{credits.lifetimeExpired.toLocaleString()}</p>
                    <p className="settings-hint">积分是 OpenBuddy 商业计费单位；Casdoor Token 只负责身份，New API Token 只负责模型网关，不互相替代。</p>
                    {creditLedger.length > 0 ? <ul className="shortcuts-list">{creditLedger.slice(0, 8).map((entry) => <li key={entry.id} className="shortcuts-list__row"><span className="shortcuts-list__action">{entry.type} · {entry.amount.toLocaleString()} 积分</span><span className="shortcuts-list__key">{entry.model ?? "—"} · {new Date(entry.createdAt).toLocaleString()}{entry.expiresAt ? ` · 有效至 ${new Date(entry.expiresAt).toLocaleString()}` : ""}</span></li>)}</ul> : <p className="settings-hint">暂无积分流水。</p>}
                    {aiCapabilities && !("configured" in aiCapabilities) ? <p className="settings-hint" data-testid="casdoor-ai-capabilities">New API 能力目录：{aiCapabilities.models.length ? aiCapabilities.models.map((model) => `${model.id}（${Object.entries(model.capabilities).filter(([, capability]) => capability.supported).map(([protocol]) => protocol).join(", ") || "未声明"}）`).join("；") : "未返回模型"}</p> : null}
                    {commercialCatalog && !("configured" in commercialCatalog) ? <div data-testid="casdoor-commercial-model-catalog"><p className="settings-hint">商业模型目录（{commercialCatalog.group ?? "默认 Group"}）：{commercialCatalog.models.length ? commercialCatalog.models.map((model) => `${model.id}（${model.sellable ? "可售" : `不可售：${model.reason ?? "未通过门禁"}`}，${model.pricing.inputPointsPerThousand}/${model.pricing.outputPointsPerThousand} 积分/K token${model.grossMarginPercent === undefined ? "" : `，预计毛利 ${model.grossMarginPercent}%`}）`).join("；") : "未返回模型"}</p><p className="settings-hint">可售门禁：能力目录、Chat Completions、真实 usage、供应商成本基线、同币种付费套餐和目标毛利必须全部验证；目录未配置时默认不可售。</p></div> : null}
                  </div>
                ) : casdoor.config.configured ? <p className="settings-hint">企业积分账本未启用：请配置 Resource Gateway；当前不会把 New API 额度误显示为 OpenBuddy 积分。</p> : null}
                <p className="settings-hint" data-testid="casdoor-custom-fields-hint">组织自定义字段</p>
                <p className="settings-hint" data-testid="casdoor-org-branding-hint">租户品牌（白标）：{orgBranding ? <><span className="settings-tag">{orgBranding.displayName ?? orgBranding.name}</span>{orgBranding.logo ? <span> · 已配置 logo（base64 长度 {orgBranding.logo.length}）</span> : null}{orgBranding.websiteUrl ? <span> · 官网 {orgBranding.websiteUrl}</span> : null}</> : (orgBrandingLoading ? "加载中…" : "未配置（请在 Casdoor 后台 Organization → displayName / logo / websiteUrl 字段设置）")} <button type="button" className="settings-reset" onClick={loadOrgBranding} disabled={orgBrandingLoading}>刷新品牌</button></p>
                <p className="settings-hint" data-testid="casdoor-custom-fields-hint-prefix">组织自定义字段：{casdoorSummary.identity.customFields && Object.keys(casdoorSummary.identity.customFields).length > 0 ? <><span className="settings-tag">{Object.keys(casdoorSummary.identity.customFields).length} 个</span>{Object.entries(casdoorSummary.identity.customFields).map(([k, v]) => ` · ${k}=${String(v)}`).join("")}</> : "未配置（请在 Casdoor 后台 Application → Custom signup fields 启用，例如部门 / 工号 / 试用期）"}</p>
                <p className="settings-hint">能力：{casdoorSummary.identity.capabilities.length ? casdoorSummary.identity.capabilities.join(", ") : "默认拒绝（未授予企业能力）"}</p>
                <div className="settings-actions">
                  <button type="button" className="settings-button" onClick={openManagement} disabled={!casdoor.tenantContext.membership?.isTenantAdmin && !casdoorSummary.identity.isAdmin}>打开 Casdoor 管理台</button>
                  <button type="button" className="settings-button" onClick={refresh} disabled={busy !== null}>{busy === "refresh" ? "刷新中…" : "刷新企业会话"}</button>
                  <button type="button" className="settings-button" onClick={logout} disabled={busy !== null}>{busy === "logout" ? "退出中…" : "退出企业账户"}</button>
                </div>
                <div className="account-section">
                  <h3>Casdoor 组织、角色、权限与规则</h3>
                  {canTenantGovern ? (
                    <>
                      <p className="settings-hint">通过 Casdoor 管理 API（<code>get-users / get-organizations / get-roles / get-permissions / get-groups / get-rules</code>）读取当前租户数据；access token 由主进程持有，前端不接触任何凭据。</p>
                      <div className="settings-actions">
                        <button type="button" className="settings-button" onClick={loadAdminOverview} disabled={adminLoading}>{adminLoading ? "加载中…" : "刷新组织概览"}</button>
                        <button type="button" className="settings-button" onClick={loadAudit}>查看授权审计</button>
                      <button type="button" className="settings-button" onClick={loadTenantPolicy}>查看租户治理</button>
                      <button type="button" className="settings-button" onClick={loadTenantAudit}>查看租户审计</button>
                      <button type="button" className="settings-button" onClick={loadMemberRevocations} disabled={!canTenantLifecycle}>{memberRevocations ? "刷新成员撤销名单" : "查看成员撤销名单"}</button>
                      <button type="button" className="settings-button" onClick={loadGatewayHealth}>{gatewayHealth ? "刷新网关健康" : "查看网关健康"}</button>
                      <button type="button" className="settings-button" onClick={deliverTestWebhook} disabled={!canTenantGovern}>模拟 Casdoor webhook</button>
                      <button type="button" className="settings-button" onClick={loadWebhookSubscriptions} disabled={webhookSubscriptionsLoading || !canTenantGovern}>{webhookSubscriptionsLoading ? "加载订阅中…" : "配置 Webhook 订阅"}</button>
                    </div>
                    {adminError && <p className="settings-hint">Casdoor：{adminError}</p>}
                    {gatewayHealth && (
                      <div className="account-section">
                        <h4>企业资源网关健康</h4>
                        {"configured" in gatewayHealth && gatewayHealth.configured === false ? (
                          <p className="settings-hint">未配置 OPENBUDDY_CASDOOR_RESOURCE_API_URL，本地元数据注册表使用中（仅供开发/离线索引）。</p>
                        ) : (
                          <p className="settings-hint">网关状态：{gatewayHealth.ok ? "健康" : "降级"} · 存储：{gatewayHealth.store} · 版本：{gatewayHealth.version} · 延迟：{gatewayHealth.latencyMs}ms{gatewayHealth.error ? ` · 错误：${gatewayHealth.error}` : ""}</p>
                        )}
                      </div>
                    )}
                    {tenantHealth && !("configured" in tenantHealth && tenantHealth.configured === false) && (
                      <div className="account-section">
                        <h4>当前租户健康摘要</h4>
                        <p className="settings-hint">租户：{tenantHealth.tenantId} · 策略：{tenantHealth.policy.status} · 资源配额：{tenantHealth.policy.maxResources} · kill switch：{tenantHealth.policy.killSwitch ? "已开启" : "关闭"} · 今日 token：{tenantHealth.policy.tokensUsedToday}{tenantHealth.policy.maxTokensPerDay === undefined ? "（不限）" : ` / ${tenantHealth.policy.maxTokensPerDay}`} · 模型白名单：{tenantHealth.policy.modelAllowlist} 项 · MCP 白名单：{tenantHealth.policy.mcpAllowlist} 项 · 已撤销成员：{tenantHealth.revokedMembers}</p>
                        <p className="settings-hint">资源分布：{Object.entries(tenantHealth.resources).map(([type, count]) => `${type}=${count}`).join(", ") || "无"} · SIEM：{tenantHealth.siem ? `${tenantHealth.siem.kind}${tenantHealth.siem.endpoint ? ` → ${tenantHealth.siem.endpoint}` : ""}${tenantHealth.siem.filePath ? ` → ${tenantHealth.siem.filePath}` : ""}` : "未启用"}</p>
                      </div>
                    )}
                    {webhookSubscriptions && (
                      <div className="account-section" data-testid="casdoor-webhook-subscriptions">
                        <h4>Webhook 订阅（按事件类型）</h4>
                        <p className="settings-hint">当前租户：{adminOwner} · {webhookSubscriptions.source === "default-all" ? "默认接收全部事件" : "已启用显式过滤"}。关闭事件后，主进程不会把该事件广播到 OpenBuddy renderer；Casdoor → gateway 的签名校验仍保持不变。</p>
                        <div className="settings-fields">
                          {CASDOOR_WEBHOOK_EVENT_TYPES.map((eventType) => (
                            <label key={eventType} className="settings-field">
                              <span>{eventType}</span>
                              <input type="checkbox" checked={webhookSubscriptions.eventTypes.includes(eventType)} onChange={() => void toggleWebhookSubscription(eventType)} disabled={webhookSubscriptionsSaving || !canTenantGovern} />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {tenantPolicy && (
                      <div className="account-section">
                        <h4>租户治理</h4>
                          <p className="settings-hint">状态：{tenantPolicy.status === "active" ? "运行中" : tenantPolicy.status === "archived" ? "已归档" : "已暂停"} · 资源配额：{tenantPolicy.maxResources} · 今日 token：{tenantPolicy.tokensUsedToday ?? 0}{tenantPolicy.maxTokensPerDay === undefined ? "（不限）" : ` / ${tenantPolicy.maxTokensPerDay}`} · 更新：{new Date(tenantPolicy.updatedAt).toLocaleString()}</p>
                          <div className="settings-fields">
                            <label className="settings-field"><span>租户状态</span><select value={tenantPolicyDraft.status} onChange={(event) => setTenantPolicyDraft((draft) => ({ ...draft, status: event.target.value as CasdoorTenantPolicy["status"] }))}><option value="active">运行中</option><option value="suspended">暂停资源访问</option><option value="archived">归档（保留只读审计）</option></select></label>
                            <label className="settings-field"><span>资源配额</span><input type="number" min="1" value={tenantPolicyDraft.maxResources} onChange={(event) => setTenantPolicyDraft((draft) => ({ ...draft, maxResources: event.target.value }))} /></label>
                            <label className="settings-field"><span>模型白名单</span><input value={tenantPolicyDraft.modelAllowlist} onChange={(event) => setTenantPolicyDraft((draft) => ({ ...draft, modelAllowlist: event.target.value }))} placeholder="provider/model, 逗号分隔；留空不限" /></label>
                            <label className="settings-field"><span>MCP 白名单</span><input value={tenantPolicyDraft.mcpAllowlist} onChange={(event) => setTenantPolicyDraft((draft) => ({ ...draft, mcpAllowlist: event.target.value }))} placeholder="server-name, 逗号分隔；留空不限" /></label>
                            <label className="settings-field"><span>每日 token 配额</span><input type="number" min="0" value={tenantPolicyDraft.maxTokensPerDay} onChange={(event) => setTenantPolicyDraft((draft) => ({ ...draft, maxTokensPerDay: event.target.value }))} placeholder="留空不限" /></label>
                            <label className="settings-field"><span>New API Group</span><input value={tenantPolicyDraft.newApiGroup} onChange={(event) => setTenantPolicyDraft((draft) => ({ ...draft, newApiGroup: event.target.value }))} placeholder="例如 enterprise；留空使用网关默认 Group" /></label>
                            <label className="settings-field"><span>运行 kill switch</span><input type="checkbox" checked={tenantPolicyDraft.killSwitch} onChange={(event) => setTenantPolicyDraft((draft) => ({ ...draft, killSwitch: event.target.checked }))} />暂停智能体 Prompt、自动化和团队执行</label>
                          </div>
                          <button type="button" className="settings-button" onClick={saveTenantPolicy} disabled={adminAction !== null}>{adminAction === "tenant-policy" ? "保存中…" : "保存租户治理"}</button>
                        </div>
                      )}
                      {tenantAudit && (
                        <div className="account-section">
                          <p className="settings-hint">集中式租户审计：最近 {tenantAudit.length} 条。</p>
                          {tenantAudit.length > 0 ? <ul className="shortcuts-list">{tenantAudit.slice(0, 10).map((event, index) => <li key={`${event.id ?? event.at}-${index}`} className="shortcuts-list__row"><span className="shortcuts-list__action">{event.event} · {event.outcome}</span><span className="shortcuts-list__key">{event.resource ?? "—"} · {new Date(event.at).toLocaleString()}</span></li>)}</ul> : <p className="settings-hint">当前租户暂无集中式审计事件。</p>}
                        </div>
                      )}
                      {audit && (
                        <div className="account-section">
                          <p className="settings-hint">授权审计：最近 {audit.length} 条；只显示当前租户事件，不记录 access token、refresh token、密码或 Provider secret。</p>
                          {audit.length > 0 ? <ul className="shortcuts-list">{audit.slice(0, 10).map((event) => <li key={event.id} className="shortcuts-list__row"><span className="shortcuts-list__action">{event.event} · {event.outcome}</span><span className="shortcuts-list__key">{event.resource ?? "—"} · {new Date(event.at).toLocaleString()}</span></li>)}</ul> : <p className="settings-hint">当前租户暂无审计事件。</p>}
                        </div>
                      )}
                      {memberRevocations && (
                        <div className="account-section">
                          <h4>成员撤销名单（应急 deny-list）</h4>
                          <p className="settings-hint">仅 <code>tenant.lifecycle.write</code> 或平台管理员可见；保留与 Casdoor 组织并行的紧急撤销，恢复和撤销动作都会被审计。可撤销当前租户任意成员；撤销后 JWT 仍未过期时也会被网关立即拒绝，恢复需要授权管理员操作。</p>
                          {memberRevocations.length === 0 ? (
                            <p className="settings-hint">当前租户没有撤销记录。</p>
                          ) : (
                            <ul className="shortcuts-list">
                              {memberRevocations.map((entry) => (
                                <li key={entry.subject} className="shortcuts-list__row">
                                  <span className="shortcuts-list__action">{entry.subject}</span>
                                  <span className="shortcuts-list__key">撤销于 {new Date(entry.revokedAt ?? Date.now()).toLocaleString()} · 操作人：{entry.revokedBy ?? "—"} {entry.reason ? ` · 原因：${entry.reason}` : ""}</span>
                                  <span className="settings-actions">
                                    <button type="button" className="settings-reset" onClick={() => restoreMember(entry.subject)} disabled={adminAction === `member-restore:${entry.subject}`}>{adminAction === `member-restore:${entry.subject}` ? "恢复中…" : "恢复"}</button>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="settings-fields">
                            <label className="settings-field"><span>撤销成员（owner/name）</span><input value={memberRevocationDraft.subject} onChange={(event) => setMemberRevocationDraft((draft) => ({ ...draft, subject: event.target.value }))} placeholder={`${adminOwner}/username`} /></label>
                            <label className="settings-field"><span>原因</span><input value={memberRevocationDraft.reason} onChange={(event) => setMemberRevocationDraft((draft) => ({ ...draft, reason: event.target.value }))} placeholder="离职 / 安全事件" /></label>
                          </div>
                          <div className="settings-actions">
                            <button type="button" className="settings-button" onClick={() => revokeMember(memberRevocationDraft.subject, memberRevocationDraft.reason)} disabled={!canTenantLifecycle || adminAction !== null || !memberRevocationDraft.subject.trim()}>{adminAction?.startsWith("member-revoke:") ? "撤销中…" : "撤销该成员"}</button>
                          </div>
                        </div>
                      )}
                      {admin && (
                        <div className="account-section">
                          <p className="settings-hint">组织：{admin.organizations.length} · 用户：{admin.users.length} · 角色：{admin.roles.length} · 权限：{admin.permissions.length} · 分组：{admin.groups.length} · 规则：{admin.rules.length}</p>
                          {admin.organizations.length === 0 && admin.users.length === 0 && admin.roles.length === 0 && admin.permissions.length === 0 && admin.groups.length === 0 && admin.rules.length === 0 ? (
                            <p className="settings-hint">Casdoor：当前租户未返回任何组织、用户、角色、权限、规则或分组数据。</p>
                          ) : (
                            <>
                              {admin.organizations.length > 0 && (
                                <>
                                  <p className="settings-hint">组织：{admin.organizations.length} 个</p>
                                  <ul className="shortcuts-list">
                                    {admin.organizations.slice(0, 12).map((organization) => (
                                      <li key={`${organization.owner}/${organization.name}`} className="shortcuts-list__row">
                                        <span className="shortcuts-list__action">{organization.owner}/{organization.name}</span>
                                        <span className="settings-actions"><button type="button" className="settings-reset" onClick={() => editOrganization(organization)}>编辑</button><button type="button" className="settings-reset" onClick={() => deleteOrganization(organization)} disabled={organization.name === "built-in" || adminAction === `delete-organization:${organization.name}`}>{organization.name === "built-in" ? "内置" : adminAction === `delete-organization:${organization.name}` ? "删除中…" : "删除"}</button></span>
                                      </li>
                                    ))}
                                  </ul>
                                  {admin.organizations.filter((organization) => editing === editKey("organization", organization.owner, organization.name)).map((organization) => (
                                    <div key={`edit-${organization.owner}/${organization.name}`} className="account-section"><div className="settings-fields"><label className="settings-field"><span>显示名</span><input value={organizationDraft.displayName} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label><label className="settings-field"><span>网站</span><input value={organizationDraft.websiteUrl} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, websiteUrl: event.target.value }))} /></label><label className="settings-field"><span>禁止登录</span><input type="checkbox" checked={organizationDraft.disableSignin} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, disableSignin: event.target.checked }))} /></label></div><div className="settings-actions"><button type="button" className="settings-button" onClick={() => saveOrganization(organization)} disabled={adminAction !== null}>保存组织</button><button type="button" className="settings-reset" onClick={() => setEditing(null)}>取消</button></div></div>
                                  ))}
                                </>
                              )}
                              {admin.roles.length > 0 && (
                                <>
                                  <p className="settings-hint">角色：{admin.roles.length} 个</p>
                                  <ul className="shortcuts-list">
                                    {admin.roles.slice(0, 12).map((role) => (
                                      <li key={`${role.owner}/${role.name}`} className="shortcuts-list__row">
                                        <span className="shortcuts-list__action">{role.name}{role.displayName ? ` · ${role.displayName}` : ""}</span>
                                        <span className="settings-actions"><button type="button" className="settings-reset" onClick={() => editRole(role)}>编辑</button><button type="button" className="settings-reset" onClick={() => deleteRole(role)} disabled={adminAction === `delete-role:${role.name}`}>{adminAction === `delete-role:${role.name}` ? "删除中…" : "删除"}</button></span>
                                      </li>
                                    ))}
                                  </ul>
                                  {admin.roles.filter((role) => editing === editKey("role", role.owner, role.name)).map((role) => (
                                    <div key={`edit-${role.owner}/${role.name}`} className="account-section"><div className="settings-fields"><label className="settings-field"><span>显示名</span><input value={roleDraft.displayName} onChange={(event) => setRoleDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label><label className="settings-field"><span>用户</span><input value={roleDraft.users} onChange={(event) => setRoleDraft((draft) => ({ ...draft, users: event.target.value }))} /></label><label className="settings-field"><span>群组</span><input value={roleDraft.groups} onChange={(event) => setRoleDraft((draft) => ({ ...draft, groups: event.target.value }))} /></label><label className="settings-field"><span>继承角色</span><input value={roleDraft.roles} onChange={(event) => setRoleDraft((draft) => ({ ...draft, roles: event.target.value }))} /></label><label className="settings-field"><span>启用</span><input type="checkbox" checked={roleDraft.isEnabled} onChange={(event) => setRoleDraft((draft) => ({ ...draft, isEnabled: event.target.checked }))} /></label></div><div className="settings-actions"><button type="button" className="settings-button" onClick={() => saveRole(role)} disabled={adminAction !== null}>保存角色</button><button type="button" className="settings-reset" onClick={() => setEditing(null)}>取消</button></div></div>
                                  ))}
                                </>
                              )}
                              {admin.permissions.length > 0 && (
                                <>
                                  <p className="settings-hint">权限：{admin.permissions.length} 个</p>
                                  <ul className="shortcuts-list">
                                    {admin.permissions.slice(0, 12).map((permission) => (
                                      <li key={`${permission.owner}/${permission.name}`} className="shortcuts-list__row">
                                        <span className="shortcuts-list__action">{permission.name} ({permission.effect ?? "allow"})</span>
                                        <span className="settings-actions"><button type="button" className="settings-reset" onClick={() => editPermission(permission)}>编辑</button><button type="button" className="settings-reset" onClick={() => deletePermission(permission)} disabled={permission.name === "permission-built-in" || adminAction === `delete-permission:${permission.name}`}>{adminAction === `delete-permission:${permission.name}` ? "删除中…" : permission.name === "permission-built-in" ? "内置" : "删除"}</button></span>
                                      </li>
                                    ))}
                                  </ul>
                                  {admin.permissions.filter((permission) => editing === editKey("permission", permission.owner, permission.name)).map((permission) => (
                                    <div key={`edit-${permission.owner}/${permission.name}`} className="account-section"><div className="settings-fields"><label className="settings-field"><span>显示名</span><input value={permissionDraft.displayName} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label><label className="settings-field"><span>角色</span><input value={permissionDraft.roles} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, roles: event.target.value }))} /></label><label className="settings-field"><span>用户</span><input value={permissionDraft.users} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, users: event.target.value }))} /></label><label className="settings-field"><span>群组</span><input value={permissionDraft.groups} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, groups: event.target.value }))} /></label><label className="settings-field"><span>资源</span><input value={permissionDraft.resources} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, resources: event.target.value }))} /></label><label className="settings-field"><span>操作</span><input value={permissionDraft.actions} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, actions: event.target.value }))} /></label><label className="settings-field"><span>效果</span><input value={permissionDraft.effect} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, effect: event.target.value }))} /></label><label className="settings-field"><span>启用</span><input type="checkbox" checked={permissionDraft.isEnabled} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, isEnabled: event.target.checked }))} /></label></div><div className="settings-actions"><button type="button" className="settings-button" onClick={() => savePermission(permission)} disabled={adminAction !== null}>保存权限</button><button type="button" className="settings-reset" onClick={() => setEditing(null)}>取消</button></div></div>
                                  ))}
                                </>
                              )}
                              {admin.users.length > 0 && (
                                <>
                                  <p className="settings-hint">用户：{admin.users.length} 个（可在此禁用、恢复或删除账户）</p>
                                  <ul className="shortcuts-list">
                                    {admin.users.slice(0, 12).map((user) => (
                                      <li key={`${user.owner}/${user.name}`} className="shortcuts-list__row">
                                        <span className="shortcuts-list__action">{user.name}{user.isAdmin ? " (admin)" : ""}{user.isForbidden ? " · 已禁用" : ""}</span>
                                        <span className="settings-actions">
                                          <button type="button" className="settings-reset" onClick={() => editUser(user)}>编辑</button>
                                          <button type="button" className="settings-reset" onClick={() => toggleUser(user)} disabled={adminAction === `user:${user.name}` || user.isAdmin}>{adminAction === `user:${user.name}` ? "保存中…" : user.isForbidden ? "恢复" : "禁用"}</button>
                                          <button type="button" className="settings-reset" onClick={() => deleteUser(user)} disabled={user.owner === "built-in" && user.name === "admin" || adminAction === `user-delete:${user.name}`}>{user.owner === "built-in" && user.name === "admin" ? "内置" : adminAction === `user-delete:${user.name}` ? "删除中…" : "删除"}</button>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                  {admin.users.filter((user) => editing === editKey("user", user.owner, user.name)).map((user) => (
                                    <div key={`edit-${user.owner}/${user.name}`} className="account-section"><div className="settings-fields"><label className="settings-field"><span>显示名</span><input value={userDraft.displayName} onChange={(event) => setUserDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label><label className="settings-field"><span>邮箱</span><input value={userDraft.email} onChange={(event) => setUserDraft((draft) => ({ ...draft, email: event.target.value }))} /></label><label className="settings-field"><span>手机号</span><input value={userDraft.phone} onChange={(event) => setUserDraft((draft) => ({ ...draft, phone: event.target.value }))} /></label></div><div className="settings-actions"><button type="button" className="settings-button" onClick={() => saveUser(user)} disabled={adminAction !== null}>保存用户</button><button type="button" className="settings-reset" onClick={() => setEditing(null)}>取消</button></div></div>
                                  ))}
                                </>
                              )}
                              <div className="account-section">
                                <h4>新增用户</h4>
                                <div className="settings-fields">
                                  <label className="settings-field"><span>用户名</span><input value={userDraft.name} onChange={(event) => setUserDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="employee" /></label>
                                  <label className="settings-field"><span>显示名</span><input value={userDraft.displayName} onChange={(event) => setUserDraft((draft) => ({ ...draft, displayName: event.target.value }))} placeholder="企业成员" /></label>
                                  <label className="settings-field"><span>邮箱</span><input type="email" value={userDraft.email} onChange={(event) => setUserDraft((draft) => ({ ...draft, email: event.target.value }))} placeholder="employee@example.com" /></label>
                                  <label className="settings-field"><span>手机号</span><input value={userDraft.phone} onChange={(event) => setUserDraft((draft) => ({ ...draft, phone: event.target.value }))} placeholder="+86 138…" /></label>
                                </div>
                                <button type="button" className="settings-button" onClick={createUser} disabled={adminAction !== null}>{adminAction === "user-add" ? "创建中…" : "创建用户"}</button>
                              </div>
                              <div className="account-section">
                                <h4>邀请成员（Casdoor 临时链接）</h4>
                                <p className="settings-hint">通过 Casdoor `/api/invite-user` 生成一次性邀请链接，新成员点击后自动加入当前组织。链接默认 72 小时有效，Casdoor 会自动发送邮件（需 SMTP 配置）。</p>
                                <div className="settings-fields">
                                  <label className="settings-field"><span>邮箱</span><input type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft((draft) => ({ ...draft, email: event.target.value }))} placeholder="new-member@example.com" /></label>
                                  <label className="settings-field"><span>默认角色（可选）</span><input value={inviteDraft.role} onChange={(event) => setInviteDraft((draft) => ({ ...draft, role: event.target.value }))} placeholder="built-in/openbuddy-member" /></label>
                                  <label className="settings-field"><span>默认分组（可选）</span><input value={inviteDraft.group} onChange={(event) => setInviteDraft((draft) => ({ ...draft, group: event.target.value }))} placeholder="built-in/engineering" /></label>
                                  <label className="settings-field"><span>有效期（小时）</span><input type="number" min={1} max={720} value={inviteDraft.hoursValid} onChange={(event) => setInviteDraft((draft) => ({ ...draft, hoursValid: event.target.value }))} /></label>
                                </div>
                                <div className="settings-actions">
                                  <button type="button" className="settings-button" onClick={inviteUser} disabled={adminAction !== null || !canManageUsers}>{adminAction === "user-invite" ? "邀请中…" : "生成邀请链接"}</button>
                                  {!canManageUsers && <span className="settings-hint">当前租户缺少 users.write 权限</span>}
                                </div>
                                {inviteResult && (
                                  <div className="account-section" data-testid="casdoor-invite-result">
                                    <h4>最近一次邀请</h4>
                                    <p className="settings-hint">已发送至 {inviteResult.email}。</p>
                                    {inviteResult.expiresAt && <p className="settings-hint">过期时间：{inviteResult.expiresAt}</p>}
                                    {inviteResult.link && (
                                      <label className="settings-field"><span>邀请链接</span>
                                        <input readOnly value={inviteResult.link} onFocus={(event) => event.currentTarget.select()} />
                                      </label>
                                    )}
                                    {!inviteResult.link && inviteResult.token && (
                                      <label className="settings-field"><span>邀请 token（拼接 /signup?token=…）</span>
                                        <input readOnly value={inviteResult.token} onFocus={(event) => event.currentTarget.select()} />
                                      </label>
                                    )}
                                    {!inviteResult.link && !inviteResult.token && <p className="settings-hint">Casdoor 未返回链接或 token，邮件已通过 Casdoor SMTP 发出。</p>}
                                  </div>
                                )}
                              </div>

                              <div className="account-section" data-testid="casdoor-security-center">
                                <h3>账号安全中心</h3>
                                <p className="settings-hint">统一管理当前 Casdoor 账户的登录 Provider、活跃设备、Session 撤销和 Webhook 安全订阅。所有操作仍由主进程执行，并受当前租户权限与作用域保护。</p>
                                <div className="settings-actions">
                                  <button type="button" className="settings-button" onClick={() => void loadSecurityCenter()} disabled={securityCenterLoading}>{securityCenterLoading ? "刷新安全状态中…" : "刷新全部安全状态"}</button>
                                </div>
                                <p className="settings-hint" data-testid="casdoor-security-summary">登录 Provider：{accountLinking ? `${accountLinking.rows.length} 个` : "未加载"} · 活跃 Session：{sessions ? `${sessions.rows.length} 个` : "未加载"} · Webhook：{webhookSubscriptions ? (webhookSubscriptions.source === "default-all" ? "默认全量" : `${webhookSubscriptions.eventTypes.length} 个事件`) : "未加载"}</p>
                              <div className="account-section" data-testid="casdoor-account-linking">
                                <h4>账户绑定（已登录 Provider 列表）</h4>
                                <p className="settings-hint">通过 Casdoor <code>get-account-linking-options</code> 列出当前用户在 Casdoor 端已绑定的所有登录凭据（手机号 / 微信 / GitHub / 邮箱 / 密码等）。解绑走 <code>delete-account-linking-option</code>。新增绑定请走 OIDC 重新登录或 Casdoor 控制台。</p>
                                <div className="settings-actions">
                                  <button type="button" className="settings-button" onClick={loadAccountLinking} disabled={accountLinkingLoading || !canManageUsers}>{accountLinkingLoading ? "加载中…" : "刷新已绑定 Provider"}</button>
                                  {!canManageUsers && <span className="settings-hint">当前租户缺少 users.write 权限，仅可查看</span>}
                                </div>
                                {accountLinkingError && <p className="settings-hint" data-testid="casdoor-account-linking-error">错误：{accountLinkingError}</p>}
                                {accountLinking && (
                                  <ul className="shortcuts-list" data-testid="casdoor-account-linking-list">
                                    {accountLinking.rows.length === 0 && <li className="shortcuts-list__row"><span className="settings-hint">当前用户没有任何额外绑定的 Provider。</span></li>}
                                    {accountLinking.rows.map((option, index) => (
                                      <li key={`${option.type ?? "provider"}-${option.identifier ?? index}`} className="shortcuts-list__row">
                                        <span className="shortcuts-list__action">
                                          {(option.type ?? option.provider ?? "unknown")}{option.identifier ? ` · ${option.identifier}` : ""}{option.displayName ? ` · ${option.displayName}` : ""}{option.enabled === false ? " · 已停用" : ""}{option.linkedAt ? ` · 绑定于 ${option.linkedAt}` : ""}
                                        </span>
                                        <span className="settings-actions">
                                          <button type="button" className="settings-reset" onClick={() => unlinkAccount(option)} disabled={!canManageUsers || !option.type || !option.identifier || accountLinkingAction !== null}>{accountLinkingAction === `${option.type}:${option.identifier}` ? "解绑中…" : "解绑"}</button>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div className="account-section">
                                <h4>活跃 Session 列表（自助强制下线）</h4>
                                <p className="settings-hint">通过 Casdoor <code>get-sessions</code> + <code>delete-session</code> 列出当前用户的所有 OIDC 会话（不同应用 / 设备 / refresh token 都会产生独立 session），并允许用户自助强制下线。与 A2 Backchannel logout 互补：A2 是管理员踢人，本项是用户自我撤销。</p>
                                <div className="settings-actions">
                                  <button type="button" className="settings-button" onClick={loadSessions} disabled={sessionsLoading || !canManageUsers}>{sessionsLoading ? "加载中…" : "刷新活跃 Session"}</button>
                                  <button type="button" className="settings-reset" onClick={() => void revokeAllSessions()} disabled={bulkSessionLoading || sessionsLoading || !canManageUsers || !sessions || sessions.rows.length === 0}>{bulkSessionLoading ? "下线全部中…" : "下线全部 Session"}</button>
                                  {!canManageUsers && <span className="settings-hint">当前租户缺少 users.write 权限，仅可查看</span>}
                                </div>
                                {sessions && (
                                  <ul className="shortcuts-list" data-testid="casdoor-sessions-list">
                                    {sessions.rows.length === 0 && <li className="shortcuts-list__row"><span className="settings-hint">当前用户没有任何活跃 Session。</span></li>}
                                    {sessions.rows.map((row, index) => (
                                      <li key={`${row.sessionId ?? "session"}-${index}`} className="shortcuts-list__row">
                                        <span className="shortcuts-list__action">
                                          {(row.application ?? "unknown")}{row.deviceName ? ` · ${row.deviceName}` : ""}{row.ip ? ` · ${row.ip}` : ""}{row.isOnline === false ? " · 离线" : row.isOnline === true ? " · 在线" : ""}{row.createdAt ? ` · 创建于 ${row.createdAt}` : ""}{row.expiresAt ? ` · 过期于 ${row.expiresAt}` : ""}
                                        </span>
                                        <span className="settings-actions">
                                          <button type="button" className="settings-reset" onClick={() => revokeSession(row.sessionId)} disabled={!canManageUsers || !row.sessionId || sessionAction !== null}>{sessionAction === row.sessionId ? "下线中…" : "强制下线"}</button>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div className="account-section">
                                <h4>Token Introspection（RFC 7662）</h4>
                                <p className="settings-hint">调用 Casdoor <code>/api/introspect</code> 校验 access_token / refresh_token 是否仍然有效（exp / active / scope / sub）。适合排查 admin 在 Casdoor 控制台踢人后本地缓存是否仍误判有效。⚠️ 仅做调试，生产链路请走 OIDC 验签 + JWKS。</p>
                                <div className="settings-fields">
                                  <label className="settings-field"><span>Token</span><textarea value={introspectInput} onChange={(event) => setIntrospectInput(event.target.value)} placeholder="eyJhbGciOi..." rows={3} /></label>
                                </div>
                                <div className="settings-actions">
                                  <button type="button" className="settings-button" onClick={introspectToken} disabled={introspectLoading || !canManageUsers}>{introspectLoading ? "校验中…" : "校验 token"}</button>
                                  {!canManageUsers && <span className="settings-hint">当前租户缺少 users.read 权限</span>}
                                </div>
                                {introspectResult && (
                                  <ul className="shortcuts-list" data-testid="casdoor-introspection-result">
                                    <li className="shortcuts-list__row">
                                      <span className="shortcuts-list__action">active · {String(introspectResult.active)}{introspectResult.sub ? ` · sub=${introspectResult.sub}` : ""}{introspectResult.username ? ` · user=${introspectResult.username}` : ""}{introspectResult.clientId ? ` · client=${introspectResult.clientId}` : ""}{introspectResult.scope ? ` · scope=${introspectResult.scope}` : ""}{introspectResult.tokenType ? ` · type=${introspectResult.tokenType}` : ""}{introspectResult.exp ? ` · exp=${new Date(introspectResult.exp * 1000).toISOString()}` : ""}{introspectResult.iat ? ` · iat=${new Date(introspectResult.iat * 1000).toISOString()}` : ""}</span>
                                    </li>
                                  </ul>
                                )}
                              </div>
                              </div>
                              <div className="account-section">
                                <h4>新增组织</h4>
                                <div className="settings-fields">
                                  <label className="settings-field"><span>名称</span><input value={organizationDraft.name} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="acme" /></label>
                                  <label className="settings-field"><span>显示名</span><input value={organizationDraft.displayName} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, displayName: event.target.value }))} placeholder="Acme 企业" /></label>
                                  <label className="settings-field"><span>网站</span><input value={organizationDraft.websiteUrl} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, websiteUrl: event.target.value }))} placeholder="https://example.com" /></label>
                                </div>
                                <button type="button" className="settings-button" onClick={createOrganization} disabled={adminAction !== null}>{adminAction === "organization" ? "创建中…" : "创建组织"}</button>
                              </div>
                              <div className="account-section">
                                <h4>群组</h4>
                                {admin.groups.length > 0 && <ul className="shortcuts-list">{admin.groups.slice(0, 12).map((group) => <li key={`${group.owner}/${group.name}`} className="shortcuts-list__row"><span className="shortcuts-list__action">{group.name}{group.displayName ? ` · ${group.displayName}` : ""}</span><span className="settings-actions"><button type="button" className="settings-reset" onClick={() => editGroup(group)}>编辑</button><button type="button" className="settings-reset" onClick={() => deleteGroup(group)} disabled={adminAction === `delete-group:${group.name}`}>{adminAction === `delete-group:${group.name}` ? "删除中…" : "删除"}</button></span></li>)}</ul>}
                                {admin.groups.filter((group) => editing === editKey("group", group.owner, group.name)).map((group) => <div key={`edit-${group.owner}/${group.name}`} className="account-section"><div className="settings-fields"><label className="settings-field"><span>显示名</span><input value={groupDraft.displayName} onChange={(event) => setGroupDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label><label className="settings-field"><span>用户</span><input value={groupDraft.users} onChange={(event) => setGroupDraft((draft) => ({ ...draft, users: event.target.value }))} /></label><label className="settings-field"><span>父群组</span><input value={groupDraft.parentId} onChange={(event) => setGroupDraft((draft) => ({ ...draft, parentId: event.target.value }))} /></label><label className="settings-field"><span>负责人</span><input value={groupDraft.manager} onChange={(event) => setGroupDraft((draft) => ({ ...draft, manager: event.target.value }))} /></label><label className="settings-field"><span>启用</span><input type="checkbox" checked={groupDraft.isEnabled} onChange={(event) => setGroupDraft((draft) => ({ ...draft, isEnabled: event.target.checked }))} /></label></div><div className="settings-actions"><button type="button" className="settings-button" onClick={() => saveGroup(group)} disabled={adminAction !== null}>保存群组</button><button type="button" className="settings-reset" onClick={() => setEditing(null)}>取消</button></div></div>)}
                                <div className="settings-fields">
                                  <label className="settings-field"><span>名称</span><input value={groupDraft.name} onChange={(event) => setGroupDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="engineering" /></label>
                                  <label className="settings-field"><span>显示名</span><input value={groupDraft.displayName} onChange={(event) => setGroupDraft((draft) => ({ ...draft, displayName: event.target.value }))} placeholder="工程团队" /></label>
                                  <label className="settings-field"><span>用户（逗号分隔）</span><input value={groupDraft.users} onChange={(event) => setGroupDraft((draft) => ({ ...draft, users: event.target.value }))} placeholder="built-in/user1" /></label>
                                </div>
                                <button type="button" className="settings-button" onClick={createGroup} disabled={adminAction !== null}>{adminAction === "group" ? "创建中…" : "创建群组"}</button>
                              </div>
                              <div className="account-section">
                                <h4>新增角色</h4>
                                <div className="settings-fields">
                                  <label className="settings-field"><span>名称</span><input value={roleDraft.name} onChange={(event) => setRoleDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="openbuddy-member" /></label>
                                  <label className="settings-field"><span>显示名</span><input value={roleDraft.displayName} onChange={(event) => setRoleDraft((draft) => ({ ...draft, displayName: event.target.value }))} placeholder="OpenBuddy 成员" /></label>
                                  <label className="settings-field"><span>用户（逗号分隔）</span><input value={roleDraft.users} onChange={(event) => setRoleDraft((draft) => ({ ...draft, users: event.target.value }))} placeholder="built-in/user1" /></label>
                                </div>
                                <button type="button" className="settings-button" onClick={createRole} disabled={adminAction !== null}>{adminAction === "role" ? "创建中…" : "创建角色"}</button>
                              </div>
                              <div className="account-section" data-testid="casdoor-rule-simulator">
                                <h4>规则模拟匹配（Casbin 调试器）</h4>
                                <p className="settings-hint">输入 <code>(subject, object, action)</code> 三元组，调用主进程 <code>authorizeResourceRemotely</code> 走 Casdoor Enforcer 验证（同时审计登录）。租户管理员无需联系 OpenBuddy 工程师即可自助验证权限规则。</p>
                                <div className="settings-fields">
                                  <label className="settings-field"><span>subject</span><input value={ruleSimDraft.subject} onChange={(event) => setRuleSimDraft((draft) => ({ ...draft, subject: event.target.value }))} placeholder="built-in/alice" /></label>
                                  <label className="settings-field"><span>object（资源或资源 ID）</span><input value={ruleSimDraft.object} onChange={(event) => setRuleSimDraft((draft) => ({ ...draft, object: event.target.value }))} placeholder="project:readme" /></label>
                                  <label className="settings-field"><span>action</span><input value={ruleSimDraft.action} onChange={(event) => setRuleSimDraft((draft) => ({ ...draft, action: event.target.value }))} placeholder="read" /></label>
                                </div>
                                <div className="settings-actions">
                                  <button type="button" className="settings-button" onClick={simulateRule} disabled={ruleSimRunning || !casdoor?.identity?.subject}>{ruleSimRunning ? "匹配中…" : "运行模拟匹配"}</button>
                                  <button type="button" className="settings-reset" onClick={() => { setRuleSimDraft({ subject: "", object: "", action: "read" }); setRuleSimResult(null); }}>重置</button>
                                </div>
                                {ruleSimResult && (
                                  <div className="account-section" data-testid="casdoor-rule-simulator-result">
                                    <h4>最近一次模拟</h4>
                                    <p className="settings-hint">输入：({ruleSimResult.request.subject}, {ruleSimResult.request.object}, {ruleSimResult.request.action})</p>
                                    <p className="settings-hint">执行时间：{ruleSimResult.ranAt}</p>
                                    <p className="settings-hint">判定：{ruleSimResult.allowed ? <span className="settings-tag" data-testid="casdoor-rule-simulator-allow">通过（allow）</span> : <span className="settings-tag" data-testid="casdoor-rule-simulator-deny">拒绝（deny）</span>}</p>
                                  </div>
                                )}
                              </div>
                              <div className="account-section">
                                <h4>新增权限</h4>
                                <div className="settings-fields">
                                  <label className="settings-field"><span>名称</span><input value={permissionDraft.name} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="openbuddy-workspace" /></label>
                                  <label className="settings-field"><span>显示名</span><input value={permissionDraft.displayName} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, displayName: event.target.value }))} placeholder="OpenBuddy 工作区" /></label>
                                  <label className="settings-field"><span>角色（逗号分隔）</span><input value={permissionDraft.roles} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, roles: event.target.value }))} placeholder="built-in/openbuddy-member" /></label>
                                  <label className="settings-field"><span>资源（逗号分隔）</span><input value={permissionDraft.resources} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, resources: event.target.value }))} placeholder="workspace" /></label>
                                  <label className="settings-field"><span>操作（逗号分隔）</span><input value={permissionDraft.actions} onChange={(event) => setPermissionDraft((draft) => ({ ...draft, actions: event.target.value }))} placeholder="read,write" /></label>
                                </div>
                                <button type="button" className="settings-button" onClick={createPermission} disabled={adminAction !== null}>{adminAction === "permission" ? "创建中…" : "创建权限"}</button>
                              </div>
                              {admin.rules.length > 0 ? (
                                <ul className="shortcuts-list">
                                  {admin.rules.slice(0, 10).map((rule) => (
                                    <li key={`${rule.owner}/${rule.name}`} className="shortcuts-list__row">
                                      <span className="shortcuts-list__action">{rule.owner}/{rule.name}</span>
                                      <span className="shortcuts-list__key">{rule.expressions ?? rule.action ?? "—"}</span>
                                      <span className="settings-actions"><button type="button" className="settings-reset" onClick={() => editRule(rule)}>编辑</button><button type="button" className="settings-reset" onClick={() => deleteRule(rule)} disabled={adminAction === `delete-rule:${rule.name}`}>{adminAction === `delete-rule:${rule.name}` ? "删除中…" : "删除"}</button></span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="settings-hint">规则：Casdoor 当前未返回任何规则（目标实例 <code>/rules</code> 页面同样为 "No data"）。规则由 Casdoor 权威维护，OpenBuddy 不在本地复制规则状态。</p>
                              )}
                              {admin.rules.filter((rule) => editing === editKey("rule", rule.owner, rule.name)).map((rule) => <div key={`edit-${rule.owner}/${rule.name}`} className="account-section"><div className="settings-fields"><label className="settings-field"><span>类型</span><input value={ruleDraft.type} onChange={(event) => setRuleDraft((draft) => ({ ...draft, type: event.target.value }))} /></label><label className="settings-field"><span>动作</span><input value={ruleDraft.action} onChange={(event) => setRuleDraft((draft) => ({ ...draft, action: event.target.value }))} /></label><label className="settings-field"><span>表达式</span><input value={ruleDraft.value} onChange={(event) => setRuleDraft((draft) => ({ ...draft, value: event.target.value }))} /></label><label className="settings-field"><span>状态码</span><input type="number" value={ruleDraft.statusCode} onChange={(event) => setRuleDraft((draft) => ({ ...draft, statusCode: event.target.value }))} /></label><label className="settings-field"><span>原因</span><input value={ruleDraft.reason} onChange={(event) => setRuleDraft((draft) => ({ ...draft, reason: event.target.value }))} /></label></div><div className="settings-actions"><button type="button" className="settings-button" onClick={() => saveRule(rule)} disabled={adminAction !== null}>保存规则</button><button type="button" className="settings-reset" onClick={() => setEditing(null)}>取消</button></div></div>)}
                              <div className="account-section">
                                <h4>新增规则</h4>
                                <div className="settings-fields">
                                  <label className="settings-field"><span>名称</span><input value={ruleDraft.name} onChange={(event) => setRuleDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="block-abuse" /></label>
                                  <label className="settings-field"><span>类型</span><input value={ruleDraft.type} onChange={(event) => setRuleDraft((draft) => ({ ...draft, type: event.target.value }))} placeholder="IP" /></label>
                                  <label className="settings-field"><span>动作</span><input value={ruleDraft.action} onChange={(event) => setRuleDraft((draft) => ({ ...draft, action: event.target.value }))} placeholder="Deny" /></label>
                                  <label className="settings-field"><span>表达式</span><input value={ruleDraft.value} onChange={(event) => setRuleDraft((draft) => ({ ...draft, value: event.target.value }))} placeholder="192.0.2.0/24" /></label>
                                  <label className="settings-field"><span>状态码</span><input type="number" value={ruleDraft.statusCode} onChange={(event) => setRuleDraft((draft) => ({ ...draft, statusCode: event.target.value }))} placeholder="403" /></label>
                                  <label className="settings-field"><span>原因</span><input value={ruleDraft.reason} onChange={(event) => setRuleDraft((draft) => ({ ...draft, reason: event.target.value }))} placeholder="blocked by policy" /></label>
                                </div>
                                <button type="button" className="settings-button" onClick={createRule} disabled={adminAction !== null}>{adminAction === "rule" ? "创建中…" : "创建规则"}</button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="settings-hint">当前租户未授予管理权限，无法调用 Casdoor 管理 API。请在 Casdoor 为当前租户授予 <code>tenant.settings.read</code> 或相应的最小权限后重新登录。</p>
                  )}
                </div>
              </>
            ) : casdoor?.status === "configuration_needed" ? (
              <>
                <p className="settings-hint">尚未配置 Casdoor client ID。请填写已在 Casdoor 应用中登记的回调地址；目标实例需要启用 `Verification code` 和 WeChat Provider。</p>
                <button type="button" className="settings-button" onClick={() => setShowCasdoorConfig((value) => !value)}>{showCasdoorConfig ? "收起配置" : "配置 Casdoor"}</button>
                {showCasdoorConfig && (
                  <div className="account-section">
                    <label className="settings-field"><span>Issuer / Server URL</span><input value={casdoorDraft.issuer} onChange={(event) => setCasdoorDraft((draft) => ({ ...draft, issuer: event.target.value }))} placeholder="https://casdoor.example.com" /></label>
                    <label className="settings-field"><span>Application client ID</span><input value={casdoorDraft.clientId} onChange={(event) => setCasdoorDraft((draft) => ({ ...draft, clientId: event.target.value }))} placeholder="Casdoor 应用 clientId" /></label>
                    <label className="settings-field"><span>Redirect URI</span><input value={casdoorDraft.redirectUri} onChange={(event) => setCasdoorDraft((draft) => ({ ...draft, redirectUri: event.target.value }))} placeholder="casdoor://localhost/callback" /></label>
                    <label className="settings-field"><span>短信登录项</span><input value={casdoorDraft.smsProviderHint} onChange={(event) => setCasdoorDraft((draft) => ({ ...draft, smsProviderHint: event.target.value }))} placeholder="Verification code" /></label>
                    <label className="settings-field"><span>微信 Provider</span><input value={casdoorDraft.wechatProviderHint} onChange={(event) => setCasdoorDraft((draft) => ({ ...draft, wechatProviderHint: event.target.value }))} placeholder="Wechat" /></label>
                    <button type="button" className="settings-button" onClick={saveCasdoorConfig}>保存配置</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="settings-hint">未登录企业账户。本地/BYOK 功能仍可正常使用；企业组织、角色和受保护能力默认拒绝。</p>
                {loginCapabilities && (
                  <div className="account-section">
                    <p className="settings-hint">登录能力探测：企业账号 {loginCapabilities.enterprise.enabled ? "已配置" : "未配置"} · 短信 {loginCapabilities.sms.enabled ? "已配置" : "未配置"} · 微信 {loginCapabilities.wechat.enabled ? "已配置" : "未配置"}</p>
                    {!loginCapabilities.enterprise.enabled && <p className="settings-hint">企业账号：{loginCapabilities.enterprise.reason}</p>}
                    {!loginCapabilities.sms.enabled && <p className="settings-hint">短信：{loginCapabilities.sms.reason}</p>}
                    {!loginCapabilities.wechat.enabled && <p className="settings-hint">微信：{loginCapabilities.wechat.reason}</p>}
                  </div>
                )}
                <div className="settings-actions">
                  <button type="button" className="settings-button" onClick={() => login("default")} disabled={busy !== null || casdoor?.config.configured === false}>{busy === "default" ? "打开中…" : "企业账号登录"}</button>
                  <button type="button" className="settings-button" onClick={() => login("sms")} disabled={busy !== null || casdoor?.config.configured === false || loginCapabilities?.sms.enabled !== true}>{busy === "sms" ? "打开中…" : "短信登录"}</button>
                  <button type="button" className="settings-button" onClick={() => login("wechat")} disabled={busy !== null || casdoor?.config.configured === false || loginCapabilities?.wechat.enabled !== true}>{busy === "wechat" ? "打开中…" : "微信登录"}</button>
                </div>
              </>
            )}
            {message && <p className="settings-hint">{message}</p>}
            {casdoor?.error && <p className="settings-hint">Casdoor：{casdoor.error}</p>}
          </div>
        </>
      )}
    </SectionShell>
  );
}

// ---------- 智能体设置 ----------

/** AgentSettingsPanel — 汇总显示当前智能体配置（skills + MCP + slash 命令）。
 *  数据来自 pi 的 x.ai/skills/config、x.ai/mcp/list、x.ai/commands/list，
 *  与「专家·技能·连接器」面板的数据源相同，但这里是设置视图：只读 + 刷新 +
 *  跳转到对应管理面板。 */
export function AgentSettingsPanel() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sk, mc, cmd] = await Promise.all([
        skillsList().catch(() => [] as SkillInfo[]),
        mcpList().catch(() => [] as McpServerEntry[]),
        commandsList().catch(() => [] as SlashCommand[]),
      ]);
      setSkills(sk);
      setServers(mc);
      setCommands(cmd);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const enabledSkills = skills.filter((s) => s.enabled);
  const disabledSkills = skills.filter((s) => !s.enabled);
  const enabledServers = servers.filter((s) => s.enabled);
  const disabledServers = servers.filter((s) => !s.enabled);
  const builtinCommands = commands.filter((c) => !c.source || c.source === "builtin");
  const skillCommands = commands.filter((c) => c.source === "skill");
  const pluginCommands = commands.filter((c) => c.source === "plugin");

  // openbuddy-web-search is removed; web access is delegated to the
  // pi-web-access extension (passthrough=true at pi-extensions.ts). Configure
  // web search through the pi-native extension entry point instead.

  return (
    <SectionShell
      title="智能体设置"
      desc="当前 pi 智能体的配置概览：已加载的技能、MCP 连接器和 slash 命令。数据来自 pi 的 x.ai/skills/config、x.ai/mcp/list、x.ai/commands/list。"
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
              暂无连接器。编辑 <code>~/.pi/config.toml</code> 的 <code>[mcp_servers.*]</code> 段。
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

      <p className="settings-hint">
        管理（启用/禁用/增删）在主界面「专家·技能·连接器」面板。修改后点刷新查看最新状态。
      </p>
    </SectionShell>
  );
}

// ---------- 助理设置 ----------

const PERMISSION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "pi 默认（每次询问）" },
  { value: "allow_once", label: "允许一次" },
  { value: "always_allow_this_session", label: "本会话始终允许" },
  { value: "always_allow_all_sessions", label: "所有会话始终允许" },
  { value: "deny_once", label: "拒绝一次" },
  { value: "always_deny_all_sessions", label: "所有会话始终拒绝" },
];

/** AssistantSettingsPanel — 助理角色列表 + 新会话默认模型/权限偏好。
 *  agents 来自 ~/.pi/agents/*.md；默认值写入 config.toml 的
 *  [models].default 和 [ui].default_selected_permission。 */
export function AssistantSettingsPanel() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [providers, setProviders] = useState<ModelOptionRow[]>([]);
  const [defaults, setDefaults] = useState<AgentDefaults | null>(null);
  const [draft, setDraft] = useState<AgentDefaults>({
    defaultModel: "",
    defaultPermission: "",
    rememberToolApprovals: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ag, prov, def] = await Promise.all([
        agentsList().catch(() => [] as AgentEntry[]),
        providersList()
          .then(flattenModels)
          .catch(() => [] as ModelOptionRow[]),
        agentsDefaultsGet(),
      ]);
      setAgents(ag);
      setProviders(prov);
      setDefaults(def);
      setDraft(def);
      setDirty(false);
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
      await agentsDefaultsSave(draft);
      setDefaults(draft);
      setDirty(false);
      setMsg("已保存（重启 pi 后生效）");
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
      desc="管理助理角色（~/.pi/agents/*.md）和新建会话的默认模型/权限偏好。偏好写入 config.toml 的 [models].default 和 [ui].default_selected_permission。"
    >
      {loading ? (
        <p className="settings-hint">加载中…</p>
      ) : (
        <>
          {/* 助理列表 */}
          <details className="agent-section" open>
            <summary className="agent-section__title">
              已配置助理（{agents.length}）
            </summary>
            <div className="agent-section__body">
              {agents.length === 0 ? (
                <p className="settings-hint">
                  暂无助理。在主界面「助理」面板从模板创建，或把 .md 文件放到
                  <code>~/.pi/agents/</code>。
                </p>
              ) : (
                <ul className="agent-list">
                  {agents.map((a) => (
                    <li key={a.path} className="agent-list__item">
                      <span className="agent-list__name">{a.name}</span>
                      <span className="agent-list__badge">
                        {a.scope === "user" ? "用户级" : "项目级"}
                      </span>
                      {a.description && (
                        <span className="agent-list__desc">{a.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

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
                <option value="">pi 内置默认</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}（{p.id}）
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="settings-hint">
            对应 <code>[models] default</code>。空 = pi 用内置默认（通常是 pi-build）。
          </p>

          {/* 默认权限选择 */}
          <div className="settings-row">
            <div className="settings-row__label">
              <Shield size={16} />
              <span>首次权限提示默认选择</span>
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

          {/* 记住工具授权 */}
          <div className="settings-row">
            <div className="settings-row__label">
              <span>显示「始终允许」选项</span>
            </div>
            <div className="settings-row__control">
              <select
                className="agent-select"
                value={
                  draft.rememberToolApprovals === undefined
                    ? ""
                    : draft.rememberToolApprovals
                      ? "true"
                      : "false"
                }
                onChange={(e) =>
                  update({
                    rememberToolApprovals:
                      e.target.value === "" ? undefined : e.target.value === "true",
                  })
                }
              >
                <option value="">pi 默认</option>
                <option value="true">显示</option>
                <option value="false">隐藏</option>
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

          <p className="settings-hint">
            助理定义在 <code>~/.pi/agents/*.md</code>（含 frontmatter + system prompt）。
            pi 没有 session 级「切换 agent」的 ACP 方法，OpenBuddy 通过预设 prompt 引导。
          </p>
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

export { BillingPanel } from "@openbuddy/ui-billing";
export { AccountLinkingPanel } from "@openbuddy/ui-account";
export { WebhookSubscriptionPanel } from "@openbuddy/ui-account";
export { CreditPricingPanel } from "@openbuddy/ui-billing";
export { CreditReconciliationPanel } from "@openbuddy/ui-billing";
export { CreditWalletPanel } from "@openbuddy/ui-billing";
export { TenantMembersPanel } from "@openbuddy/ui-account";
export { ResourceCatalogPanel } from "@openbuddy/ui-mcp";
export { TenantPolicyPanel } from "@openbuddy/ui-account";
export { SessionManagementPanel } from "@openbuddy/ui-account";
export { TokenIntrospectionPanel } from "@openbuddy/ui-account";
export { GatewayHealthPanel } from "@openbuddy/ui-account";
