import { useEffect, useMemo, useRef, useState } from "react";
import { agentQuickAnswer } from "@openbuddy/client/agent-client";
import { useSessionStore } from "./state/session-store";
import { useQuickQaStore } from "./state/quick-qa-store";
import { Markdown } from "@openbuddy/markdown";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { X } from "lucide-react";
import { friendlyError } from "@openbuddy/chat-core/error-format";

/**
 * 快速问答 (G1-31): ask about a quoted fragment without spending the task's context.
 *
 * The question runs in its own throwaway Pi session (the host keeps it off disk), so the
 * conversation the user is reading never sees it. The answer streams back over the normal
 * engine events, which the session store keeps per session id.
 */
export function QuickQaSheet({
  quote,
  cwd,
  modelId,
  onClose,
  onToast,
}: {
  /** The selected text the question is about. */
  quote: string;
  /** Working directory of the task the quote came from. */
  cwd?: string;
  modelId?: string;
  onClose: () => void;
  onToast?: (message: string) => void;
}) {
  const { theme } = useTheme();
  const [question, setQuestion] = useState("");
  const [qaSessionId, setQaSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The store keeps one transcript per session id, so the quick answer streams in like any turn.
  const transcript = useSessionStore((state) => (qaSessionId ? state.transcripts[qaSessionId] : undefined));
  const answer = useMemo(() => {
    const messages = transcript?.messages ?? [];
    return messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.parts)
      .map((part) => (part.kind === "text" ? part.text : ""))
      .join("\n\n")
      .trim();
  }, [transcript]);
  const busy = sending || (transcript?.busy ?? false);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const ask = async () => {
    const text = question.trim();
    if (!text || busy) return;
    setSending(true);
    setError("");
    try {
      const result = await agentQuickAnswer({ prompt: text, context: quote, cwd, modelId });
      // 一次性会话不是任务：渲染层据此忽略它的状态与完成事件。
      useQuickQaStore.getState().mark(result.sessionId);
      setQaSessionId(result.sessionId);
      setQuestion("");
    } catch (e) {
      setError(friendlyError(e));
      onToast?.(`快速问答失败：${friendlyError(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="quick-qa" role="dialog" aria-modal="true" aria-label="快速问答" data-qa-session={qaSessionId ?? ""}>
      <div className="quick-qa__panel">
        <div className="quick-qa__head">
          <strong>快速问答</strong>
          <span className="quick-qa__hint">单独回答，不占用当前对话的上下文</span>
          <button type="button" className="quick-qa__close" onClick={onClose} aria-label="关闭快速问答"><X size={15} /></button>
        </div>
        <blockquote className="quick-qa__quote">{quote}</blockquote>
        <div className="quick-qa__body">
          {answer ? (
            <div className="quick-qa__answer"><Markdown complete theme={theme}>{answer}</Markdown></div>
          ) : busy ? (
            <div className="quick-qa__status" role="status">正在回答…</div>
          ) : null}
          {error && <p className="quick-qa__error" role="alert">{error}</p>}
        </div>
        <div className="quick-qa__foot">
          <textarea
            ref={inputRef}
            className="quick-qa__input"
            value={question}
            placeholder="针对这段内容提问…"
            aria-label="快速问答的问题"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void ask();
              }
              if (event.key === "Escape") { event.preventDefault(); onClose(); }
            }}
          />
          <button type="button" className="quick-qa__send" onClick={() => void ask()} disabled={busy || !question.trim()}>提问</button>
        </div>
      </div>
    </div>
  );
}
