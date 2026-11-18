/** 交接到新任务 (pii W1.7): the banner above a handed-off transcript. */
export function HandoffBanner({ from, onOpen }: { from: { sessionId: string; title?: string }; onOpen?: (sessionId: string) => void }) {
  return (
    <div className="chatview__handoff" role="note">
      <span className="chatview__handoff-text">由「{from.title ?? "原任务"}」交接</span>
      <button type="button" className="chatview__handoff-link" onClick={() => onOpen?.(from.sessionId)}>回到原会话</button>
    </div>
  );
}
