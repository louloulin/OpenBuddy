import { useEffect, useState } from "react";
import {
  User,
  Mail,
  Keyboard,
  Cpu,
  Bot,
  Palette,
  Shield,
  HelpCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { ModelsSettingsPanel } from "./models-settings/ModelsSettingsPanel";
import {
  AccountSettingsPanel,
  AgentMailSettingsPanel,
  AgentSettingsPanel,
  AssistantSettingsPanel,
  DataSettingsPanel,
  GeneralSettingsPanel,
  HelpSettingsPanel,
  MemorySettingsPanel,
  PersonalizeSettingsPanel,
  SecuritySettingsPanel,
  ShortcutsSettingsPanel,
} from "./SettingsSections";



type SectionId =
  | "account"
  | "agent-mail"
  | "general"
  | "agent-settings"
  | "shortcuts"
  | "memory"
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
}

const NAV: NavItem[] = [
  { id: "account", label: "账户管理", icon: User },
  { id: "agent-mail", label: "智能体邮箱", icon: Mail },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "model", label: "模型", icon: Cpu },
  { id: "assistant", label: "助理设置", icon: Bot },
  { id: "personalize", label: "个性化", icon: Palette },
  { id: "security", label: "安全中心", icon: Shield },
  { id: "help", label: "帮助与反馈", icon: HelpCircle },
];

export function SettingsPanel({
  open,
  onClose,
  onModelsChanged,
  initialSection,
}: {
  open: boolean;
  onClose: () => void;
  /** Section to show when opened (defaults to 模型). */
  initialSection?: string;
  /** Called after a provider is saved/deleted so the app can refresh its
   *  model picker without a restart. */
  onModelsChanged?: () => void;
}) {
  const [active, setActive] = useState<SectionId>("model");

  // Open at the requested section (deep link), defaulting to 模型.
  useEffect(() => {
    if (open) setActive(NAV.some((item) => item.id === initialSection) ? (initialSection as SectionId) : "model");
  }, [open, initialSection]);

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
            {NAV.map((item) => {
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
            ) : active === "memory" ? (
              <MemorySettingsPanel />
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
