/**
 * @openbuddy/ui-shell/StatusBar — thin bottom status strip.
 *
 * Mirrors cabinet's `status-bar.tsx`: a compact 22px bar that surfaces
 * ambient state without competing with the main content. Everything is
 * optional — pass only the items you have data for.
 *
 * Rendered from the `shell.statusbar` slot so a plugin can replace it.
 */
import { memo, type ReactNode } from "react";
import styles from "./StatusBar.module.css";

export interface StatusItem {
  /** Stable key for React reconciliation. */
  key: string;
  /** Visible text. */
  label: string;
  /** Optional leading glyph (emoji or short string). */
  glyph?: string;
  /** Tone drives the dot color. */
  tone?: "neutral" | "ok" | "warn" | "error" | "busy";
  /** Tooltip / title attribute. */
  title?: string;
  /** Click handler — makes the item interactive. */
  onClick?(): void;
}

export interface StatusBarProps {
  left?: StatusItem[];
  right?: StatusItem[];
  /** Optional custom renderer for the left slot. */
  renderLeft?(): ReactNode;
  /** Optional custom renderer for the right slot. */
  renderRight?(): ReactNode;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<StatusItem["tone"]>, string> = {
  neutral: styles.dotNeutral,
  ok: styles.dotOk,
  warn: styles.dotWarn,
  error: styles.dotError,
  busy: styles.dotBusy,
};

function StatusBarImpl({
  left = [],
  right = [],
  renderLeft,
  renderRight,
  className,
}: StatusBarProps) {
  return (
    <div
      className={styles.bar + (className ? " " + className : "")}
      role="status"
      data-testid="status-bar"
    >
      <div className={styles.side}>
        {renderLeft ? renderLeft() : left.map((item) => <Item key={item.key} item={item} />)}
      </div>
      <div className={styles.spacer} />
      <div className={styles.side}>
        {renderRight ? renderRight() : right.map((item) => <Item key={item.key} item={item} />)}
      </div>
    </div>
  );
}

function Item({ item }: { item: StatusItem }) {
  const content = (
    <>
      {item.tone ? <span className={styles.dot + " " + TONE_CLASS[item.tone]} aria-hidden /> : null}
      {item.glyph ? <span className={styles.glyph} aria-hidden>{item.glyph}</span> : null}
      <span className={styles.label}>{item.label}</span>
    </>
  );
  if (item.onClick) {
    return (
      <button
        type="button"
        className={styles.item + " " + styles.itemButton}
        onClick={item.onClick}
        title={item.title ?? item.label}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={styles.item} title={item.title ?? item.label}>
      {content}
    </span>
  );
}

export const StatusBar = memo(StatusBarImpl);
