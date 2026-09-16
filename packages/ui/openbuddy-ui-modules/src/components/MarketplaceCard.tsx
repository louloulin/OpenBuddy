/**
 * MarketplaceCard — 市场条目的单卡呈现。
 *
 * 纯 props 组件:安装/打开/升级/回滚全部由宿主注入回调,组件不直接调用
 * IPC。卡片自身只保留两处交互状态(溢出菜单开关),其它状态
 * (installing / installState)由 entry + 宿主传入的 installing 派生。
 */
import { useEffect, useId, useRef, useState } from "react";
import { CapabilityVersionBadge } from "./CapabilityVersionBadge";
import {
  INSTALL_STATE_LABELS,
  MARKETPLACE_KIND_LABELS,
  capabilityRisk,
  classifyVersion,
  formatBytes,
  highlightSegments,
  resolveInstallState,
  summarizeCapabilities,
  type InstallState,
  type MarketplaceEntry,
} from "./marketplace-model";
import styles from "./MarketplaceCard.module.css";

export interface MarketplaceMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: (entry: MarketplaceEntry) => void;
}

export interface MarketplaceCardProps {
  entry: MarketplaceEntry;
  /** grid(默认)= 卡片;list = 单行紧凑布局。 */
  layout?: "grid" | "list";
  /** 当前搜索词,用于命中高亮。 */
  query?: string;
  /** 宿主已知的「安装中」状态(entry 上不带该字段)。 */
  installing?: boolean;
  onOpen?: (entry: MarketplaceEntry) => void;
  onInstall?: (entry: MarketplaceEntry) => void;
  onUpgrade?: (entry: MarketplaceEntry) => void;
  onRollback?: (entry: MarketplaceEntry) => void;
  menuItems?: readonly MarketplaceMenuItem[];
  className?: string;
}

interface PrimaryAction {
  label: string;
  kind: "install" | "upgrade" | "none";
  disabled: boolean;
  loading: boolean;
  title?: string;
}

/** 由安装状态推导主操作按钮。导出以便单测覆盖优先级。 */
export function primaryActionFor(state: InstallState, blockedReason?: string): PrimaryAction {
  switch (state) {
    case "installing":
      return { label: "安装中…", kind: "none", disabled: true, loading: true };
    case "blocked":
      return {
        label: "不可用",
        kind: "none",
        disabled: true,
        loading: false,
        ...(blockedReason ? { title: blockedReason } : {}),
      };
    case "installed":
      return { label: "已安装", kind: "none", disabled: true, loading: false };
    case "update-available":
      return { label: "更新", kind: "upgrade", disabled: false, loading: false };
    case "available":
    default:
      return { label: "安装", kind: "install", disabled: false, loading: false };
  }
}

function Highlighted({ text, query }: { text: string; query?: string }) {
  const segments = highlightSegments(text, query ?? "");
  if (segments.length === 1 && !segments[0].match) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className={styles.mark}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function MarketplaceCard(props: MarketplaceCardProps) {
  const {
    entry,
    layout = "grid",
    query,
    installing,
    onOpen,
    onInstall,
    onUpgrade,
    onRollback,
    menuItems,
    className,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpen]);

  const state = resolveInstallState({
    installedVersion: entry.installedVersion,
    version: entry.version,
    incompatible: entry.incompatible,
    installing,
    blockedReason: entry.blockedReason,
  });
  const action = primaryActionFor(state, entry.blockedReason);
  // 市场推荐版本比本地安装版本旧 → 暴露回滚入口(与徽标的 downgrade 语义一致)。
  const relation = classifyVersion(entry.installedVersion, entry.version);
  const canRollback = relation === "downgrade" && typeof onRollback === "function";
  const summary = summarizeCapabilities(entry.capabilities, 3);
  const size = formatBytes(entry.installedBytes);
  const icon = entry.icon ?? entry.name.trim().charAt(0).toUpperCase();

  const handlePrimary = () => {
    if (action.disabled) return;
    if (action.kind === "upgrade") onUpgrade?.(entry);
    else onInstall?.(entry);
  };

  const items = (menuItems ?? []).filter(Boolean);

  return (
    <div
      ref={rootRef}
      className={[styles.card, layout === "list" ? styles.list : "", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="marketplace-card"
      data-entry-id={entry.id}
      data-install-state={state}
    >
      <button
        type="button"
        className={styles.body}
        onClick={() => onOpen?.(entry)}
        data-testid="marketplace-card-open"
        aria-label={`打开 ${entry.name}`}
      >
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
        <span className={styles.main}>
          <span className={styles.titleRow}>
            <span className={styles.name}>
              <Highlighted text={entry.name} query={query} />
            </span>
            <span
              className={[styles.stateBadge, styles[`s_${state}`]].join(" ")}
              data-testid="install-state"
            >
              {INSTALL_STATE_LABELS[state]}
            </span>
          </span>
          <span className={styles.publisher}>{entry.publisher}</span>
          <span className={styles.description}>
            <Highlighted text={entry.description} query={query} />
          </span>
          {summary.total > 0 ? (
            <span className={styles.chips} data-testid="capability-chips">
              {summary.shown.map((capability) => (
                <span
                  key={capability.id}
                  className={[styles.chip, styles[`c_${capabilityRisk(capability)}`]].join(" ")}
                  title={capability.detail ?? capability.label ?? capability.id}
                >
                  {capability.label ?? capability.id}
                </span>
              ))}
              {summary.hiddenCount > 0 ? (
                <span className={styles.chipMore}>+{summary.hiddenCount}</span>
              ) : null}
            </span>
          ) : null}
          <span className={styles.metaRow}>
            <CapabilityVersionBadge
              compact
              version={entry.version}
              current={entry.installedVersion}
              incompatible={entry.incompatible}
              installing={installing}
            />
            {entry.kinds.map((kind) => (
              <span key={kind} className={styles.kind}>
                {MARKETPLACE_KIND_LABELS[kind]}
              </span>
            ))}
            {size ? <span className={styles.size}>{size}</span> : null}
          </span>
        </span>
      </button>
      <div className={styles.trailing}>
        <button
          type="button"
          className={[styles.primary, action.kind === "none" ? styles.primaryMuted : ""].join(" ")}
          onClick={handlePrimary}
          disabled={action.disabled}
          title={action.title}
          data-testid="marketplace-card-primary"
          data-action={action.kind}
        >
          {action.loading ? <span className={styles.spinner} aria-hidden /> : null}
          {action.label}
        </button>
        {canRollback ? (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => onRollback?.(entry)}
            title={`可回滚:回滚到 ${entry.version}(当前 ${entry.installedVersion ?? "?"})`}
            data-testid="marketplace-card-rollback"
          >
            回滚
          </button>
        ) : null}
        {items.length > 0 ? (
          <div className={styles.menuWrap}>
            <button
              type="button"
              className={styles.menuButton}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuOpen((open) => !open)}
              data-testid="marketplace-card-menu"
              title="更多操作"
            >
              ⋯
            </button>
            {menuOpen ? (
              <div
                className={styles.menu}
                role="menu"
                id={menuId}
                data-testid="marketplace-card-menu-list"
              >
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={[styles.menuItem, item.danger ? styles.menuItemDanger : ""].join(
                      " ",
                    )}
                    disabled={item.disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      item.onSelect(entry);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {entry.blockedReason ? <div className={styles.blockedNote}>{entry.blockedReason}</div> : null}
    </div>
  );
}
