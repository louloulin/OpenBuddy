/**
 * @openbuddy/ui-shell/TopbarStatusChip — 顶栏状态胶囊。
 *
 * WorkBuddy 的顶栏用一枚很小的状态点告诉用户 "Agent 现在在干什么"(空闲 /
 * 生成中 / 已暂停 / 桥不可用)。cabinet 的 status-bar 也是同一套语言,只是
 * 位置在底部。本组件把这一格抽成纯展示 pill:
 *
 *   - 颜色点由 `tone` 驱动(ready / working / paused / offline / error);
 *   - `aria-live="polite"` 只在 "working" 时打开 —— 空闲/离线是长期状态,
 *     不该每次重渲染都让读屏器念一遍;
 *   - 有 `onClick` 时渲染成 <button>(用于 "点开看详情")。
 *
 * 无内部状态、无订阅 —— 数据由宿主传入。
 */
import type { ReactNode } from "react";
import styles from "./TopbarStatusChip.module.css";

export type TopbarStatusTone = "ready" | "working" | "paused" | "offline" | "error";

export interface TopbarStatusChipProps {
  tone: TopbarStatusTone;
  /** 主文案(如 "就绪" / "生成中")。 */
  label: string;
  /** 次要信息,进入 tooltip 与 aria-label(如模型名 / 队列长度)。 */
  detail?: string;
  /** 传入后胶囊可点击(用于打开详情面板 / 重连)。 */
  onClick?(): void;
  /** 呼吸动画;默认仅 working 时开启。 */
  pulse?: boolean;
  /** 可选前导 glyph(如 "⚡"),渲染在点与文案之间。 */
  glyph?: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<TopbarStatusTone, string> = {
  ready: styles.toneReady,
  working: styles.toneWorking,
  paused: styles.tonePaused,
  offline: styles.toneOffline,
  error: styles.toneError,
};

export function TopbarStatusChip({
  tone,
  label,
  detail,
  onClick,
  pulse,
  glyph,
  className,
}: TopbarStatusChipProps) {
  const shouldPulse = pulse ?? tone === "working";
  const tip = detail ? `${label} · ${detail}` : label;
  const aria = onClick && detail ? `${label}，${detail}` : undefined;
  const cls =
    styles.chip +
    " " +
    TONE_CLASS[tone] +
    (shouldPulse ? " " + styles.pulse : "") +
    (className ? " " + className : "");

  // 仅 "working" 是短时状态 —— 只有它需要被读屏器播报。
  const live = tone === "working" ? ("polite" as const) : undefined;

  // role=status 放在内层 span 上:外层若可点击必须保留 button 语义,
  // 否则读屏器会把一枚可点击控件读成只读状态栏。
  const body = (
    <span className={styles.body} role="status" aria-live={live}>
      <span className={styles.dot} aria-hidden />
      {glyph ? (
        <span className={styles.glyph} aria-hidden>
          {glyph}
        </span>
      ) : null}
      <span className={styles.label}>{label}</span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}
    </span>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        aria-label={aria}
        data-tip={tip}
        data-tone={tone}
        data-pulse={shouldPulse ? "true" : "false"}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }

  return (
    <span
      className={cls}
      data-tip={tip}
      data-tone={tone}
      data-pulse={shouldPulse ? "true" : "false"}
    >
      {body}
    </span>
  );
}
