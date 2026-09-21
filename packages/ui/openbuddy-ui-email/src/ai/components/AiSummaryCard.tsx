/**
 * AiSummaryCard — 打开线程后自动出现的 AI 摘要。
 *
 * 行为契约:
 *   - 父组件传入 threadId 与 onAction 回调。
 *   - 首次渲染即调 ensureSummary(去抖)。用户切到下一个线程立刻重新请求。
 *   - 加载/失败/就绪 三态都有专属 UI — 用户永远能看到"AI 在工作 / 失败原因 / 结果"。
 *   - 每个 action 按钮(回复 / 日历 / 稍后 / Follow-up)都是纯 props 回调 — 测试易覆盖。
 */
import { useEffect } from "react";
import type { AiThreadSummary, AsyncPhase } from "../types";
import { phaseIsError, phaseIsLoading, phaseIsReady } from "../types";

export type AiSummaryAction = "reply" | "calendar" | "snooze" | "followup";

export interface AiSummaryCardProps {
  threadId: string;
  summary: AsyncPhase<AiThreadSummary>;
  onEnsure: (threadId: string) => Promise<AiThreadSummary>;
  onAction: (action: AiSummaryAction, summary: AiThreadSummary) => void;
  onRetry?: (threadId: string) => void;
  className?: string;
}

export function AiSummaryCard({
  threadId,
  summary,
  onEnsure,
  onAction,
  onRetry,
  className,
}: AiSummaryCardProps): JSX.Element {
  useEffect(() => {
    if (summary.status === "idle") {
      void onEnsure(threadId).catch(() => {
        // 错误已在 hook 内捕获到 state,这里吞掉 promise rejection。
      });
    }
  }, [threadId, summary.status, onEnsure]);

  return (
    <section
      className={classNames("ai-summary-card", className)}
      aria-label="AI 摘要"
      data-thread-id={threadId}
    >
      <header>
        <span className="ai-summary-card__pill">AI 摘要</span>
        <ConfidenceBadge value={summary.status === "ready" ? summary.value.confidence : undefined} />
      </header>
      {phaseIsLoading(summary) ? (
        <p className="ai-summary-card__loading">正在生成摘要…</p>
      ) : phaseIsError(summary) ? (
        <div className="ai-summary-card__error" role="alert">
          <span>{summary.error}</span>
          {onRetry ? (
            <button type="button" onClick={() => onRetry(threadId)}>
              重试
            </button>
          ) : null}
        </div>
      ) : phaseIsReady(summary) ? (
        <SummaryBody summary={summary.value} onAction={onAction} />
      ) : (
        <p className="ai-summary-card__idle">点击生成摘要</p>
      )}
    </section>
  );
}

interface SummaryBodyProps {
  summary: AiThreadSummary;
  onAction: (action: AiSummaryAction, summary: AiThreadSummary) => void;
}

function SummaryBody({ summary, onAction }: SummaryBodyProps): JSX.Element {
  return (
    <>
      <p className="ai-summary-card__oneliner">{summary.oneLiner}</p>
      {summary.keyPoints.length > 0 ? (
        <ul className="ai-summary-card__points">
          {summary.keyPoints.slice(0, 4).map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      ) : null}
      <footer className="ai-summary-card__actions">
        <button type="button" onClick={() => onAction("reply", summary)}>
          ✨ 生成回复
        </button>
        {summary.meetingProposal ? (
          <button type="button" onClick={() => onAction("calendar", summary)}>
            📅 加入日历审批
          </button>
        ) : null}
        <button type="button" onClick={() => onAction("snooze", summary)}>
          ⏰ 稍后再处理
        </button>
        {summary.actionItems.length > 0 ? (
          <button type="button" onClick={() => onAction("followup", summary)}>
            📌 创建 {summary.actionItems.length} 个跟进
          </button>
        ) : null}
      </footer>
    </>
  );
}

function ConfidenceBadge({ value }: { value?: number }): JSX.Element {
  if (value === undefined) return <span className="ai-summary-card__confidence">—</span>;
  const percent = Math.round(value * 100);
  return (
    <span className="ai-summary-card__confidence" data-confidence={bucketFor(value)}>
      置信度 {percent}%
    </span>
  );
}

function bucketFor(value: number): "high" | "medium" | "low" {
  if (value >= 0.85) return "high";
  if (value >= 0.6) return "medium";
  return "low";
}

function classNames(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
