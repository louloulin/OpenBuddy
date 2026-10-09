export type ProgressStatus = "running" | "cancelled" | "failed" | "completed";
export interface ProgressRun { runId: string; taskId: string; sessionId?: string; stage: string; percent: number | null; recentEvent: string; status: ProgressStatus; error?: string; startedAt: number; updatedAt: number; }
type Emit = (event: string, payload: unknown) => void;
let emit: Emit = () => undefined;
const runs = new Map<string, ProgressRun>();
const controllers = new Map<string, AbortController>();
const taskRuns = new Map<string, string>();
export function installProgressEmitter(fn: Emit): void { emit = fn; }
export function progressSnapshot(): ProgressRun[] { return [...runs.values()].map((run) => ({ ...run })); }
export function startProgress(taskId: string, sessionId?: string, controller = new AbortController()): ProgressRun { const runId = `${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`; const now = Date.now(); const run = { runId, taskId, ...(sessionId ? { sessionId } : {}), stage: "starting", percent: null, recentEvent: "Task started", status: "running" as const, startedAt: now, updatedAt: now }; runs.set(runId, run); controllers.set(runId, controller); taskRuns.set(taskId, runId); emit("progress/run", run); return { ...run }; }
export function updateProgress(runId: string, patch: Partial<Pick<ProgressRun, "stage" | "percent" | "recentEvent">>): ProgressRun | null { const run = runs.get(runId); if (!run || run.status !== "running") return run ? { ...run } : null; Object.assign(run, patch, { updatedAt: Date.now() }); emit("progress/update", run); return { ...run }; }
export function finishProgress(runId: string, status: Exclude<ProgressStatus, "running">, error?: string): ProgressRun | null { const resolvedId = runs.has(runId) ? runId : taskRuns.get(runId); const run = resolvedId ? runs.get(resolvedId) : undefined; if (!run || run.status !== "running") return run ? { ...run } : null; run.status = status; run.updatedAt = Date.now(); if (error) run.error = error; run.recentEvent = status === "completed" ? "Task completed" : status === "cancelled" ? "Task cancelled" : "Task failed"; emit("progress/update", run); return { ...run }; }
export function cancelProgress(runId: string): ProgressRun | null { controllers.get(runId)?.abort(); return finishProgress(runId, "cancelled"); }
export function retryProgress(runId: string): ProgressRun | null { const previous = runs.get(runId); if (!previous || previous.status === "running") return null; return startProgress(previous.taskId, previous.sessionId); }
export function resetProgressForTest(): void { runs.clear(); controllers.clear(); }
export function handleProgressEvent(event: { type?: string; payload?: unknown }): ProgressRun | null {
  const payload = event.payload as Partial<ProgressRun> | undefined;
  if (!payload?.runId) return null;
  if (event.type === "progress/run") {
    runs.set(payload.runId, { ...payload } as ProgressRun);
    return { ...runs.get(payload.runId)! };
  }
  const current = runs.get(payload.runId);
  if (!current) return null;
  if (event.type === "progress/update") {
    Object.assign(current, payload);
    return { ...current };
  }
  return null;
}
