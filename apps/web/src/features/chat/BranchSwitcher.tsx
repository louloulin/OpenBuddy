import { useEffect } from "react";
import { useSessionStore } from "@/features/chat/state/session-store";
import { selectBranchTurn, useBranchStore } from "./state/branch-store";
import { switchVersion } from "./branch-actions";

/**
 * Keep the session's version tree fresh: the last turn asks once it has settled (a reply was
 * added, or the transcript was rebuilt on another branch, which remounts the turns).
 */
export function useBranchRefresh(sessionId: string, active: boolean, userTimestamp?: number) {
  useEffect(() => {
    if (active && sessionId) void useBranchStore.getState().refresh(sessionId);
  }, [sessionId, active, userTimestamp]);
}

/**
 * ‹ 1/2 › on a turn whose prompt was regenerated or edited (20261116-pii W1.1). Click to show
 * another version; Shift+click also summarizes the version being left (Pi branch summary).
 */
export function BranchSwitcher({ sessionId, userTimestamp, onToast }: { sessionId: string; userTimestamp?: number; onToast?: (msg: string) => void }) {
  const turn = useBranchStore(selectBranchTurn(sessionId, userTimestamp));
  const switching = useBranchStore((s) => s.switching[sessionId]);
  const streaming = useSessionStore((s) => s.streaming);
  if (!turn) return null;
  const busy = !!switching || streaming;
  const go = (index: number, summarize: boolean) => void switchVersion(sessionId, turn, index, { summarize, onToast });
  const tip = (label: string) => (streaming ? "回复完成后可切换" : `${label}（Shift+点击：同时总结当前版本）`);
  return (
    <div className={"branch-switch" + (switching ? " branch-switch--busy" : "")} role="group" aria-label={`回答版本 ${turn.index + 1}/${turn.total}`}>
      <button type="button" className="branch-switch__btn" aria-label="上一版本" data-tip={tip("上一版本")} disabled={busy || turn.index === 0} onClick={(e) => go(turn.index - 1, e.shiftKey)}>‹</button>
      <span className="branch-switch__count" aria-live="polite">{switching === "summarize" ? "总结中…" : `${turn.index + 1}/${turn.total}`}</span>
      <button type="button" className="branch-switch__btn" aria-label="下一版本" data-tip={tip("下一版本")} disabled={busy || turn.index === turn.total - 1} onClick={(e) => go(turn.index + 1, e.shiftKey)}>›</button>
    </div>
  );
}

/** "更多" menu entries for a turn with other versions: switch and summarize the one being left. */
export function BranchMenuItems({ sessionId, userTimestamp, onToast, onDone }: { sessionId: string; userTimestamp?: number; onToast?: (msg: string) => void; onDone: () => void }) {
  const turn = useBranchStore(selectBranchTurn(sessionId, userTimestamp));
  const streaming = useSessionStore((s) => s.streaming);
  if (!turn || streaming) return null;
  const targets = [turn.index - 1, turn.index + 1].filter((i) => i >= 0 && i < turn.total);
  return (
    <>
      {targets.map((index) => (
        <button key={index} type="button" role="menuitem" onClick={() => { onDone(); void switchVersion(sessionId, turn, index, { summarize: true, onToast }); }}>
          总结当前版本并切到第 {index + 1} 版
        </button>
      ))}
    </>
  );
}
