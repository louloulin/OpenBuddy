import { useState } from "react";
import { agentClearQueue, agentSetQueue } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { EMPTY_PI_QUEUE, usePiQueueStore, type PiQueue, type PiQueueItem } from "@/features/composer/state/pi-queue-store";

type Kind = "steering" | "followUp";

/**
 * Messages queued while a reply is running. The items are the engine's own
 * steering / follow-up queue (from the load snapshot and queue updates).
 * Each row can be edited, sent as 插话 right away, moved up, or withdrawn (20261115-ui U4.5).
 * Items carry their attachments, so reordering does not drop queued images (pii W1.8).
 */
export function QueuePanel({ sessionId, onEdit }: { sessionId: string; onEdit?: (text: string) => void }) {
  const queue = usePiQueueStore(state => state.queues[sessionId] ?? EMPTY_PI_QUEUE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const commit = (next: PiQueue) => usePiQueueStore.getState().set(sessionId, next);
  const replace = async (next: PiQueue) => {
    setBusy(true); setError("");
    try {
      await agentSetQueue(
        sessionId,
        next.steering.map((item) => (item.attachments?.length ? { text: item.text, attachments: item.attachments } : item.text)),
        next.followUp.map((item) => (item.attachments?.length ? { text: item.text, attachments: item.attachments } : item.text)),
      );
      commit(next);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true); setError("");
    try { await agentClearQueue(sessionId); commit(EMPTY_PI_QUEUE); }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  };
  const without = (kind: Kind, index: number): PiQueue => {
    const steering = [...queue.steering], followUp = [...queue.followUp];
    (kind === "steering" ? steering : followUp).splice(index, 1);
    return { steering, followUp };
  };
  if (!queue.steering.length && !queue.followUp.length && !error) return null;
  const items = [
    ...queue.steering.map((item, index) => ({ item, index, kind: "steering" as Kind })),
    ...queue.followUp.map((item, index) => ({ item, index, kind: "followUp" as Kind })),
  ];
  return <section className="queue-panel" aria-label="排队中的消息" aria-busy={busy}>
    <div className="queue-panel__head">
      <span className="queue-panel__title">排队中的消息 {items.length}</span>
      <button type="button" className="queue-panel__clear" disabled={busy} onClick={() => { void clear(); }}>全部撤回</button>
    </div>
    {error && <p className="queue-panel__error" role="alert">{error}</p>}
    <ol className="queue-panel__list">
      {items.map(({ item, index, kind }) => {
        const label = item.text.length > 24 ? item.text.slice(0, 24) + "…" : item.text;
        const images = item.attachments?.length ?? 0;
        return <li key={kind + index} className="queue-panel__item">
          <span className="queue-panel__kind">{kind === "steering" ? "插话" : "待发送"}</span>
          <span className="queue-panel__text">{item.text}</span>
          {images > 0 && <span className="queue-panel__images" title={item.attachments?.map((a) => a.path).join("\n")}>图 {images}</span>}
          <span className="queue-panel__ops">
            {onEdit && <button type="button" className="queue-panel__op" disabled={busy} aria-label={`编辑：${label}`} data-tip="放回输入框修改" onClick={() => { onEdit(item.text); void replace(without(kind, index)); }}>编辑</button>}
            {kind === "followUp" && <button type="button" className="queue-panel__op" disabled={busy} aria-label={`立即插话：${label}`} data-tip="不等这轮结束，作为插话尽快送达" onClick={() => { const { steering, followUp } = without("followUp", index); void replace({ steering: [...steering, item], followUp }); }}>立即插话</button>}
            {index > 0 && <button type="button" className="queue-panel__op" disabled={busy} aria-label={`上移：${label}`} data-tip="上移" onClick={() => {
              const steering = [...queue.steering], followUp = [...queue.followUp];
              const list: PiQueueItem[] = kind === "steering" ? steering : followUp;
              [list[index - 1], list[index]] = [list[index], list[index - 1]];
              void replace({ steering, followUp });
            }}>↑</button>}
            <button type="button" className="queue-panel__op" disabled={busy} aria-label={`撤回：${label}`} data-tip="撤回这条" onClick={() => { void replace(without(kind, index)); }}>撤回</button>
          </span>
        </li>;
      })}
    </ol>
  </section>;
}
