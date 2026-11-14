import { useState } from "react";
import { agentClearQueue } from "@/lib/agent-client";
import { friendlyError } from "@/lib/error-format";
import { EMPTY_PI_QUEUE, usePiQueueStore } from "@/stores/pi-queue-store";

/**
 * Messages queued while a reply is running. The items are the engine's own
 * steering / follow-up queue (from the load snapshot and `queue_update`).
 */
export function QueuePanel({ sessionId }: { sessionId: string }) {
  const queue = usePiQueueStore(state => state.queues[sessionId] ?? EMPTY_PI_QUEUE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clear = async () => {
    setBusy(true); setError("");
    try { await agentClearQueue(sessionId); usePiQueueStore.getState().apply(sessionId, { steering: [], followUp: [] }); }
    catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  if (!queue.steering.length && !queue.followUp.length && !error) return null;
  const items = [
    ...queue.steering.map(text => ({ text, kind: "插话" })),
    ...queue.followUp.map(text => ({ text, kind: "待发送" })),
  ];
  return <section className="queue-panel" aria-label="排队中的消息" aria-busy={busy}>
    <div className="queue-panel__head">
      <span className="queue-panel__title">排队中的消息 {items.length}</span>
      <button type="button" className="queue-panel__clear" disabled={busy} onClick={() => { void clear(); }}>全部撤回</button>
    </div>
    {error && <p className="queue-panel__error" role="alert">{error}</p>}
    <ol className="queue-panel__list">
      {items.map((item, index) => <li key={index}><span className="queue-panel__kind">{item.kind}</span><span className="queue-panel__text">{item.text}</span></li>)}
    </ol>
  </section>;
}
