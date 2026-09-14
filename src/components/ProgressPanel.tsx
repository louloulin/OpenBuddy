import { useEffect, useState } from "react";
import { agentOnPluginEvent, agentPluginEvents, progressRunsGet, progressRunCancel, progressRunRetry } from "../lib/agent/pi-client";
import { handleProgressEvent, type ProgressRun } from "../lib/agent/progress-runs";

export function ProgressPanel() {
  const [runs, setRuns] = useState<ProgressRun[]>([]);
  const refresh = async () => setRuns(await progressRunsGet());
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      dispose = await agentOnPluginEvent((event) => {
        if (event.type === "progress/run" || event.type === "progress/update") {
          const next = handleProgressEvent(event);
          if (next && !cancelled) setRuns((current) => [...current.filter((run) => run.runId !== next.runId), next]);
        }
      });
      const history = await agentPluginEvents();
      if (!cancelled) history.filter((event) => event.type === "progress/run" || event.type === "progress/update").forEach((event) => handleProgressEvent(event));
      if (!cancelled) await refresh();
    })();
    return () => { cancelled = true; dispose?.(); };
  }, []);

  return <section data-testid="progress-panel" aria-live="polite">
    <h3>Tasks</h3>
    {runs.map((run) => <article key={run.runId} data-testid={`progress-run-${run.runId}`}>
      <strong>{run.stage}</strong>
      <span>{run.percent === null ? "Working" : `${run.percent}%`}</span>
      <small>{run.recentEvent}</small>
      {run.status === "running" && <button type="button" onClick={async () => { await progressRunCancel(run.runId); refresh(); }}>Cancel</button>}
      {run.status === "failed" && <button type="button" onClick={async () => { await progressRunRetry(run.runId); refresh(); }}>Retry</button>}
      {run.error && <output role="alert">{run.error}</output>}
    </article>)}
  </section>;
}
