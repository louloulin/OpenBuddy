/**
 * 子 agent / 团队运行时面板 —— 对齐 WorkBuddy `team-runtime` /
 * `session:getSubagentList`。
 *
 * 主数据源: `subagent-store`(实时 `agent://subagent` 事件——turns/tokens/duration/进度)。
 * 回退: 从会话消息派生 spawn_subagent 活动(无实时进度,仅状态)。
 * 两者合并去重(实时数据优先)。空时不渲染。
 */
import { useMemo } from "react";
import { useSubagentStore } from "@/stores/subagent-store";
import { useSessionStore } from "@/stores/session-store";
import { deriveSubagents } from "@/lib/subagents";

interface SubagentPanelProps {
  /** Pass-through messages for transcript-derived fallback. */
  messages?: import("@/stores/session-store").ChatMessage[];
}

const STATUS_LABEL: Record<string, string> = {
  running: "运行中",
  in_progress: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m}m${rs}s` : `${m}m`;
}

function formatTokens(n?: number): string {
  if (!n) return "";
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

export function SubagentPanel({ messages }: SubagentPanelProps) {
  const sessionId = useSessionStore((s) => s.sessionId);
  const liveSubagents = useSubagentStore((s) =>
    sessionId ? s.getForSession(sessionId) : [],
  );

  const fallbackActivities = useMemo(() => {
    if (!messages) return [];
    return deriveSubagents(messages);
  }, [messages]);

  // Merge: live data first, then fallback activities not in live set.
  const liveIds = useMemo(() => new Set(liveSubagents.map((s) => s.id)), [liveSubagents]);
  const extra = useMemo(
    () => fallbackActivities.filter((a) => !liveIds.has(a.id)),
    [fallbackActivities, liveIds],
  );

  const allCount = liveSubagents.length + extra.length;
  const runningCount =
    liveSubagents.filter((s) => s.status === "running").length +
    extra.filter((a) => a.status === "in_progress").length;
  const completedCount =
    liveSubagents.filter((s) => s.status === "completed").length +
    extra.filter((a) => a.status === "completed").length;
  const failedCount =
    liveSubagents.filter((s) => s.status === "failed" || s.status === "cancelled").length +
    extra.filter((a) => a.status === "failed").length;

  if (allCount === 0) return null;

  return (
    <div className="subagent-panel" role="region" aria-label="子代理运行时">
      <div className="subagent-panel__head">
        <span className="subagent-panel__title">子代理</span>
        <span className="subagent-panel__summary">
          {allCount} 个 · 运行中 {runningCount}
          {completedCount > 0 ? ` · 完成 ${completedCount}` : ""}
          {failedCount > 0 ? ` · 失败 ${failedCount}` : ""}
        </span>
      </div>
      <ul className="subagent-panel__list">
        {/* Live subagents (rich progress) */}
        {liveSubagents.map((rt) => (
          <li
            key={rt.id}
            className={"subagent-panel__row subagent-panel__row--" + rt.status}
          >
            <span className="subagent-panel__dot" />
            <div className="subagent-panel__info">
              <div className="subagent-panel__name-line">
                <span className="subagent-panel__name">
                  {rt.description || rt.subagentType || "子代理"}
                </span>
                {rt.subagentType && rt.description && (
                  <span className="subagent-panel__type">{rt.subagentType}</span>
                )}
              </div>
              <div className="subagent-panel__progress">
                {rt.status === "running" && (
                  <>
                    {rt.turnCount != null && <span>{rt.turnCount} 轮</span>}
                    {rt.toolCallCount != null && rt.toolCallCount > 0 && (
                      <span>{rt.toolCallCount} 工具</span>
                    )}
                    {formatDuration(rt.durationMs) && (
                      <span>{formatDuration(rt.durationMs)}</span>
                    )}
                    {formatTokens(rt.tokensUsed) && (
                      <span>{formatTokens(rt.tokensUsed)} tok</span>
                    )}
                    {rt.contextUsagePct != null && rt.contextUsagePct > 0 && (
                      <span className="subagent-panel__ctx">{rt.contextUsagePct}% ctx</span>
                    )}
                    {rt.toolsUsed && rt.toolsUsed.length > 0 && (
                      <span className="subagent-panel__tools">
                        {rt.toolsUsed.slice(0, 5).join(", ")}
                        {rt.toolsUsed.length > 5 ? "…" : ""}
                      </span>
                    )}
                  </>
                )}
                {rt.status !== "running" && (
                  <>
                    {rt.turnCount != null && <span>{rt.turnCount} 轮</span>}
                    {rt.toolCallCount != null && rt.toolCallCount > 0 && (
                      <span>{rt.toolCallCount} 工具</span>
                    )}
                    {formatDuration(rt.durationMs) && (
                      <span>{formatDuration(rt.durationMs)}</span>
                    )}
                    {rt.error && <span className="subagent-panel__error">{rt.error}</span>}
                  </>
                )}
              </div>
            </div>
            <span className="subagent-panel__status">
              {STATUS_LABEL[rt.status] ?? rt.status}
            </span>
          </li>
        ))}
        {/* Fallback: transcript-derived (no live progress) */}
        {extra.map((a) => (
          <li
            key={a.id}
            className={"subagent-panel__row subagent-panel__row--" + a.status}
            title={a.id}
          >
            <span className="subagent-panel__dot" />
            <div className="subagent-panel__info">
              <div className="subagent-panel__name-line">
                <span className="subagent-panel__name">{a.name}</span>
              </div>
            </div>
            <span className="subagent-panel__status">{STATUS_LABEL[a.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
