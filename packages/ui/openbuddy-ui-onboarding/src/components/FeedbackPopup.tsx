/**
 * @openbuddy/ui-onboarding/FeedbackPopup — 轻量反馈卡(赞 / 踩 + 备注)
 *
 * 完全受控且无副作用:选中的情绪与备注通过 `onSubmit` 抛回宿主,由宿主决定
 * 是落本地 JSONL 还是转发到自托管端点(OpenBuddy 的"本地优先 + 数据自决")。
 * 组件本身不读 localStorage,也不决定"什么时候该弹" —— 触发时机属于宿主
 * 的策略(例如 cabinet 只在第 2 / 第 6 次启动时弹)。
 */
import { useState } from "react";

import styles from "./FeedbackPopup.module.css";

export type FeedbackSentiment = "up" | "down";

export interface FeedbackPayload {
  sentiment: FeedbackSentiment;
  /** 备注(未填时为空串,而不是 undefined —— 方便直接写 JSONL)。 */
  comment: string;
}

export interface FeedbackPopupProps {
  onSubmit(payload: FeedbackPayload): void;
  onDismiss?(): void;
  /** 只要一个赞/踩,不要备注框。 */
  hideComment?: boolean;
  busy?: boolean;
  error?: string;
  title?: string;
  description?: string;
  placeholder?: string;
  /** 备注长度上限,默认 500。 */
  maxLength?: number;
  /** 提交成功后宿主要不要保留组件 —— 默认提交后自动清空本地选择。 */
  className?: string;
}

export function FeedbackPopup({
  onSubmit,
  onDismiss,
  hideComment = false,
  busy = false,
  error,
  title = "用得还顺手吗?",
  description = "一句话就够。作为开源项目,这些反馈会直接决定下一个版本做什么。",
  placeholder = "想吐槽或者点赞的地方…",
  maxLength = 500,
  className,
}: FeedbackPopupProps) {
  const [sentiment, setSentiment] = useState<FeedbackSentiment | null>(null);
  const [comment, setComment] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const shown = error ?? localError;
  const canSubmit = sentiment !== null && !busy;

  function submit() {
    if (!sentiment) {
      setLocalError("请先选择赞或踩");
      return;
    }
    setLocalError(null);
    onSubmit({ sentiment, comment: comment.trim() });
  }

  return (
    <div
      className={className ? `${styles.root} ${className}` : styles.root}
      data-testid="feedback-popup"
      role="dialog"
      aria-label={title}
    >
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        {onDismiss && (
          <button
            type="button"
            className={styles.close}
            onClick={onDismiss}
            disabled={busy}
            aria-label="关闭反馈"
            data-testid="feedback-dismiss-icon"
          >
            ×
          </button>
        )}
      </div>

      <p className={styles.description}>{description}</p>

      <div className={styles.sentiments} role="radiogroup" aria-label="评价">
        <button
          type="button"
          role="radio"
          aria-checked={sentiment === "up"}
          className={`${styles.sentiment} ${sentiment === "up" ? styles.sentimentActive : ""}`}
          onClick={() => {
            setLocalError(null);
            setSentiment(sentiment === "up" ? null : "up");
          }}
          disabled={busy}
          data-testid="feedback-up"
          data-active={sentiment === "up" ? "true" : "false"}
        >
          <span aria-hidden="true">👍</span>
          <span>有帮助</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={sentiment === "down"}
          className={`${styles.sentiment} ${sentiment === "down" ? styles.sentimentActive : ""}`}
          onClick={() => {
            setLocalError(null);
            setSentiment(sentiment === "down" ? null : "down");
          }}
          disabled={busy}
          data-testid="feedback-down"
          data-active={sentiment === "down" ? "true" : "false"}
        >
          <span aria-hidden="true">👎</span>
          <span>不太行</span>
        </button>
      </div>

      {!hideComment && (
        <>
          <textarea
            className={styles.textarea}
            value={comment}
            placeholder={placeholder}
            maxLength={maxLength}
            rows={3}
            disabled={busy}
            aria-label="反馈备注(可选)"
            onChange={(event) => setComment(event.target.value)}
            data-testid="feedback-comment"
          />
          <div className={styles.counter} data-testid="feedback-counter">
            {comment.length} / {maxLength}
          </div>
        </>
      )}

      {shown && (
        <p className={styles.error} role="alert" data-testid="feedback-error">
          {shown}
        </p>
      )}

      <div className={styles.footer}>
        {onDismiss && (
          <button
            type="button"
            className={styles.ghost}
            onClick={onDismiss}
            disabled={busy}
            data-testid="feedback-dismiss"
          >
            先不填了
          </button>
        )}
        <button
          type="button"
          className={styles.primary}
          onClick={submit}
          disabled={!canSubmit}
          data-testid="feedback-submit"
        >
          {busy ? "提交中…" : "提交"}
        </button>
      </div>
    </div>
  );
}
