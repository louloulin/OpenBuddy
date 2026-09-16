/**
 * @openbuddy/ui-onboarding/WhatsNewCard — 版本更新摘要卡
 *
 * 与 cabinet 类似物相比的两点不同:
 *   1. "不再显示"不是隐式行为 —— 复选框状态随 `onDismiss(remember)` 一起抛给
 *      宿主,由宿主决定写哪个 key(组件不碰持久化);
 *   2. 条目是数据(`items`),不是 markdown 文本。changelog 由宿主提供链接,
 *      避免把发布流程的排版责任压到 UI 包里。
 */
import { useState } from "react";

import styles from "./WhatsNewCard.module.css";

export interface WhatsNewItem {
  title: string;
  description?: string;
}

export interface WhatsNewCardProps {
  /** 展示用的版本号(如 `0.15.0`)。 */
  version: string;
  /** ISO 日期或本地化文案,原样展示。 */
  releasedAt?: string;
  items: WhatsNewItem[];
  /** `remember = true` 表示勾选了"不再显示"。 */
  onDismiss(remember: boolean): void;
  onOpenChangelog?(): void;
  title?: string;
  /** 复选框初始状态,默认不勾选。 */
  defaultRemember?: boolean;
  className?: string;
}

export function WhatsNewCard({
  version,
  releasedAt,
  items,
  onDismiss,
  onOpenChangelog,
  title = "本次更新",
  defaultRemember = false,
  className,
}: WhatsNewCardProps) {
  const [remember, setRemember] = useState(defaultRemember);

  return (
    <div
      className={className ? `${styles.root} ${className}` : styles.root}
      data-testid="whats-new-card"
      role="dialog"
      aria-label={`${title} ${version}`}
    >
      <header className={styles.head}>
        <div>
          <h3 className={styles.title}>{title}</h3>
          <p className={styles.version} data-testid="whats-new-version">
            v{version}
            {releasedAt ? ` · ${releasedAt}` : ""}
          </p>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={() => onDismiss(remember)}
          aria-label="关闭更新摘要"
          data-testid="whats-new-close"
        >
          ×
        </button>
      </header>

      <ul className={styles.items} data-testid="whats-new-items">
        {items.map((item, i) => (
          <li key={`${item.title}-${i}`} className={styles.item} data-testid="whats-new-item">
            <span className={styles.bullet} aria-hidden="true">
              ◆
            </span>
            <div className={styles.itemBody}>
              <span className={styles.itemTitle}>{item.title}</span>
              {item.description && (
                <span className={styles.itemDescription}>{item.description}</span>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className={styles.empty} data-testid="whats-new-empty">
            这个版本主要是稳定性改进。
          </li>
        )}
      </ul>

      <footer className={styles.footer}>
        <label className={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            data-testid="whats-new-remember"
          />
          不再显示
        </label>
        <div className={styles.actions}>
          {onOpenChangelog && (
            <button
              type="button"
              className={styles.ghost}
              onClick={onOpenChangelog}
              data-testid="whats-new-changelog"
            >
              完整更新日志
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            onClick={() => onDismiss(remember)}
            data-testid="whats-new-dismiss"
          >
            知道了
          </button>
        </div>
      </footer>
    </div>
  );
}
