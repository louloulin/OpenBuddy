/**
 * InstallDialog — 安装 / 升级确认对话框。
 *
 * 通过 portal 挂到 document.body(避免被面板的 overflow 裁切),自建
 * Esc 关闭 + Tab 焦点环 + 初始焦点,不依赖第三方 dialog 库 —— 与
 * `@openbuddy/ui-primitives` 的 Modal 相比这里需要版本选择、权限清单、
 * 进度与错误三段式内容,单独实现更清晰。
 *
 * 所有动作通过 props 回调交给宿主,组件不直接调用 IPC。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CAPABILITY_RISK_LABELS,
  VERSION_RELATION_LABELS,
  capabilityRisk,
  classifyVersion,
  formatBytes,
  summarizeCapabilities,
  type MarketplaceCapability,
  type MarketplaceEntry,
} from "./marketplace-model";
import styles from "./InstallDialog.module.css";

export interface InstallProgress {
  /** 阶段文案,例如「下载中」「校验签名」「写入磁盘」。 */
  phase: string;
  /** 0-100;缺省时显示不确定进度条。 */
  percent?: number;
}

export interface InstallDialogProps {
  open: boolean;
  entry?: MarketplaceEntry;
  /** 可选版本(降序或任意顺序,内部会按 semver 排序)。缺省时只用 entry.version。 */
  versions?: readonly string[];
  /** 受控版本选择;缺省时组件内部维护。 */
  version?: string;
  onVersionChange?: (version: string) => void;
  /** 依赖清单(名称 + 可选版本约束)。 */
  dependencies?: readonly string[];
  /** 预估安装体积(字节)。 */
  installBytes?: number;
  progress?: InstallProgress | null;
  error?: string | null;
  /** 高风险能力需要显式勾选同意。 */
  requireConsent?: boolean;
  consentChecked?: boolean;
  onConsentChange?: (checked: boolean) => void;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: (options: { version: string; allowHighRisk: boolean }) => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function InstallDialog(props: InstallDialogProps) {
  const {
    open,
    entry,
    versions,
    version,
    onVersionChange,
    dependencies,
    installBytes,
    progress,
    error,
    requireConsent,
    consentChecked,
    onConsentChange,
    busy,
    confirmLabel,
    onConfirm,
    onCancel,
  } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [internalVersion, setInternalVersion] = useState<string | undefined>(undefined);
  const [internalConsent, setInternalConsent] = useState(false);

  const orderedVersions = useMemo(() => {
    const list = versions && versions.length > 0 ? [...versions] : entry ? [entry.version] : [];
    return [...new Set(list)].sort((a, b) => {
      const verdict = classifyVersion(a, b);
      if (verdict === "upgrade") return 1; // b 更新 → b 在前
      if (verdict === "downgrade") return -1;
      return 0;
    });
  }, [versions, entry]);

  const selectedVersion = version ?? internalVersion ?? orderedVersions[0] ?? entry?.version ?? "";
  const consent = consentChecked ?? internalConsent;
  const summary = summarizeCapabilities(entry?.capabilities, 99);
  const needsConsent = requireConsent ?? summary.hasHighRisk;
  const blocked = needsConsent && !consent;
  const size = formatBytes(installBytes ?? entry?.installedBytes);

  const selectVersion = useCallback(
    (next: string) => {
      if (version === undefined) setInternalVersion(next);
      onVersionChange?.(next);
    },
    [version, onVersionChange],
  );

  const toggleConsent = useCallback(
    (next: boolean) => {
      if (consentChecked === undefined) setInternalConsent(next);
      onConsentChange?.(next);
    },
    [consentChecked, onConsentChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      // 只按语义筛可选元素:不用 offsetParent 判断可见性 —— 对话框本体是
      // position: fixed,其子树在部分浏览器里 offsetParent 为 null,会把
      // 全部候选误判为不可见。
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const target = node.querySelector<HTMLElement>(FOCUSABLE) ?? node;
    target.focus();
  }, [open]);

  if (!open || !entry) return null;

  const relation = classifyVersion(entry.installedVersion, selectedVersion);

  const content = (
    <div
      className={styles.backdrop}
      data-testid="install-dialog-backdrop"
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`安装 ${entry.name}`}
        tabIndex={-1}
        data-testid="install-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <span className={styles.icon} aria-hidden>
            {entry.icon ?? entry.name.charAt(0).toUpperCase()}
          </span>
          <div className={styles.headerText}>
            <h2 className={styles.title}>安装 {entry.name}</h2>
            <p className={styles.subtitle}>
              {entry.publisher} · {VERSION_RELATION_LABELS[relation]}
              {entry.installedVersion && entry.installedVersion !== selectedVersion
                ? ` · 当前 ${entry.installedVersion}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onCancel}
            disabled={busy}
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {orderedVersions.length > 1 ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>版本</span>
              <select
                className={styles.select}
                value={selectedVersion}
                disabled={busy}
                onChange={(event) => selectVersion(event.target.value)}
                data-testid="install-dialog-version"
              >
                {orderedVersions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                    {item === entry.version ? "(最新)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>版本</span>
              <span className={styles.staticValue}>{selectedVersion}</span>
            </div>
          )}

          <section className={styles.section} aria-label="能力与权限">
            <h3 className={styles.sectionTitle}>能力与权限({summary.total})</h3>
            {summary.total === 0 ? (
              <p className={styles.muted}>此条目未声明额外能力。</p>
            ) : (
              <ul className={styles.list} data-testid="install-dialog-capabilities">
                {(entry.capabilities ?? []).map((capability: MarketplaceCapability) => (
                  <li key={capability.id} className={styles.listItem}>
                    <span className={styles.capName}>{capability.label ?? capability.id}</span>
                    <span className={styles.capId}>{capability.id}</span>
                    <span
                      className={[styles.riskTag, styles[`r_${capabilityRisk(capability)}`]].join(
                        " ",
                      )}
                    >
                      {CAPABILITY_RISK_LABELS[capabilityRisk(capability)]}
                    </span>
                    {capability.detail ? (
                      <span className={styles.capDetail}>{capability.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {dependencies && dependencies.length > 0 ? (
            <section className={styles.section} aria-label="依赖">
              <h3 className={styles.sectionTitle}>依赖({dependencies.length})</h3>
              <ul className={styles.list} data-testid="install-dialog-dependencies">
                {dependencies.map((dependency) => (
                  <li key={dependency} className={styles.listItem}>
                    <span className={styles.capName}>{dependency}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className={styles.impact} data-testid="install-dialog-impact">
            {size ? `预计占用磁盘 ${size}` : "占用磁盘空间取决于解压后的体积"}
            {entry.dependencies && entry.dependencies.length > 0
              ? ` · 会一并注册 ${entry.dependencies.length} 个依赖`
              : ""}
            {" · 安装到本地数据目录,可随时回滚"}
          </p>

          {needsConsent ? (
            <label className={styles.consent} data-testid="install-dialog-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => toggleConsent(event.target.checked)}
              />
              <span>
                我了解该条目申请高风险能力(
                {summary.shown
                  .filter((c) => capabilityRisk(c) === "high")
                  .map((c) => c.label ?? c.id)
                  .join("、") || "见上方清单"}
                )
              </span>
            </label>
          ) : null}

          {progress ? (
            <div className={styles.progress} data-testid="install-dialog-progress" role="status">
              <div className={styles.progressHead}>
                <span>{progress.phase}</span>
                {progress.percent !== undefined ? (
                  <span>{Math.round(progress.percent)}%</span>
                ) : null}
              </div>
              <div className={styles.progressTrack}>
                <div
                  className={[
                    styles.progressBar,
                    progress.percent === undefined ? styles.progressIndeterminate : "",
                  ].join(" ")}
                  style={
                    progress.percent === undefined
                      ? undefined
                      : { width: `${Math.min(100, Math.max(0, progress.percent))}%` }
                  }
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p className={styles.error} role="alert" data-testid="install-dialog-error">
              {error}
            </p>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.cancel}
            onClick={onCancel}
            disabled={busy}
            data-testid="install-dialog-cancel"
          >
            取消
          </button>
          <button
            type="button"
            className={styles.confirm}
            disabled={busy || blocked || !selectedVersion}
            onClick={() => onConfirm({ version: selectedVersion, allowHighRisk: consent })}
            data-testid="install-dialog-confirm"
          >
            {busy ? "安装中…" : (confirmLabel ?? "确认安装")}
          </button>
        </footer>
      </div>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return content;
  return createPortal(content, document.body);
}
