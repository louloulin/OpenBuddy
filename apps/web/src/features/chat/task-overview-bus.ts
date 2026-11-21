/**
 * 任务概览 (pii W3.3) lives in the top bar, the workbench and transcript in ChatView: picking an
 * artifact or a turn in the popover is handed over with one window event.
 */
export interface TaskOverviewTarget {
  /** Open this artifact in the workbench. */
  path?: string;
  /** Scroll the transcript to this prompt. */
  messageId?: string;
}
const EVENT = "openbuddy:task-overview";

/** Neither field: open the workbench's artifact list. */
export function openFromTaskOverview(target: TaskOverviewTarget) {
  window.dispatchEvent(new CustomEvent<TaskOverviewTarget>(EVENT, { detail: target }));
}

export function onTaskOverview(handler: (target: TaskOverviewTarget) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<TaskOverviewTarget>).detail ?? {});
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
