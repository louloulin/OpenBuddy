/**
 * PiPackageCard — pi.dev 风格的单包卡片。
 *
 * 视觉骨架(借鉴 pi.dev):
 *   ┌──────────┬────────────────────────────────────┬────────────┐
 *   │ preview  │ <h3>name</h3>                      │ install    │
 *   │ frame    │ <p>description</p>                 │ $ pi ...   │
 *   │ (stub)   │ <author · downloads/mo · age>      │ [Copy]     │
 *   │          │ [type pill] [npm] [repo] [report]  │            │
 *   └──────────┴────────────────────────────────────┴────────────┘
 *
 * 纯 props 组件:`onCopy` / `onInstall` / `onOpen` 由宿主注入。预览区域(stub)
 * 当前用主题色块占位,后续接 Theme Studio 时替换为真实 preview iframe。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INSTALL_STATE_LABELS,
  MARKETPLACE_KIND_LABELS,
  classifyVersion,
  resolveInstallState,
  type MarketplaceEntry,
} from "../marketplace-model";
import {
  buildInstallCommand,
  formatDownloads,
  formatRelative,
  previewAccent,
} from "./format";
import styles from "./PiPackageCard.module.css";

export interface PiPackageCardProps {
  entry: MarketplaceEntry;
  query?: string;
  /** 卡片主色调,留 preview 接入点(目前用 stub 颜色)。 */
  accentColor?: string;
  installing?: boolean;
  /**
   * 当前卡片是否被键盘 roving focus 选中(由 usePiMarketRovingFocus 控制)。
   * 为 true 时渲染 `data-roving-active="true"` 并加 active CSS 类。
   */
  active?: boolean;
  onOpen?: (entry: MarketplaceEntry) => void;
  /** 触发 "Install from UI" 二级动作;只在 source=community/local 时显示。 */
  onInstall?: (entry: MarketplaceEntry) => void;
  /** 复制命令后回调(便于上层做 toast)。 */
  onCopied?: (entry: MarketplaceEntry, command: string) => void;
  className?: string;
}

export interface PiPackageCardLabels {
  /** 默认 "复制"。 */
  copyLabel: string;
  /** 复制成功后的反馈,默认 "已复制"。 */
  copiedLabel: string;
  /** 默认 "安装"。 */
  installLabel: string;
  /** 安装进行中,默认 "安装中…"。 */
  installingLabel: string;
}

export const PI_PACKAGE_CARD_DEFAULT_LABELS: PiPackageCardLabels = {
  copyLabel: "复制",
  copiedLabel: "已复制",
  installLabel: "安装",
  installingLabel: "安装中…",
};

function Highlighted({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (lower.indexOf(lowerNeedle) < 0) return <>{text}</>;
  // 全部出现都要高亮(pi.dev/npm 都这样)。原始大小写切片靠 text 自身的 indexOf,
  // 避免 Turkish dotted-i 这类 lowercasing 后长度会变的字符造成切片错位。
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let safety = 0;
  while (cursor < text.length && safety < 32) {
    safety += 1;
    const next = text.toLowerCase().indexOf(lowerNeedle, cursor);
    if (next < 0) break;
    if (next > cursor) parts.push(text.slice(cursor, next));
    parts.push(
      <mark key={`${next}-${cursor}`} className={styles.mark}>
        {text.slice(next, next + lowerNeedle.length)}
      </mark>,
    );
    cursor = next + lowerNeedle.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  if (parts.length === 0) return <>{text}</>;
  return <>{parts}</>;
}

export function PiPackageCard(props: PiPackageCardProps) {
  const { entry, query, accentColor, installing, onOpen, onInstall, onCopied, className, labels: labelsProp, active } = props;
  const labels: PiPackageCardLabels = { ...PI_PACKAGE_CARD_DEFAULT_LABELS, ...(labelsProp ?? {}) };
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  const installCmd = useMemo(
    () => entry.installCommand ?? buildInstallCommand(entry.npmName, entry.id),
    [entry.installCommand, entry.npmName, entry.id],
  );

  const relation = classifyVersion(entry.installedVersion, entry.version, {
    incompatible: entry.incompatible,
  });
  const installState = resolveInstallState({
    installedVersion: entry.installedVersion,
    version: entry.version,
    incompatible: entry.incompatible,
    installing,
    blockedReason: entry.blockedReason,
  });

  const primaryKind = entry.primaryKind ?? entry.kinds[0] ?? "plugin";
  const kindLabel = MARKETPLACE_KIND_LABELS[primaryKind] ?? primaryKind;
  const accent = accentColor ?? previewAccent(entry.id, "var(--wb-accent)");

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(installCmd);
      }
      setCopied(true);
      onCopied?.(entry, installCmd);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // 静默:旧 Webview 不一定有 clipboard API。
      setCopied(false);
    }
  }, [installCmd, entry, onCopied]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const downloads = formatDownloads(entry.downloadsLastMonth);
  const updated = formatRelative(entry.updatedAt);

  const metaParts: string[] = [];
  if (entry.publisher) metaParts.push(entry.publisher);
  if (downloads) metaParts.push(downloads);
  if (updated) metaParts.push(updated);
  if (relation === "downgrade" && entry.installedVersion) {
    metaParts.push(`downgrade ${entry.installedVersion} → ${entry.version}`);
  }

  return (
    <article
      className={[styles.card, active ? styles.cardActive : null, className].filter(Boolean).join(" ")}
      data-testid="pi-package-card"
      data-entry-id={entry.id}
      data-install-state={installState}
      data-primary-kind={primaryKind}
      data-roving-active={active ? "true" : undefined}
      aria-current={active ? "true" : undefined}
    >
      <button
        type="button"
        className={styles.preview}
        onClick={() => onOpen?.(entry)}
        aria-label={`Open ${entry.name}`}
        style={{ ["--pi-card-accent" as string]: accent }}
        data-testid="pi-package-card-preview"
      >
        <span className={styles.previewFrame} aria-hidden>
          <span className={styles.previewStripeA} />
          <span className={styles.previewStripeB} />
          <span className={styles.previewStripeC} />
        </span>
      </button>

      <div className={styles.body}>
        <div className={styles.headRow}>
          <h3 className={styles.name}>
            <button
              type="button"
              className={styles.nameButton}
              onClick={() => onOpen?.(entry)}
              data-testid="pi-package-card-open"
            >
              <Highlighted text={entry.name} query={query} />
            </button>
          </h3>
          <span className={[styles.kindPill, styles[`k_${primaryKind}`]].join(" ")} data-testid="pi-package-kind">
            {kindLabel}
          </span>
          {installState !== "available" ? (
            <span
              className={[styles.statePill, styles[`s_${installState}`]].join(" ")}
              data-testid="pi-package-install-state"
            >
              {INSTALL_STATE_LABELS[installState]}
            </span>
          ) : null}
        </div>

        <p className={styles.description}>
          <Highlighted text={entry.description} query={query} />
        </p>

        <div className={styles.meta}>
          {metaParts.map((part, index) => (
            <span key={`${index}-${part}`} className={styles.metaPart}>
              {index > 0 ? <span className={styles.metaDot} aria-hidden>·</span> : null}
              <span>{part}</span>
            </span>
          ))}
          {entry.sourceLabel ? (
            <span className={styles.sourceLabel} title={`source: ${entry.sourceLabel}`}>
              <span className={styles.metaDot} aria-hidden>·</span>
              <span>source: {entry.sourceLabel}</span>
            </span>
          ) : null}
        </div>

        <div className={styles.links}>
          {entry.npmUrl ? (
            <a
              className={styles.link}
              href={entry.npmUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="pi-package-link-npm"
            >
              <span aria-hidden className={styles.linkIcon}>📦</span>
              npm
            </a>
          ) : null}
          {entry.repoUrl ? (
            <a
              className={styles.link}
              href={entry.repoUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="pi-package-link-repo"
            >
              <span aria-hidden className={styles.linkIcon}>↗</span>
              repo
            </a>
          ) : null}
          {entry.reportUrl ? (
            <a
              className={styles.link}
              href={entry.reportUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="pi-package-link-report"
            >
              <span aria-hidden className={styles.linkIcon}>!</span>
              report
            </a>
          ) : null}
        </div>
      </div>

      {entry.blockedReason ? (
        <span
          id={`pi-package-blocked-${entry.id}`}
          role="note"
          className={styles.blockedNote}
          data-testid="pi-package-blocked-note"
        >
          {entry.blockedReason}
        </span>
      ) : null}

      <div className={styles.install}>
        <code className={styles.installCmd} data-testid="pi-package-install-cmd">
          $ {installCmd}
        </code>
        <div className={styles.installActions}>
          <button
            type="button"
            className={styles.copyButton}
            onClick={handleCopy}
            aria-label={`Copy install command for ${entry.name}`}
            data-testid="pi-package-copy"
          >
            {copied ? labels.copiedLabel : labels.copyLabel}
          </button>
          {entry.sourceKind && entry.sourceKind !== "official" && onInstall ? (
            <button
              type="button"
              className={styles.installButton}
              onClick={() => onInstall(entry)}
              disabled={installState === "installing" || installState === "blocked"}
              aria-describedby={entry.blockedReason ? `pi-package-blocked-${entry.id}` : undefined}
              title={entry.blockedReason}
              data-testid="pi-package-install"
            >
              {installState === "installing" ? labels.installingLabel : labels.installLabel}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
