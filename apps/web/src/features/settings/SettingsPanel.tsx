import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Info,
  Mail,
  Keyboard,
  Cpu,
  Bot,
  Palette,
  Shield,
  HelpCircle,
  SlidersHorizontal,
  Smartphone,
  FolderOpen,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { useFocusTrap } from "@/shared/ui/use-focus-trap";
import { ModelsSettingsPanel } from "../models/settings/ModelsSettingsPanel";
import {
  AboutSettingsPanel,
  AgentMailSettingsPanel,
  AgentSettingsPanel,
  AssistantSettingsPanel,
  DataSettingsPanel,
  GeneralPreferencesPanel,
  DefaultOpenPanel,
  HelpSettingsPanel,
  MemorySettingsPanel,
  PersonalizeSettingsPanel,
  SecuritySettingsPanel,
  MobileAccessPanel,
  ShortcutsSettingsPanel,
} from "./SettingsSections";
import { useLocale } from "../../shared/i18n";



type SectionId =
  | "about"
  | "agent-mail"
  | "general"
  | "default-open"
  | "agent-settings"
  | "shortcuts"
  | "memory"
  | "model"
  | "assistant"
  | "personalize"
  | "data"
  | "security"
  | "mobile"
  | "help";

interface NavItem {
  id: SectionId;
  label: string;
  icon: LucideIcon;
}

/** A section supplied by the app's FeatureRegistry (pii W0.2): only the ones the host can serve. */
export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  render: (props: { onModelsChanged?: () => void }) => ReactNode;
  /** Navigation group; defaults to a per-id mapping below. */
  group?: SettingsGroup;
  /** Extra search terms (Chinese + English). */
  keywords?: string[];
}

type SettingsGroup = "settings" | "feature" | "data" | "about";
const GROUP_ORDER: SettingsGroup[] = ["settings", "feature", "data", "about"];
const GROUP_FALLBACK: Record<SettingsGroup, string> = {
  settings: "设置",
  feature: "功能",
  data: "数据与安全",
  about: "关于",
};
/** Mirrors WorkBuddy's grouped settings nav; also supplies search keywords. */
const SECTION_META: Record<string, { group: SettingsGroup; keywords: string[] }> = {
  general: { group: "settings", keywords: ["主题", "语言", "字号", "发送", "托盘", "快速输入", "theme", "language", "font"] },
  model: { group: "feature", keywords: ["模型", "服务商", "api key", "本地模型", "model", "provider"] },
  assistant: { group: "feature", keywords: ["助理", "默认", "assistant"] },
  "agent-settings": { group: "feature", keywords: ["智能体", "思考", "工具", "agent"] },
  security: { group: "data", keywords: ["安全", "权限", "受保护", "路径", "security", "permission"] },
  personalize: { group: "feature", keywords: ["个性化", "风格", "personalization"] },
  memory: { group: "feature", keywords: ["记忆", "资料库", "memory"] },
  shortcuts: { group: "settings", keywords: ["快捷键", "shortcut", "keyboard"] },
  conversation: { group: "feature", keywords: ["对话流", "工具展示", "简洁", "详细", "conversation", "tool display"] },
  "agent-mail": { group: "feature", keywords: ["邮箱", "通知", "mail", "notification"] },
  data: { group: "data", keywords: ["数据", "导入", "导出", "备份", "data", "export", "backup"] },
  mobile: { group: "data", keywords: ["手机", "配对", "设备", "mobile", "pairing"] },
  help: { group: "about", keywords: ["帮助", "反馈", "日志", "help", "feedback", "logs"] },
  about: { group: "about", keywords: ["关于", "版本", "更新", "about", "version", "update"] },
};

const NAV: NavItem[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "default-open", label: "默认打开方式", icon: FolderOpen },
  { id: "agent-mail", label: "智能体邮箱", icon: Mail },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "model", label: "模型", icon: Cpu },
  { id: "agent-settings", label: "智能体", icon: SlidersHorizontal },
  { id: "assistant", label: "助理设置", icon: Bot },
  { id: "personalize", label: "个性化", icon: Palette },
  { id: "security", label: "安全中心", icon: Shield },
  { id: "mobile", label: "手机接入", icon: Smartphone },
  { id: "help", label: "帮助与反馈", icon: HelpCircle },
  { id: "about", label: "关于", icon: Info },
];

export function SettingsPanel({
  open,
  onClose,
  onModelsChanged,
  initialSection,
  sections,
}: {
  /** Registry sections; without them the built-in list below is used (standalone / legacy). */
  sections?: SettingsSection[];
  open: boolean;
  onClose: () => void;
  /** Section to show when opened (defaults to 模型). */
  initialSection?: string;
  /** Called after a provider is saved/deleted so the app can refresh its
   *  model picker without a restart. */
  onModelsChanged?: () => void;
}) {
  const [active, setActive] = useState<string>("model");
  const [query, setQuery] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, open);
  const { tOptional } = useLocale();
  const labelOf = (id: string, fallback: string) => tOptional(`settings.nav.${id}`) ?? fallback;
  const nav = sections ?? NAV;
  const items = nav.map((item) => {
    const meta = SECTION_META[item.id];
    const section = item as SettingsSection;
    return {
      id: item.id,
      label: labelOf(item.id, item.label),
      icon: item.icon,
      group: section.group ?? meta?.group ?? ("settings" as SettingsGroup),
      keywords: [...(section.keywords ?? []), ...(meta?.keywords ?? [])],
    };
  });
  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter((item) => [item.label, item.id, ...item.keywords].some((text) => text.toLowerCase().includes(q)))
    : items;
  const ids = items.map((item) => item.id).join(" ");
  const groupLabel = (group: SettingsGroup) => tOptional(`settings.group.${group}`) ?? GROUP_FALLBACK[group];

  // Open at the requested section (deep link), defaulting to 模型 (or the first one served).
  useEffect(() => {
    if (!open) return;
    const has = (id?: string) => !!id && ids.split(" ").includes(id);
    setActive(has(initialSection) ? initialSection! : has("model") ? "model" : ids.split(" ")[0] ?? "model");
  }, [open, initialSection, ids]);

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
      ref={modalRef}
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
          <label className="settings-nav-search">
            <Search size={14} strokeWidth={1.75} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tOptional("settings.search.placeholder") ?? "搜索设置"}
              aria-label={tOptional("settings.search.placeholder") ?? "搜索设置"}
            />
          </label>
          {visible.length === 0 ? (
            <p className="settings-nav-empty">{tOptional("settings.search.empty") ?? "没有匹配的设置"}</p>
          ) : (
            GROUP_ORDER.map((group) => {
              const groupItems = visible.filter((item) => item.group === group);
              if (!groupItems.length) return null;
              return (
                <div key={group} className="settings-navigation__group">
                  <div className="settings-navigation__group-title">{groupLabel(group)}</div>
                  <ul className="settings-navigation">
                    {groupItems.map((item) => {
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
                </div>
              );
            })
          )}
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
            {sections ? (
              sections.find((section) => section.id === active)?.render({ onModelsChanged }) ?? null
            ) : active === "model" ? (
              <ModelsSettingsPanel onModelsChanged={onModelsChanged} />
            ) : active === "personalize" ? (
              <PersonalizeSettingsPanel />
            ) : active === "shortcuts" ? (
              <ShortcutsSettingsPanel />
            ) : active === "memory" ? (
              <MemorySettingsPanel />
            ) : active === "help" ? (
              <HelpSettingsPanel />
            ) : active === "mobile" ? (
              <MobileAccessPanel />
            ) : active === "security" ? (
              <SecuritySettingsPanel />
            ) : active === "default-open" ? (
              <DefaultOpenPanel />
            ) : active === "data" ? (
              <DataSettingsPanel />
            ) : active === "general" ? (
              <GeneralPreferencesPanel />
            ) : active === "about" ? (
              <AboutSettingsPanel />
            ) : active === "agent-settings" ? (
              <AgentSettingsPanel />
            ) : active === "assistant" ? (
              <AssistantSettingsPanel />
            ) : active === "agent-mail" ? (
              <AgentMailSettingsPanel />
            ) : (
              <PlaceholderSection label={NAV.find((n) => n.id === active)?.label ?? ""} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder for the 11 not-yet-implemented sections.
// ---------------------------------------------------------------------------

function PlaceholderSection({ label }: { label: string }) {
  return (
    <div className="settings-placeholder">
      <h2 className="settings-placeholder__title">{label}</h2>
      <p className="settings-placeholder__desc">该分区即将上线，敬请期待。</p>
    </div>
  );
}
