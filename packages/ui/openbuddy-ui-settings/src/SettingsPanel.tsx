import { useEffect, useMemo, useState } from "react";
import {
  User,
  Mail,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Keyboard,
  Cpu,
  Bot,
  Palette,
  Database,
  Shield,
  HelpCircle,
  Plus,
  X,
  Eye,
  EyeOff,
  ChevronDown,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Wallet,
  Link2,
  Webhook,
  Coins,
  Users,
  Folder,
  Monitor,
  KeyRound,
  Activity,
  type LucideIcon,
} from "lucide-react";
import {
  providersList,
  providersSaveProvider,
  providersSaveModel,
  providersDeleteProvider,
  providersDeleteModel,
  providersFetchModels,
  internalReload,
  type ApiBackend,
  type AuthScheme,
  type ModelProviderEntry,
  type ModelEntry,
  type ProviderListModel,
  type ProviderKind,
  type FetchedModel,
} from "@/lib/agent/pi-client";
import { confirm } from "@/lib/platform/electron-api";
import {
  AccountLinkingPanel,
  AccountSettingsPanel,
  AgentSettingsPanel,
  AssistantSettingsPanel,
  BillingPanel,
  CreditPricingPanel,
  CreditReconciliationPanel,
  CreditWalletPanel,
  DataSettingsPanel,
  GeneralSettingsPanel,
  HelpSettingsPanel,
  PersonalizeSettingsPanel,
  ResourceCatalogPanel,
  SecuritySettingsPanel,
  SessionManagementPanel,
  ShortcutsSettingsPanel,
  TenantMembersPanel,
  TenantPolicyPanel,
  TokenIntrospectionPanel,
  GatewayHealthPanel,
  WebhookSubscriptionPanel,
} from "./SettingsSections";
import { useRendererContributions, useRendererSlot } from "@/lib/runtime/renderer-plugin-runtime";
import { RendererContributionCard, RendererSlotView } from "@openbuddy/ui-workbench";

/**
 * WorkBuddy-style Settings dialog.
 *
 * Full-screen overlay → centered `.settings-modal` (1040×720) with a fixed
 * 12-item left navigation (mirrors WorkBuddy) and a right panel that swaps
 * per section. Each section is backed by a local Electron/Pi capability.
 *
 * The 模型 section lists configured providers from ~/.pi/agent/models.json and
 * opens a nested "添加模型" editor dialog (560×318) when adding/editing.
 * That editor writes back through providers_save → pi's [model.*] tables.
 */

type SectionId =
  | "account"
  | "members"
  | "linking"
  | "webhooks"
  | "billing"
  | "pricing"
  | "reconciliation"
  | "wallet"
  | "policy"
  | "resources"
  | "sessions"
  | "introspect"
  | "health"
  | "agent-mail"
  | "notifications"
  | "general"
  | "agent-settings"
  | "shortcuts"
  | "model"
  | "assistant"
  | "personalize"
  | "data"
  | "security"
  | "help";

interface NavItem {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  description?: string;
}

/**
 * Two-level navigation. Top-level groups are visible at all times (collapsed
 * by default for advanced/admin groups); the user expands them on demand.
 *
 * Sections:
 *   通用 — personal preferences (mirrors WorkBuddy's wb-settings-personal).
 *   智能体 — agent configuration (mirrors wb-settings-agent).
 *   数据与安全 — data + security (mirrors wb-settings-data-security).
 *   关于 — about / help (mirrors wb-settings-about).
 *   管理控制台 — tenant / enterprise admin items (mirrors
 *     wb-settings-tenant), collapsed by default to keep personal settings
 *     focused. Includes the 企业财务 sub-group so the 4 money-related
 *     items (计费 / 定价 / 对账 / 扣费账户) collapse into one place.
 */
interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Whether the group starts collapsed. Only used for advanced groups. */
  collapsedByDefault?: boolean;
  items: NavItem[];
  /** Optional nested sub-group rendered as a labelled sub-block inside
   *  the parent group; used for enterprise finance (4 closely-related items). */
  subgroups?: { id: string; label: string; items: NavItem[] }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "general",
    label: "通用",
    icon: SettingsIcon,
    items: [
      { id: "shortcuts", label: "快捷键", icon: Keyboard },
      { id: "personalize", label: "个性化", icon: Palette },
      { id: "assistant", label: "助理设置", icon: Bot },
    ],
  },
  {
    id: "agent",
    label: "智能体",
    icon: SlidersHorizontal,
    items: [
      { id: "agent-settings", label: "智能体设置", icon: SlidersHorizontal },
      { id: "model", label: "模型", icon: Cpu },
    ],
  },
  {
    id: "data-security",
    label: "数据与安全",
    icon: Shield,
    items: [
      { id: "data", label: "数据管理", icon: Database },
      { id: "security", label: "安全中心", icon: Shield },
    ],
  },
  {
    id: "about",
    label: "关于",
    icon: HelpCircle,
    items: [
      { id: "help", label: "关于", icon: HelpCircle },
    ],
  },
  {
    id: "admin",
    label: "管理控制台",
    icon: User,
    collapsedByDefault: true,
    items: [
      { id: "account", label: "账户管理", icon: User },
      { id: "members", label: "租户成员", icon: Users },
      { id: "linking", label: "账号绑定", icon: Link2 },
      { id: "webhooks", label: "Webhook 订阅", icon: Webhook },
      { id: "resources", label: "资源目录", icon: Folder },
      { id: "policy", label: "租户策略", icon: Shield },
      { id: "sessions", label: "会话管理", icon: Monitor },
      { id: "introspect", label: "Token 内省", icon: KeyRound },
      { id: "health", label: "网关健康", icon: Activity },
      { id: "agent-mail", label: "智能体邮箱", icon: Mail },
      { id: "notifications", label: "通知中心", icon: Mail },
      { id: "general", label: "系统设置", icon: SettingsIcon },
    ],
    subgroups: [
      {
        id: "finance",
        label: "企业财务",
        items: [
          { id: "billing", label: "企业计费", icon: Wallet },
          { id: "pricing", label: "积分定价", icon: Coins },
          { id: "reconciliation", label: "成本对账", icon: Coins },
          { id: "wallet", label: "扣费账户", icon: Wallet },
        ],
      },
    ],
  },
];

// Provider presets: choosing one pre-fills baseUrl/apiBackend/authScheme and
// suggested model ids. The "custom" preset is intentionally empty.
interface Preset {
  label: string;
  baseUrl?: string;
  apiBackend?: ApiBackend;
  authScheme?: AuthScheme;
  models: string[];
  placeholderKey: string;
  helpUrl: string;
}

const PRESETS: Record<ProviderKind, Preset> = {
  anthropic: {
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiBackend: "messages",
    authScheme: "x_api_key",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    placeholderKey: "sk-ant-...",
    helpUrl: "console.anthropic.com",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiBackend: "chat_completions",
    authScheme: "bearer",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    placeholderKey: "sk-...",
    helpUrl: "platform.openai.com",
  },
  pi: {
    label: "Pi OpenAI 兼容",
    baseUrl: "",
    apiBackend: "chat_completions",
    authScheme: "bearer",
    models: ["pi-4", "pi-4-fast", "pi-3"],
    placeholderKey: "provider-api-key",
    helpUrl: "Pi provider 文档",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiBackend: "chat_completions",
    authScheme: "bearer",
    models: ["deepseek-chat", "deepseek-reasoner"],
    placeholderKey: "sk-...",
    helpUrl: "platform.deepseek.com",
  },
  qwen: {
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiBackend: "chat_completions",
    authScheme: "bearer",
    models: ["qwen-max", "qwen-plus", "qwen-turbo"],
    placeholderKey: "sk-...",
    helpUrl: "dashscope.console.aliyun.com",
  },
  minimax: {
    label: "MiniMax (Anthropic 兼容)",
    // pi-ai ships a built-in `minimax` provider hard-wired to
    // `anthropic-messages` against `https://api.minimaxi.com/anthropic`.
    // Mirroring that here means the preset, the wire protocol, and the
    // rendered baseUrl all agree (the previous OpenAI Chat-Completions
    // shape produced `/v1/v1/messages` → 404 because pi-ai kept the
    // built-in's api while honoring only our baseUrl override).
    baseUrl: "https://api.minimaxi.com/anthropic",
    apiBackend: "messages",
    authScheme: "x_api_key",
    models: ["MiniMax-M3"],
    placeholderKey: "sk-...",
    helpUrl: "platform.minimaxi.com",
  },
  // OpenAI Chat-Completions wire for MiniMax. The provider id is
  // intentionally distinct from `minimax` so pi-ai does not silently
  // override our `api` with the built-in anthropic-messages backend.
  // Both endpoints have been validated against the same MiniMax API key.
  minimax_openai: {
    label: "MiniMax (OpenAI Chat-Completions)",
    baseUrl: "https://api.minimaxi.com/v1",
    apiBackend: "chat_completions",
    authScheme: "bearer",
    models: ["MiniMax-M3"],
    placeholderKey: "sk-...",
    helpUrl: "platform.minimaxi.com",
  },
  new_api: {
    label: "New API（OpenAI 兼容网关）",
    // New API is self-hosted; the instance URL must be supplied by the user.
    models: [],
    placeholderKey: "sk-...（New API Token）",
    helpUrl: "docs.newapi.pro",
  },
  // Legacy alias:保留 `minimax_cn` 用于旧记录兼容,但不出现在 Settings UI 下拉。
  // 用户切换到「MiniMax」时会统一归到 `minimax` Kind;Anthropic 协议需求请使用 `custom_anthropic`。
  minimax_cn: {
    label: "(legacy) MiniMax CN",
    baseUrl: "https://api.minimaxi.com/anthropic",
    apiBackend: "messages",
    authScheme: "x_api_key",
    models: ["MiniMax-M3", "MiniMax-M2.7"],
    placeholderKey: "sk-...",
    helpUrl: "platform.minimaxi.com",
  },
  custom: {
    label: "自定义 (OpenAI 兼容)",
    models: [],
    placeholderKey: "your-api-key",
    helpUrl: "（请填写您的提供商文档地址）",
  },
  custom_anthropic: {
    label: "自定义 (Anthropic 兼容)",
    // No baseUrl preset → user must supply it. But protocol/auth are locked to
    // the Anthropic wire shape (messages backend + x-api-key header).
    apiBackend: "messages",
    authScheme: "x_api_key",
    models: [],
    placeholderKey: "sk-ant-...",
    helpUrl: "（请填写您的提供商文档地址）",
  },
};

export function SettingsPanel({
  open,
  onClose,
  onModelsChanged,
  initialSection = "model",
  onOpenEmailPlan,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a provider is saved/deleted so the app can refresh its
   *  model picker without a restart. */
  onModelsChanged?: () => void | Promise<void>;
  initialSection?: SectionId;
  onOpenEmailPlan?: (planId: string) => void;
}) {
  const [active, setActive] = useState<SectionId>("model");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of NAV_GROUPS) if (g.collapsedByDefault) init[g.id] = true;
    return init;
  });
  const toggleGroup = (groupId: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  const pluginSettingsContributions = useRendererContributions("settings");
  const pluginSettingsSections = useRendererSlot("settings.section");
  const pluginSettingsGeneralItems = useRendererSlot("settings.general.item");

  // Select the requested section every time the dialog opens. If the section
  // lives inside a collapsed group (e.g. 账户管理 in 管理控制台), expand
  // that group so the user can actually see the highlighted entry.
  useEffect(() => {
    if (!open) return;
    setActive(initialSection);
    const group = NAV_GROUPS.find(
      (g) =>
        g.items.some((it) => it.id === initialSection) ||
        g.subgroups?.some((sub) => sub.items.some((it) => it.id === initialSection)),
    );
    if (group && collapsedGroups[group.id]) {
      setCollapsedGroups((prev) => ({ ...prev, [group.id]: false }));
    }
  }, [initialSection, open, collapsedGroups]);

  // Esc closes the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      onClick={(e) => {
        // 仅当点击遮罩本身(而非弹窗内容)时关闭,与 WorkBuddy 一致。
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal">
        <nav className="settings-modal__nav">
          <ul className="settings-navigation">
            {NAV_GROUPS.map((group) => {
              const GroupIcon = group.icon;
              const collapsed = !!collapsedGroups[group.id];
              return (
                <li
                  key={group.id}
                  className={
                    "settings-navigation__group" +
                    (collapsed ? " settings-navigation__group--collapsed" : "")
                  }
                >
                  <button
                    type="button"
                    className="settings-navigation__group-header"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={!collapsed}
                  >
                    <span className="settings-navigation__group-icon">
                      <GroupIcon size={14} strokeWidth={1.75} />
                    </span>
                    <span className="settings-navigation__group-label">{group.label}</span>
                    <span className="settings-navigation__group-chevron" aria-hidden="true">
                      <ChevronDown size={12} strokeWidth={2} />
                    </span>
                  </button>
                  {!collapsed && (
                    <ul className="settings-navigation__sublist">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <li key={item.id}>
                            <button
                              className={
                                "settings-navigation__item" +
                                (active === item.id ? " settings-navigation__item--active" : "")
                              }
                              onClick={() => setActive(item.id)}
                            >
                              <span className="settings-navigation__icon">
                                <Icon size={16} strokeWidth={1.75} />
                              </span>
                              <span className="settings-navigation__label">{item.label}</span>
                            </button>
                          </li>
                        );
                      })}
                      {group.subgroups?.map((sub) => (
                        <li key={sub.id} className="settings-navigation__subgroup">
                          <div className="settings-navigation__subgroup-label">{sub.label}</div>
                          <ul className="settings-navigation__sublist">
                            {sub.items.map((item) => {
                              const Icon = item.icon;
                              return (
                                <li key={item.id}>
                                  <button
                                    className={
                                      "settings-navigation__item" +
                                      (active === item.id ? " settings-navigation__item--active" : "")
                                    }
                                    onClick={() => setActive(item.id)}
                                  >
                                    <span className="settings-navigation__icon">
                                      <Icon size={16} strokeWidth={1.75} />
                                    </span>
                                    <span className="settings-navigation__label">{item.label}</span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="settings-modal__content">
          <button
            className="settings-modal__close"
            onClick={onClose}
            aria-label="关闭设置"
            title="关闭 (Esc)"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
          <div className="settings-modal__panel">
            {active === "model" ? (
              <ModelsSettingsPanel onModelsChanged={onModelsChanged} />
            ) : active === "personalize" ? (
              <PersonalizeSettingsPanel />
            ) : active === "shortcuts" ? (
              <ShortcutsSettingsPanel />
            ) : active === "help" ? (
              <HelpSettingsPanel />
            ) : active === "security" ? (
              <SecuritySettingsPanel />
            ) : active === "data" ? (
              <DataSettingsPanel />
            ) : active === "general" ? (
              <GeneralSettingsPanel />
            ) : active === "account" ? (
              <AccountSettingsPanel />
            ) : active === "members" ? (
              <TenantMembersPanel />
            ) : active === "linking" ? (
              <AccountLinkingPanel />
            ) : active === "webhooks" ? (
              <WebhookSubscriptionPanel />
            ) : active === "billing" ? (
              <BillingPanel />
            ) : active === "pricing" ? (
              <CreditPricingPanel />
            ) : active === "reconciliation" ? (
              <CreditReconciliationPanel />
            ) : active === "wallet" ? (
              <CreditWalletPanel />
            ) : active === "resources" ? (
              <ResourceCatalogPanel />
            ) : active === "policy" ? (
              <TenantPolicyPanel />
            ) : active === "sessions" ? (
              <SessionManagementPanel />
            ) : active === "introspect" ? (
              <TokenIntrospectionPanel />
            ) : active === "health" ? (
              <GatewayHealthPanel />
            ) : active === "agent-settings" ? (
              <AgentSettingsPanel />
            ) : active === "assistant" ? (
              <AssistantSettingsPanel />
            ) : null}
            {active === "general" && pluginSettingsGeneralItems.length > 0 && (
              <div className="settings-plugin-contributions">
                {pluginSettingsGeneralItems.map((entry) => (
                  <RendererSlotView key={String(entry.options.id ?? entry.options.name)} entry={entry} />
                ))}
              </div>
            )}
            {pluginSettingsSections.filter((entry) => entry.options.id !== "general" && entry.options.id !== "models").map((entry) => (
              <div key={String(entry.options.id ?? entry.options.name)} className="settings-plugin-contributions">
                <RendererSlotView entry={entry} />
              </div>
            ))}
            {pluginSettingsContributions.length > 0 && (
              <div className="settings-plugin-contributions">
                {pluginSettingsContributions.map((contribution) => (
                  <RendererContributionCard key={contribution.id} contribution={contribution} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 模型 section: provider-grouped view (one provider → many models).
//
// pi's native config shape is [model_providers.<id>] (one key/url/context_window)
// + [model.<id>] with a `model_provider = "<id>"` reference. The UI mirrors
// that: a left list of providers, a right detail showing that provider's
// models + a connection editor. Legacy per-model entries (old shape) are
// grouped for display but only rewritten to the new shape on save.
// ---------------------------------------------------------------------------

/** Inline "拉取模型" panel target (null = closed). */
type ImportingState = { providerId: string; apiKey: string } | null;

function ModelsSettingsPanel({ onModelsChanged }: { onModelsChanged?: () => void }) {
  const [data, setData] = useState<ProviderListModel>({ providers: [], models: [] });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  /** Editing target: a provider connection, or the "add provider" form. */
  const [editingProvider, setEditingProvider] = useState<{
    original?: ModelProviderEntry;
    draft: ProviderDraft;
  } | null>(null);
  /** Editing target: a single model (add or edit). */
  const [editingModel, setEditingModel] = useState<{
    providerId: string;
    original?: ModelEntry;
    modelId?: string;
    name: string;
    contextWindow: string;
    reasoning: boolean;
  } | null>(null);
  /** Inline "拉取模型" panel target (null = closed). */
  const [importing, setImporting] = useState<ImportingState>(null);

  const reload = async () => {
    try {
      const list = await providersList();
      setData(list);
      // Keep a valid selection, or auto-pick the first provider.
      setSelectedProviderId((prev) => {
        if (prev && list.providers.some((p) => p.id === prev)) return prev;
        return list.providers[0]?.id ?? null;
      });
    } catch (e) {
      setMsg({ kind: "err", text: `读取配置失败：${String(e)}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelsOf = (providerId: string) =>
    data.models.filter((m) => m.providerId === providerId);

  const refreshCatalog = () => internalReload("models").catch(() => {});

  const handleSaveProvider = async (draft: ProviderDraft, original?: ModelProviderEntry) => {
    setMsg(null);
    try {
      // id: stable, derived from providerKind. Keep an existing provider's id
      // unless the user changed the kind (then it's effectively a new entry).
      const baseId = original?.id ?? draft.providerKind;
      const id = original?.id ?? (() => {
        if (!data.providers.some((provider) => provider.id === baseId)) return baseId;
        let suffix = 2;
        while (data.providers.some((provider) => provider.id === `${baseId}-${suffix}`)) suffix += 1;
        return `${baseId}-${suffix}`;
      })();
      await providersSaveProvider({
        id,
        providerKind: draft.providerKind,
        apiKey: draft.apiKey.trim() || undefined,
        baseUrl: draft.baseUrl.trim() || undefined,
        apiBackend: draft.apiBackend,
        authScheme: draft.authScheme,
        contextWindow: draft.contextWindow ? Number(draft.contextWindow) : undefined,
      });
      await refreshCatalog();
      await onModelsChanged?.();
      setEditingProvider(null);
      setSelectedProviderId(id);
      await reload();
      setMsg({ kind: "ok", text: "厂商配置已保存。" });
    } catch (e) {
      setMsg({ kind: "err", text: `保存失败：${String(e)}` });
    }
  };

  const handleDeleteProvider = async (p: ModelProviderEntry) => {
    const count = modelsOf(p.id).length;
    const confirmText =
      count > 0
        ? `删除厂商「${p.label || p.providerKind}」及其 ${count} 个模型？`
        : `删除厂商「${p.label || p.providerKind}」？`;
    if (!confirm(confirmText)) return;
    setMsg(null);
    try {
      await providersDeleteProvider(p.id);
      await refreshCatalog();
      await onModelsChanged?.();
      if (selectedProviderId === p.id) setSelectedProviderId(null);
      await reload();
      setMsg({ kind: "ok", text: "已删除，模型列表已刷新。" });
    } catch (e) {
      setMsg({ kind: "err", text: `删除失败：${String(e)}` });
    }
  };

  const handleSaveModel = async (
    providerId: string,
    modelId: string,
    name: string,
    contextWindow: string,
    reasoning: boolean,
  ) => {
    setMsg(null);
    try {
      await providersSaveModel({
        modelId: modelId.trim(),
        providerId,
        name: name.trim() || undefined,
        contextWindow: contextWindow ? Number(contextWindow) : undefined,
        reasoning,
      });
      await refreshCatalog();
      await onModelsChanged?.();
      setEditingModel(null);
      await reload();
      setMsg({ kind: "ok", text: "模型已保存。" });
    } catch (e) {
      setMsg({ kind: "err", text: `保存失败：${String(e)}` });
    }
  };

  const handleDeleteModel = async (m: ModelEntry) => {
    if (!confirm(`删除模型「${m.name || m.modelId}」？`)) return;
    setMsg(null);
    try {
      await providersDeleteModel(m.providerId, m.modelId);
      await refreshCatalog();
      await onModelsChanged?.();
      await reload();
      setMsg({ kind: "ok", text: "已删除。" });
    } catch (e) {
      setMsg({ kind: "err", text: `删除失败：${String(e)}` });
    }
  };

  // Batch import: save many fetched model ids under one provider at once.
  // Each becomes its own [model.<id>] referencing the provider, so per-model
  // display names default to the distinct model id (no more shared-name bug).
  const handleBatchImport = async (providerId: string, ids: string[]) => {
    setMsg(null);
    try {
      for (const id of ids) {
        await providersSaveModel({ modelId: id, providerId });
      }
      await refreshCatalog();
      await onModelsChanged?.();
      await reload();
      setMsg({ kind: "ok", text: `已导入 ${ids.length} 个模型。` });
    } catch (e) {
      setMsg({ kind: "err", text: `导入失败：${String(e)}` });
    }
  };

  const selectedProvider = data.providers.find((p) => p.id === selectedProviderId) ?? null;
  const newProviderDraft: ProviderDraft = useMemo(
    () => ({
      providerKind: "custom",
      apiKey: "",
      baseUrl: "",
      apiBackend: "chat_completions",
      authScheme: "bearer",
      contextWindow: "",
    }),
    [],
  );

  return (
    <div className="models-settings-panel">
      <h2 className="models-settings-panel__title">模型</h2>

      <section className="models-settings-panel__section">
        <div className="models-settings-panel__section-head">
          <h3 className="models-settings-panel__section-title">厂商与模型</h3>
          <button
            className="cb-button cb-button--secondary cb-button--small"
            onClick={() => setEditingProvider({ draft: { ...newProviderDraft } })}
          >
            <span className="cb-button__content">
              <Plus size={13} strokeWidth={2} style={{ marginRight: 4 }} />
              添加厂商
            </span>
          </button>
        </div>
        <div className="models-settings-panel__card-desc models-settings-panel__grouped-note">
          一个厂商保存一份 API Key / Base URL / 上下文窗口，可挂载多个模型。配置写入{" "}
          <code className="models-settings-panel__card-link">~/.pi/agent/models.json</code>。
        </div>

        {loading ? (
          <div className="models-settings-panel__empty">
            <div className="models-settings-panel__empty-title">加载中…</div>
          </div>
        ) : data.providers.length === 0 ? (
          <div className="models-settings-panel__empty">
            <div className="models-settings-panel__empty-title">还没有配置厂商</div>
            <div className="models-settings-panel__empty-desc">
              点击「添加厂商」开始配置，一个厂商下可添加多个模型。
            </div>
          </div>
        ) : (
          <div className="models-settings-panel__grouped">
            {/* Left: provider list */}
            <ul className="models-settings-panel__provider-list">
              {data.providers.map((p) => {
                const count = modelsOf(p.id).length;
                const active = p.id === selectedProviderId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={
                        "models-settings-panel__provider-item" +
                        (active ? " models-settings-panel__provider-item--active" : "")
                      }
                      onClick={() => setSelectedProviderId(p.id)}
                    >
                      <span className="models-settings-panel__provider-name">
                        {PRESETS[p.providerKind]?.label || p.providerKind}
                      </span>
                      <span className="models-settings-panel__provider-meta">
                        {count > 0 ? `${count} 个模型` : "无模型"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Right: selected provider detail */}
            {selectedProvider && (
              <div className="models-settings-panel__provider-detail">
                <div className="models-settings-panel__provider-detail-head">
                  <div className="models-settings-panel__provider-detail-title">
                    {PRESETS[selectedProvider.providerKind]?.label || selectedProvider.providerKind}
                  </div>
                  <div className="models-settings-panel__provider-detail-actions">
                    <button
                      className="cb-button cb-button--ghost cb-button--small cb-button--icon-only"
                      onClick={() =>
                        setEditingProvider({
                          original: selectedProvider,
                          draft: {
                            providerKind: selectedProvider.providerKind,
                            apiKey: "",
                            baseUrl: selectedProvider.baseUrl ?? "",
                            apiBackend: selectedProvider.apiBackend ?? "chat_completions",
                            authScheme: selectedProvider.authScheme ?? "bearer",
                            contextWindow: selectedProvider.contextWindow
                              ? String(selectedProvider.contextWindow)
                              : "",
                          },
                        })
                      }
                      aria-label="编辑厂商"
                      title="编辑厂商"
                    >
                      <Pencil size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      className="cb-button cb-button--ghost cb-button--small cb-button--icon-only"
                      onClick={() => handleDeleteProvider(selectedProvider)}
                      aria-label="删除厂商"
                      title="删除厂商"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>

                <dl className="models-settings-panel__provider-fields">
                  <div className="models-settings-panel__provider-field">
                    <dt>Base URL</dt>
                    <dd>{selectedProvider.baseUrl || "—"}</dd>
                  </div>
                  <div className="models-settings-panel__provider-field">
                    <dt>协议</dt>
                    <dd>{selectedProvider.apiBackend || "—"}</dd>
                  </div>
                  <div className="models-settings-panel__provider-field">
                    <dt>认证</dt>
                    <dd>{selectedProvider.authScheme || "—"}</dd>
                  </div>
                  <div className="models-settings-panel__provider-field">
                    <dt>上下文窗口</dt>
                    <dd>
                      {selectedProvider.contextWindow
                        ? `${selectedProvider.contextWindow.toLocaleString()} tokens`
                        : "默认"}
                    </dd>
                  </div>
                </dl>

                <div className="models-settings-panel__models-head">
                  <span className="models-settings-panel__models-head-title">模型</span>
                  <div className="models-settings-panel__models-head-actions">
                    <button
                      className="cb-button cb-button--ghost cb-button--small"
                      onClick={() =>
                        setEditingModel({
                          providerId: selectedProvider.id,
                          modelId: "",
                          name: "",
                          contextWindow: "",
                          reasoning: false,
                        })
                      }
                    >
                      <span className="cb-button__content">
                        <Plus size={13} strokeWidth={2} style={{ marginRight: 4 }} />
                        手动添加
                      </span>
                    </button>
                    <button
                      className="cb-button cb-button--secondary cb-button--small"
                      onClick={() =>
                        setImporting((prev) =>
                          prev && prev.providerId === selectedProvider.id
                            ? null
                            : { providerId: selectedProvider.id, apiKey: "" },
                        )
                      }
                    >
                      <span className="cb-button__content">
                        <RefreshCw size={13} strokeWidth={2} style={{ marginRight: 4 }} />
                        拉取模型
                      </span>
                    </button>
                  </div>
                </div>

                {modelsOf(selectedProvider.id).length === 0 ? (
                  <div className="models-settings-panel__models-empty">
                    该厂商还没有模型。手动添加，或用厂商的 API Key 拉取。
                  </div>
                ) : (
                  <ul className="models-settings-panel__model-list">
                    {modelsOf(selectedProvider.id).map((m) => (
                      <li key={m.modelId} className="models-settings-panel__model-item">
                        <div className="models-settings-panel__model-main">
                          <div className="models-settings-panel__model-name">
                            {m.name || m.modelId}
                          </div>
                          <div className="models-settings-panel__model-meta">
                            <span className="models-settings-panel__model-id">{m.modelId}</span>
                            {m.contextWindow && (
                              <span className="models-settings-panel__model-cw">
                                {m.contextWindow.toLocaleString()} ctx
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="models-settings-panel__model-actions">
                          <button
                            className="cb-button cb-button--ghost cb-button--small cb-button--icon-only"
                            onClick={() =>
                              setEditingModel({
                                providerId: selectedProvider.id,
                                original: m,
                                modelId: m.modelId,
                                name: m.name ?? "",
                                contextWindow: m.contextWindow ? String(m.contextWindow) : "",
                                reasoning: m.reasoning ?? false,
                              })
                            }
                            aria-label="编辑模型"
                            title="编辑模型"
                          >
                            <Pencil size={14} strokeWidth={1.75} />
                          </button>
                          <button
                            className="cb-button cb-button--ghost cb-button--small cb-button--icon-only"
                            onClick={() => handleDeleteModel(m)}
                            aria-label="删除模型"
                            title="删除模型"
                          >
                            <Trash2 size={14} strokeWidth={1.75} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {importing?.providerId === selectedProvider.id && (
                  <ImportModelsInline
                    provider={selectedProvider}
                    existingModelIds={new Set(modelsOf(selectedProvider.id).map((m) => m.modelId))}
                    onClose={() => setImporting(null)}
                    onImport={(ids) => {
                      void handleBatchImport(selectedProvider.id, ids).then(() =>
                        setImporting(null),
                      );
                    }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {msg && <div className={`settings__msg settings__msg--${msg.kind}`}>{msg.text}</div>}

      {editingProvider && (
        <ProviderEditor
          draft={editingProvider.draft}
          original={editingProvider.original}
          onCancel={() => setEditingProvider(null)}
          onSave={handleSaveProvider}
        />
      )}

      {editingModel && (
        <ModelEditor
          providerId={editingModel.providerId}
          original={editingModel.original}
          initialName={editingModel.name}
          initialContextWindow={editingModel.contextWindow}
          initialReasoning={editingModel.reasoning}
          onCancel={() => setEditingModel(null)}
          onSave={(modelId, name, cw, reasoning) =>
            handleSaveModel(editingModel.providerId, modelId, name, cw, reasoning)
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider connection editor dialog (add/edit a [model_providers.<id>] entry).
// ---------------------------------------------------------------------------

interface ProviderDraft {
  providerKind: ProviderKind;
  apiKey: string;
  baseUrl: string;
  apiBackend: ApiBackend;
  authScheme: AuthScheme;
  contextWindow: string;
}

function ProviderEditor({
  draft,
  original,
  onCancel,
  onSave,
}: {
  draft: ProviderDraft;
  original?: ModelProviderEntry;
  onCancel: () => void;
  onSave: (draft: ProviderDraft, original?: ModelProviderEntry) => void;
}) {
  const [form, setForm] = useState<ProviderDraft>({ ...draft });
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(draft.providerKind === "custom" || draft.providerKind === "new_api");
  const [error, setError] = useState<string | null>(null);

  const preset = PRESETS[form.providerKind];
  // "Custom-like" kinds have no preset baseUrl → the user must supply one, so
  // the Base URL / protocol / auth fields are unlocked. Covers both `custom`
  // (OpenAI-compatible) and `custom_anthropic` (Anthropic-compatible).
  const needsBaseUrl = !preset.baseUrl;

  const handleProviderChange = (kind: ProviderKind) => {
    const p = PRESETS[kind];
    setForm((f) => ({
      ...f,
      providerKind: kind,
      baseUrl: p.baseUrl ?? "",
      apiBackend: p.apiBackend ?? f.apiBackend,
      authScheme: p.authScheme ?? f.authScheme,
    }));
    setShowAdvanced(!p.baseUrl || kind === "new_api");
  };

  const canSave = (() => {
    if (needsBaseUrl && !form.baseUrl.trim()) return false;
    if (form.providerKind === "new_api") return true;
    // New provider requires a key; editing allows blank (unchanged).
    if (!original && !form.apiKey.trim()) return false;
    if (form.apiKey.startsWith("•")) return false;
    return true;
  })();

  const handleSaveClick = () => {
    setError(null);
    if (!canSave) {
      setError(needsBaseUrl && !form.baseUrl.trim() ? "请填写 Base URL。" : "请填写 API Key。");
      return;
    }
    onSave(form, original);
  };

  return (
    <div className="models-settings-panel__editor-overlay" role="dialog" aria-modal="true">
      <div className="models-settings-panel__editor">
        <header className="models-settings-panel__editor-header">
          <div className="models-settings-panel__editor-title-group">
            <div className="models-settings-panel__editor-title">
              {original ? "编辑厂商" : "添加厂商"}
            </div>
            <div className="models-settings-panel__editor-note">
              {form.providerKind === "new_api"
                ? "New API 自托管 OpenAI 兼容网关"
                : form.providerKind === "custom"
                ? "自定义 OpenAI 兼容协议 API"
                : form.providerKind === "custom_anthropic"
                  ? "自定义 Anthropic 兼容协议 API"
                  : "支持 OpenAI / Anthropic / Pi 兼容协议"}
            </div>
          </div>
          <button
            className="cb-button cb-button--ghost cb-button--small cb-button--icon-only"
            onClick={onCancel}
            aria-label="关闭"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="models-settings-panel__editor-body">
          <div className="models-settings-panel__field">
            <label className="models-settings-panel__label">提供商</label>
            <div className="models-settings-panel__select-shell">
              <select
                className="models-settings-panel__select"
                value={form.providerKind}
                onChange={(e) => handleProviderChange(e.target.value as ProviderKind)}
              >
                {(
                  [
                    "anthropic",
                    "openai",
                    "pi",
                    "deepseek",
                    "qwen",
                    "minimax",
                    "minimax_openai",
                    "new_api",
                    "custom",
                    "custom_anthropic",
                  ] as ProviderKind[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {PRESETS[k].label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className="models-settings-panel__select-arrow" />
            </div>
          </div>

          <div className="models-settings-panel__field">
            <label className="models-settings-panel__label">{form.providerKind === "new_api" ? "企业会话" : "API Key"}</label>
            <div className="models-settings-panel__input-shell">
              <input
                className="models-settings-panel__input models-settings-panel__input--with-trailing-icon"
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder={form.providerKind === "new_api" ? "由 Casdoor 会话和 Resource Gateway 鉴权" : original ? "已保存（重新输入以替换，留空保持不变）" : preset.placeholderKey}
                disabled={form.providerKind === "new_api"}
              />
              <button
                className="cb-button cb-button--ghost cb-button--small cb-button--icon-only models-settings-panel__input-toggle"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "隐藏" : "显示"}
                type="button"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="models-settings-panel__field">
            <label className="models-settings-panel__label">上下文窗口（tokens，可选）</label>
            <div className="models-settings-panel__input-shell">
              <input
                className="models-settings-panel__input"
                type="number"
                min={1}
                value={form.contextWindow}
                onChange={(e) => setForm((f) => ({ ...f, contextWindow: e.target.value }))}
                placeholder="如 128000（留空用厂商默认）"
              />
            </div>
          </div>

          <button
            className="models-settings-panel__advanced-toggle"
            onClick={() => setShowAdvanced((s) => !s)}
            type="button"
          >
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              style={{
                transition: "transform 0.15s",
                transform: showAdvanced ? "rotate(180deg)" : "none",
              }}
            />
            高级
          </button>

          {showAdvanced && (
            <div className="models-settings-panel__advanced">
              <div className="models-settings-panel__field">
                <label className="models-settings-panel__label">Base URL</label>
                <div className="models-settings-panel__input-shell">
                  <input
                    className="models-settings-panel__input"
                    value={form.baseUrl}
                    onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                    placeholder="https://api.example.com/v1"
                    disabled={!!preset.baseUrl}
                  />
                </div>
              </div>
              <div className="models-settings-panel__field-row">
                <div className="models-settings-panel__field">
                  <label className="models-settings-panel__label">
                    协议
                    {preset.apiBackend && form.apiBackend !== preset.apiBackend && (
                      <span
                        className="models-settings-panel__hint"
                        title="覆盖了预设协议；保存后此厂商将以所选协议工作。"
                      >
                        {" "}已覆盖
                      </span>
                    )}
                  </label>
                  <div className="models-settings-panel__select-shell">
                    <select
                      className="models-settings-panel__select"
                      value={form.apiBackend}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, apiBackend: e.target.value as ApiBackend }))
                      }
                    >
                      <option value="chat_completions">chat_completions</option>
                      <option value="responses">responses</option>
                      <option value="messages">messages</option>
                    </select>
                    <ChevronDown size={14} strokeWidth={1.75} className="models-settings-panel__select-arrow" />
                  </div>
                </div>
                <div className="models-settings-panel__field">
                  <label className="models-settings-panel__label">
                    认证方式
                    {preset.authScheme && form.authScheme !== preset.authScheme && (
                      <span
                        className="models-settings-panel__hint"
                        title="覆盖了预设认证方式；保存后此厂商将以所选认证方式工作。"
                      >
                        {" "}已覆盖
                      </span>
                    )}
                  </label>
                  <div className="models-settings-panel__select-shell">
                    <select
                      className="models-settings-panel__select"
                      value={form.authScheme}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, authScheme: e.target.value as AuthScheme }))
                      }
                    >
                      <option value="bearer">bearer</option>
                      <option value="x_api_key">x_api_key</option>
                    </select>
                    <ChevronDown size={14} strokeWidth={1.75} className="models-settings-panel__select-arrow" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && <div className="models-settings-panel__editor-error">{error}</div>}
        </div>

        <footer className="models-settings-panel__editor-footer">
          <button
            className="cb-button cb-button--secondary cb-button--medium models-settings-panel__editor-cancel"
            onClick={onCancel}
          >
            <span className="cb-button__content">取消</span>
          </button>
          <button
            className="cb-button cb-button--primary cb-button--medium models-settings-panel__editor-save"
            onClick={handleSaveClick}
            disabled={!canSave}
          >
            <span className="cb-button__content">保存</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-model editor dialog (display name + optional per-model context window).
// ---------------------------------------------------------------------------

function ModelEditor({
  providerId,
  original,
  initialName,
  initialContextWindow,
  initialReasoning,
  onCancel,
  onSave,
}: {
  providerId: string;
  original?: ModelEntry;
  initialName: string;
  initialContextWindow: string;
  initialReasoning: boolean;
  onCancel: () => void;
  onSave: (modelId: string, name: string, contextWindow: string, reasoning: boolean, original?: ModelEntry) => void;
}) {
  const [modelId, setModelId] = useState(original?.modelId ?? "");
  const [name, setName] = useState(initialName);
  const [contextWindow, setContextWindow] = useState(initialContextWindow);
  const [reasoning, setReasoning] = useState(initialReasoning);
  const [error, setError] = useState<string | null>(null);

  const canSave = modelId.trim().length > 0;

  const handleSaveClick = () => {
    setError(null);
    if (!canSave) {
      setError("请填写模型 ID。");
      return;
    }
    // modelId is the [model.<id>] key — if changed from the original, that's a
    // new entry; the caller saves under the new id. We pass the (possibly new)
    // id through onSave via the original's slot so the parent can delete+create.
    onSave(modelId.trim(), name, contextWindow, reasoning, original ? { ...original, modelId: modelId.trim() } : undefined);
  };

  return (
    <div className="models-settings-panel__editor-overlay" role="dialog" aria-modal="true">
      <div className="models-settings-panel__editor models-settings-panel__editor--narrow">
        <header className="models-settings-panel__editor-header">
          <div className="models-settings-panel__editor-title-group">
            <div className="models-settings-panel__editor-title">
              {original ? "编辑模型" : "添加模型"}
            </div>
            <div className="models-settings-panel__editor-note">所属厂商：{providerId}</div>
          </div>
          <button
            className="cb-button cb-button--ghost cb-button--small cb-button--icon-only"
            onClick={onCancel}
            aria-label="关闭"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="models-settings-panel__editor-body">
          <div className="models-settings-panel__field">
            <label className="models-settings-panel__label">模型 ID</label>
            <div className="models-settings-panel__input-shell">
              <input
                className="models-settings-panel__input"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="如 gpt-4o、claude-sonnet-4-5、deepseek-chat"
                disabled={!!original}
              />
            </div>
          </div>
          <div className="models-settings-panel__field">
            <label className="models-settings-panel__label">显示名称（可选）</label>
            <div className="models-settings-panel__input-shell">
              <input
                className="models-settings-panel__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如 我的 GPT-4o"
              />
            </div>
          </div>
          <div className="models-settings-panel__field">
            <label className="models-settings-panel__label">
              上下文窗口（tokens，可选，覆盖厂商设置）
            </label>
            <div className="models-settings-panel__input-shell">
              <input
                className="models-settings-panel__input"
                type="number"
                min={1}
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="如 128000（留空用厂商默认）"
              />
            </div>
          </div>
          <div className="models-settings-panel__field">
            <label className="models-settings-panel__checkbox-row">
              <input
                type="checkbox"
                checked={reasoning}
                onChange={(e) => setReasoning(e.target.checked)}
              />
              <span>
                支持推理 / 深度思考
                <span className="models-settings-panel__hint">
                  （开启后可切换思考强度并展示“深度思考”过程，如 MiniMax-M3、Claude、DeepSeek-R1）
                </span>
              </span>
            </label>
          </div>
          {error && <div className="models-settings-panel__editor-error">{error}</div>}
        </div>

        <footer className="models-settings-panel__editor-footer">
          <button
            className="cb-button cb-button--secondary cb-button--medium models-settings-panel__editor-cancel"
            onClick={onCancel}
          >
            <span className="cb-button__content">取消</span>
          </button>
          <button
            className="cb-button cb-button--primary cb-button--medium models-settings-panel__editor-save"
            onClick={handleSaveClick}
            disabled={!canSave}
          >
            <span className="cb-button__content">保存</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline "拉取模型" panel: enter API key → GET /models → pick many → import.
// ---------------------------------------------------------------------------

function ImportModelsInline({
  provider,
  existingModelIds,
  onClose,
  onImport,
}: {
  provider: ModelProviderEntry;
  existingModelIds: Set<string>;
  onClose: () => void;
  onImport: (ids: string[]) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<FetchedModel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const handleFetch = async () => {
    setErr(null);
    if (provider.providerKind === "new_api") {
      setFetching(true);
      try {
        const models = await providersFetchModels(provider.providerKind, undefined, provider.baseUrl ?? undefined);
        if (models.length === 0) setErr("当前租户没有可用模型。");
        setFetched(models);
        setSelected(new Set());
      } catch (e) {
        setFetched([]);
        setErr(String(e));
      } finally {
        setFetching(false);
      }
      return;
    }
    const key = apiKey.trim();
    if (!key) {
      setErr("请填写该厂商的 API Key 以拉取模型列表。");
      return;
    }
    setFetching(true);
    try {
      const models = await providersFetchModels(
        provider.providerKind,
        key,
        provider.baseUrl ?? undefined,
      );
      if (models.length === 0) setErr("该端点没有返回任何模型。");
      setFetched(models);
      setSelected(new Set());
    } catch (e) {
      setFetched([]);
      setErr(String(e));
    } finally {
      setFetching(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(
      selected.size === fetched.length ? new Set() : new Set(fetched.map((m) => m.id)),
    );

  return (
    <div className="models-settings-panel__import">
      <div className="models-settings-panel__import-row">
        <input
          className="models-settings-panel__input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider.providerKind === "new_api" ? "企业会话自动鉴权" : "API Key（仅用于本次拉取，不会保存）"}
          disabled={provider.providerKind === "new_api"}
        />
        <button
          className="cb-button cb-button--secondary cb-button--small"
          onClick={handleFetch}
          disabled={fetching}
          type="button"
        >
          <span className="cb-button__content">
            {fetching ? (
              <Loader2 size={13} strokeWidth={2} className="models-settings-panel__spin" />
            ) : (
              <RefreshCw size={13} strokeWidth={2} style={{ marginRight: 4 }} />
            )}
            {fetching ? "获取中…" : "获取"}
          </span>
        </button>
        <button
          className="cb-button cb-button--ghost cb-button--small cb-button--icon-only"
          onClick={onClose}
          aria-label="关闭"
          type="button"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      {err && <div className="models-settings-panel__fetch-error">{err}</div>}

      {fetched.length > 0 && (
        <div className="models-settings-panel__fetch-list">
          <div className="models-settings-panel__fetch-list-header">
            <span>
              找到 {fetched.length} 个模型
              {selected.size > 0 && ` · 已选 ${selected.size}`}
            </span>
            <button
              className="cb-button cb-button--ghost cb-button--small models-settings-panel__fetch-select-all"
              onClick={toggleAll}
              type="button"
            >
              {selected.size === fetched.length ? "全不选" : "全选"}
            </button>
          </div>
          <ul className="models-settings-panel__fetch-items">
            {fetched.map((m) => {
              const checked = selected.has(m.id);
              const configured = existingModelIds.has(m.id);
              return (
                <li key={m.id}>
                  <label className="models-settings-panel__fetch-item">
                    <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} />
                    <span className="models-settings-panel__fetch-item-id">{m.id}</span>
                    {m.ownedBy && (
                      <span className="models-settings-panel__fetch-item-owner">{m.ownedBy}</span>
                    )}
                    {configured && (
                      <span className="models-settings-panel__fetch-item-badge">已配置</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="models-settings-panel__import-footer">
            <button
              className="cb-button cb-button--primary cb-button--small"
              disabled={selected.size === 0}
              onClick={() => onImport([...selected])}
              type="button"
            >
              <span className="cb-button__content">导入 {selected.size > 0 ? selected.size : ""} 个模型</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
