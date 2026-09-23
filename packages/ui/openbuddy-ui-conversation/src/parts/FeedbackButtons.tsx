/**
 * 反馈按钮(👍/👎)—— 对齐 WorkBuddy message-feedback。
 *
 * 本地持久化(toggle:再点同向取消)。无后端上报(OpenBuddy 是 BYOK,无可上报通道)。
 * 选中的方向高亮(填充),未选中保持描边。
 *
 * 与 `MessageItem` 解耦:`sessionId` + `messageId` 由父级注入,组件只读
 * `useFeedbackStore` 并显示本地条目。
 */
import { useState } from "react";
import { FeedbackDialog } from "@openbuddy/ui-dialogs";
import { useFeedbackStore, type FeedbackRating } from "@/stores/feedback-store";

export function FeedbackButtons({
  sessionId,
  messageId,
}: {
  sessionId: string;
  messageId: string;
}) {
  const entry = useFeedbackStore(
    (s) => s.entries[`${sessionId}:${messageId}`] ?? null,
  );
  const setRating = useFeedbackStore((s) => s.setRating);
  const current = entry?.rating ?? null;
  // 点赞/踩:记录方向并打开完整评分弹窗(对齐 WorkBuddy rating bar + 弹窗)。
  const [dialogOpen, setDialogOpen] = useState<FeedbackRating | null>(null);
  const click = (r: FeedbackRating) => {
    // 再点已选中方向 → 取消(不弹窗)。
    if (current === r) {
      setRating(sessionId, messageId, r);
      return;
    }
    setRating(sessionId, messageId, r);
    setDialogOpen(r);
  };
  return (
    <span className="msg__feedback">
      <button
        type="button"
        className={
          "msg__action-btn msg__feedback-btn" +
          (current === "up" ? " msg__feedback-btn--active" : "")
        }
        onClick={() => click("up")}
        title={current === "up" ? "取消赞" : "赞"}
        aria-label="赞"
        aria-pressed={current === "up"}
      >
        👍
      </button>
      <button
        type="button"
        className={
          "msg__action-btn msg__feedback-btn" +
          (current === "down" ? " msg__feedback-btn--active" : "")
        }
        onClick={() => click("down")}
        title={current === "down" ? "取消踩" : "踩"}
        aria-label="踩"
        aria-pressed={current === "down"}
      >
        👎
      </button>
      {dialogOpen && (
        <FeedbackDialog
          open={dialogOpen !== null}
          sessionId={sessionId}
          messageId={messageId}
          rating={dialogOpen}
          onClose={() => setDialogOpen(null)}
        />
      )}
    </span>
  );
}
