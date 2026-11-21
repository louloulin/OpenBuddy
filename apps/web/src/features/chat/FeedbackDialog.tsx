/**
 * 消息反馈完整评分弹窗 —— 对齐 WorkBuddy `cb-chat-ui/message-feedback`
 * 的 rating bar + 反馈弹窗(thumbs 选向 → 1–5 星评分 + 文字备注)。
 *
 * 由回合动作栏的 👍/👎 触发:点击后弹出此弹窗,用户可选 1–5 星 + 写备注,
 * 提交写入 feedback-store;关闭则保留已选方向(rating 仍记录)。
 */
import { useEffect, useState } from "react";
import { useFeedbackStore, type FeedbackRating } from "@/features/chat/state/feedback-store";
import { XCloseIcon } from "@openbuddy/ui/icon/icons/index";

interface FeedbackDialogProps {
  open: boolean;
  sessionId: string;
  messageId: string;
  /** 初始方向(由触发的 👍/👎 决定)。 */
  rating: FeedbackRating;
  onClose: () => void;
  onToast?: (msg: string) => void;
}

/** 👎 must say why (20261115-ui U3.7): one or more of these. */
export const DOWN_REASONS = ["不准确或有错误", "没按我的要求做", "回答不完整", "太啰嗦", "代码或命令有问题", "其他"];

const STAR_LABELS: Record<number, string> = {
  1: "很差",
  2: "较差",
  3: "一般",
  4: "较好",
  5: "很好",
};

export function FeedbackDialog({
  open,
  sessionId,
  messageId,
  rating,
  onClose,
  onToast,
}: FeedbackDialogProps) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [note, setNote] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const down = rating === "down";
  const missingReason = down && reasons.length === 0;

  // 打开时重置为空(让用户每次重新选);保留 rating 方向。
  useEffect(() => {
    if (open) {
      setStars(0);
      setHover(0);
      setNote("");
      setReasons([]);
    }
  }, [open]);

  // Esc closes like every other dialog (capture phase, so the composer's Esc-to-stop doesn't also fire).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const submit = () => {
    if (missingReason) return;
    useFeedbackStore
      .getState()
      .setDetailed(sessionId, messageId, {
        rating,
        stars: !down && stars > 0 ? stars : undefined,
        note: note.trim() || undefined,
        reasons: down ? reasons : undefined,
      });
    onToast?.("已提交反馈");
    onClose();
  };

  if (!open) return null;

  const shown = hover || stars;

  return (
    <div
      className="feedback-dialog__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="消息反馈"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="feedback-dialog">
        <div className="feedback-dialog__head">
          <span>{rating === "up" ? "👍 你对这条回复满意" : "👎 这条回复有待改进"}</span>
          <button
            type="button"
            className="feedback-dialog__close"
            onClick={onClose}
            aria-label="关闭"
          >
            <XCloseIcon size="sm" />
          </button>
        </div>
        <div className="feedback-dialog__body">
          {down ? (
            <div className="feedback-dialog__reasons" role="group" aria-label="哪里不好">
              {DOWN_REASONS.map((r) => {
                const on = reasons.includes(r);
                return (
                  <button key={r} type="button" className={"feedback-dialog__reason" + (on ? " feedback-dialog__reason--on" : "")} aria-pressed={on} onClick={() => setReasons((xs) => (on ? xs.filter((x) => x !== r) : [...xs, r]))}>
                    {r}
                  </button>
                );
              })}
            </div>
          ) : (
          <div className="feedback-dialog__stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={
                  "feedback-dialog__star" +
                  (shown >= n ? " feedback-dialog__star--active" : "")
                }
                onClick={() => setStars(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                aria-label={`${n} 星`}
              >
                ★
              </button>
            ))}
            <span className="feedback-dialog__star-label">
              {shown > 0 ? STAR_LABELS[shown] : "点击评分(可选)"}
            </span>
          </div>
          )}
          <textarea
            className="feedback-dialog__note"
            placeholder={down ? "具体哪里不对？(可选)" : "补充说明(可选)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </div>
        <div className="feedback-dialog__foot">
          <button
            type="button"
            className="feedback-dialog__btn"
            onClick={onClose}
          >
            取消
          </button>
          {missingReason && <span className="feedback-dialog__hint">请至少选择一个原因</span>}
          <button
            type="button"
            className="feedback-dialog__btn feedback-dialog__btn--primary"
            onClick={submit}
            disabled={missingReason}
          >
            提交
          </button>
        </div>
      </div>
    </div>
  );
}
