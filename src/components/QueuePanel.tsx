import { useEffect, useState } from "react";
import { agentClearQueue, agentGetQueue } from "@/lib/agent-client";
import { friendlyError } from "@/lib/error-format";
import { EMPTY_PI_QUEUE, usePiQueueStore } from "@/stores/pi-queue-store";

/** The displayed items are Pi's own pending prompts, never a simulated local queue. */
export function QueuePanel({ sessionId }: { sessionId: string }) {
  const queue = usePiQueueStore(state => state.queues[sessionId] ?? EMPTY_PI_QUEUE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try { const queue = await agentGetQueue(sessionId); if (active) usePiQueueStore.getState().apply(sessionId, queue); }
      catch (error) { if (active) setError(friendlyError(error)); }
    })();
    return () => { active = false; };
  }, [sessionId]);
  const clear = async () => {
    setBusy(true); setError("");
    try { await agentClearQueue(sessionId); usePiQueueStore.getState().apply(sessionId, await agentGetQueue(sessionId)); }
    catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  if (!queue.steering.length && !queue.followUp.length && !error) return null;
  return <section className="queue-panel" aria-label="Pi 待处理队列" aria-busy={busy}>
    <div className="queue-panel__head"><strong>Pi 待处理队列</strong><button disabled={busy} onClick={() => { void clear(); }} aria-label="清空 Pi 队列">清空队列</button></div>
    {error && <p role="alert">{error}</p>}
    {queue.steering.length > 0 && <div><h4>下一工具边界引导</h4><ol>{queue.steering.map((text, index) => <li key={index}>{text}</li>)}</ol></div>}
    {queue.followUp.length > 0 && <div><h4>回复完成后继续</h4><ol>{queue.followUp.map((text, index) => <li key={index}>{text}</li>)}</ol></div>}
  </section>;
}
