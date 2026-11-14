import { useState } from "react";
import { FeedbackDialog } from "../FeedbackDialog";
import { useFeedbackStore, type FeedbackRating } from "@/stores/feedback-store";
import { ThumbDownGlyph, ThumbUpGlyph } from "./icons";

/** 👍 / 👎 for one turn; stored locally under a key stable across reloads. */
export function FeedbackButtons({ sessionId, turnKey }: { sessionId: string; turnKey: string }) {
  const entry = useFeedbackStore((s) => s.entries[`${sessionId}:${turnKey}`] ?? null);
  const setRating = useFeedbackStore((s) => s.setRating);
  const current = entry?.rating ?? null;
  const [dialog, setDialog] = useState<FeedbackRating | null>(null);
  // 👍 counts at once (no dialog in the way); 👎 is recorded only once a reason is given.
  const click = (rating: FeedbackRating) => {
    if (rating === "down" && current !== "down") setDialog("down");
    else setRating(sessionId, turnKey, rating);
  };
  return (
    <>
      <button type="button" className={"turn-action" + (current === "up" ? " turn-action--active" : "")} onClick={() => click("up")} aria-label="赞" aria-pressed={current === "up"} data-tip={current === "up" ? "取消赞" : "赞"}>
        <ThumbUpGlyph filled={current === "up"} />
      </button>
      <button type="button" className={"turn-action" + (current === "down" ? " turn-action--active" : "")} onClick={() => click("down")} aria-label="踩" aria-pressed={current === "down"} data-tip={current === "down" ? "取消踩" : "踩"}>
        <ThumbDownGlyph filled={current === "down"} />
      </button>
      {dialog && <FeedbackDialog open sessionId={sessionId} messageId={turnKey} rating={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
