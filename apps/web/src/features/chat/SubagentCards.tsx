import { useState } from "react";
import { ChevronRightIcon, SparklesIcon } from "@openbuddy/ui/icon/icons/index";
import { useSubagentStore, type SubagentRun } from "./state/subagent-store";

const STATUS_TEXT: Record<SubagentRun["status"], string> = {
  running: "运行中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
/** How many summary lines a collapsed card shows. */
const PREVIEW_LINES = 3;
const preview = (text: string) => {
  const lines = text.split("\n").filter((line) => line.trim());
  const head = lines.slice(0, PREVIEW_LINES);
  return { head, more: lines.length > PREVIEW_LINES };
};

/**
 * 子代理卡片 (pii W3.4): one card per child session under the turn that spawned it. A running child
 * shows a spinner; a finished one shows the first three lines of its answer and expands to the full
 * text. Nothing is shown for sessions that never spawned children.
 */
export function SubagentCards({ sessionId }: { sessionId: string }) {
  const runs = useSubagentStore((s) => s.bySession[sessionId]);
  if (!runs?.length) return null;
  return <section className="subagent-cards" aria-label="子代理">
    {runs.map((run) => <SubagentCard key={run.childId} run={run} />)}
  </section>;
}

function SubagentCard({ run }: { run: SubagentRun }) {
  const [open, setOpen] = useState(false);
  const text = run.summary ?? "";
  const { head, more } = preview(text);
  return <div className={"subagent-card subagent-card--" + run.status}>
    <button type="button" className="subagent-card__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <SparklesIcon size="sm" className={"subagent-card__icon" + (run.status === "running" ? " subagent-card__icon--spin" : "")} />
      <span className="subagent-card__title">{run.agent ?? "子代理"}</span>
      {run.task && <span className="subagent-card__task">{run.task.split("\n")[0].slice(0, 60)}</span>}
      <span className={"subagent-card__state subagent-card__state--" + run.status}>
        {STATUS_TEXT[run.status]}{run.ms !== undefined && run.status !== "running" ? ` · ${Math.max(1, Math.round(run.ms / 1000))}s` : ""}
      </span>
      {(text || run.error) && <ChevronRightIcon size="sm" className={"subagent-card__chevron" + (open ? " subagent-card__chevron--open" : "")} />}
    </button>
    {run.error && <p className="subagent-card__error" role="alert">{run.error}</p>}
    {text && !open && <pre className="subagent-card__preview">{head.join("\n")}{more ? "\n…" : ""}</pre>}
    {text && open && <pre className="subagent-card__body">{text}</pre>}
  </div>;
}
