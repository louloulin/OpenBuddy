import { useState } from "react";
import { agentClearQueue, agentSetQueue } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { EMPTY_PI_QUEUE, usePiQueueStore } from "@/stores/pi-queue-store";

type Kind = "steering" | "followUp";

/**
 * Messages queued while a reply is running. The items are the engine's own
 * steering / follow-up queue (from the load snapshot and `queue_update`).
 * Each row can be edited, sent as 插话 right away, moved up, or withdrawn (20261115-ui U4.5).
 */
export function QueuePanel({ sessionId, onEdit }: { sessionId: string; onEdit?: (text: string) => void }) {
  const queue = usePiQueueStore(state => state.queues[sessionId] ?? EMPTY_PI_QUEUE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** `useResult`: the call returns the new queue (set); clear returns what it removed instead. */
  const run = async (task: () => Promise<unknown>, next: { steering: string[]; followUp: string[] }, useResult = false) => {
    setBusy(true); setError("");
    try {
      const result = await task();
      const state = useResult && result && typeof result === "object" && "steering" in result ? result as { steering: string[]; followUp: string[] } : next;
      usePiQueueStore.getState().apply(sessionId, state);
    }
    catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  const clear = () => run(() => agentClearQueue(sessionId), { steering: [], followUp: [] });
  const replace = (steering: string[], followUp: string[]) => run(() => agentSetQueue(sessionId, steering, followUp), { steering, followUp }, true);
  const without = (kind: Kind, index: number) => {
    const steering = [...queue.steering], followUp = [...queue.followUp];
    (kind === "steering" ? steering : followUp).splice(index, 1);
    return { steering, followUp };
  };
  if (!queue.steering.length && !queue.followUp.length && !error) return null;
  const items = [
    ...queue.steering.map((text, index) => ({ text, index, kind: "steering" as Kind })),
    ...queue.followUp.map((text, index) => ({ text, index, kind: "followUp" as Kind })),
  ];
  return <section className="queue-panel" aria-label="排队中的消息" aria-busy={busy}>
    <div className="queue-panel__head">
      <span className="queue-panel__title">排队中的消息 {items.length}</span>
      <button type="button" className="queue-panel__clear" disabled={busy} onClick={() => { void clear(); }}>全部撤回</button>
    </div>
    {error && <p className="queue-panel__error" role="alert">{error}</p>}
    <ol className="queue-panel__list">
      {items.map((item) => {
        const label = item.text.length > 24 ? item.text.slice(0, 24) + "…" : item.text;
        return <li key={item.kind + item.index} className="queue-panel__item">
          <span className="queue-panel__kind">{item.kind === "steering" ? "插话" : "待发送"}</span>
          <span className="queue-panel__text">{item.text}</span>
          <span className="queue-panel__ops">
            {onEdit && <button type="button" className="queue-panel__op" disabled={busy} aria-label={`编辑：${label}`} data-tip="放回输入框修改" onClick={() => { const { steering, followUp } = without(item.kind, item.index); onEdit(item.text); void replace(steering, followUp); }}>编辑</button>}
            {item.kind === "followUp" && <button type="button" className="queue-panel__op" disabled={busy} aria-label={`立即插话：${label}`} data-tip="不等这轮结束，作为插话尽快送达" onClick={() => { const { steering, followUp } = without("followUp", item.index); void replace([...steering, item.text], followUp); }}>立即插话</button>}
            {item.index > 0 && <button type="button" className="queue-panel__op" disabled={busy} aria-label={`上移：${label}`} data-tip="上移" onClick={() => {
              const steering = [...queue.steering], followUp = [...queue.followUp];
              const list = item.kind === "steering" ? steering : followUp;
              [list[item.index - 1], list[item.index]] = [list[item.index], list[item.index - 1]];
              void replace(steering, followUp);
            }}>↑</button>}
            <button type="button" className="queue-panel__op" disabled={busy} aria-label={`撤回：${label}`} data-tip="撤回这条" onClick={() => { const { steering, followUp } = without(item.kind, item.index); void replace(steering, followUp); }}>撤回</button>
          </span>
        </li>;
      })}
    </ol>
  </section>;
}
