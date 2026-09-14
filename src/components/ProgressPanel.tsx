import { useEffect, useState } from "react";
import { progressRunsGet, progressRunCancel, progressRunRetry } from "../lib/agent/pi-client";
import type { ProgressRun } from "../lib/agent/progress-runs";

export function ProgressPanel() {
  const [runs, setRuns] = useState<ProgressRun[]>([]);
  const refresh = () => setRuns(progressRunsGet());
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 1000); return () => window.clearInterval(timer); }, []);
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
