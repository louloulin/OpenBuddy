/**
 * AiReplySuggester — 三选一回复建议组件。
 *
 * 顶级邮件产品(Gmail Gemini / Outlook Copilot / Superhuman Ask)都使用
 * "3 选 1" + "可采纳进入 Composer" 的模式。本组件沿用此模式并把采纳语义
 * 上提:不直接打开 Composer,而是把 suggestion id + 主题 + 正文回传父组件,
 * 由父组件选择是否进入 Composer 或发送。
 */
import { useEffect } from "react";
import type { AiReplySuggestion, AsyncPhase } from "../types";
import { phaseIsError, phaseIsLoading, phaseIsReady } from "../types";

export interface AiReplySuggesterProps {
  threadId: string;
  suggestions: AsyncPhase<AiReplySuggestion[]>;
  onEnsure: (threadId: string, count?: number) => Promise<AiReplySuggestion[]>;
  onAdopt: (suggestion: AiReplySuggestion) => void;
  onRegenerate?: (threadId: string) => void;
  onRetry?: (threadId: string) => void;
  expectedCount?: number;
}

export function AiReplySuggester({
  threadId,
  suggestions,
  onEnsure,
  onAdopt,
  onRegenerate,
  onRetry,
  expectedCount = 3,
}: AiReplySuggesterProps): JSX.Element {
  useEffect(() => {
    if (suggestions.status === "idle") {
      void onEnsure(threadId, expectedCount).catch(() => undefined);
    }
  }, [threadId, suggestions.status, onEnsure, expectedCount]);

  return (
    <section className="ai-reply-suggester" aria-label="AI 回复建议" data-thread-id={threadId}>
      <header>
        <h5>AI 推荐的回复</h5>
        {onRegenerate ? (
          <button
            type="button"
            className="ai-reply-suggester__regen"
            onClick={() => onRegenerate(threadId)}
            disabled={phaseIsLoading(suggestions)}
          >
            🔁 换一批
          </button>
        ) : null}
      </header>
      {phaseIsLoading(suggestions) ? (
        <p className="ai-reply-suggester__loading">AI 正在起草 {expectedCount} 个回复候选…</p>
      ) : phaseIsError(suggestions) ? (
        <div className="ai-reply-suggester__error" role="alert">
          <span>{suggestions.error}</span>
          {onRetry ? (
            <button type="button" onClick={() => onRetry(threadId)}>
              重试
            </button>
          ) : null}
        </div>
      ) : phaseIsReady(suggestions) ? (
        suggestions.value.length === 0 ? (
          <p className="ai-reply-suggester__empty">AI 暂无建议 — 你可以手动撰写。</p>
        ) : (
          <ol className="ai-reply-suggester__list">
            {suggestions.value.map((option, index) => (
              <li key={option.id} className="ai-reply-suggester__option">
                <div className="ai-reply-suggester__option-meta">
                  <span className={`ai-reply-suggester__tone ai-reply-suggester__tone--${option.tone}`}>
                    {labelFor(option.tone)}
                  </span>
                  <span className="ai-reply-suggester__confidence">
                    {Math.round(option.confidence * 100)}% 置信
                  </span>
                </div>
                <p className="ai-reply-suggester__subject">
                  主题:{option.subject || "（无主题）"}
                </p>
                <pre className="ai-reply-suggester__body">{option.body}</pre>
                {option.reason ? (
                  <p className="ai-reply-suggester__reason">{option.reason}</p>
                ) : null}
                <div className="ai-reply-suggester__cta">
                  <button
                    type="button"
                    className="ai-reply-suggester__adopt"
                    onClick={() => onAdopt(option)}
                    data-testid={`adopt-reply-${index + 1}`}
                  >
                    ✨ 采纳进入 Composer
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )
      ) : (
        <p className="ai-reply-suggester__idle">准备生成回复建议…</p>
      )}
    </section>
  );
}

function labelFor(tone: AiReplySuggestion["tone"]): string {
  switch (tone) {
    case "concise":
      return "简短";
    case "inquisitive":
      return "追问";
    case "delegate":
      return "委派";
  }
}
