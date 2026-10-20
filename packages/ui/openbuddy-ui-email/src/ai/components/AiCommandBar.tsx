/**
 * AiCommandBar — Cmd+K AI 命令面板。
 *
 * 设计:模仿 Shortwave / Superhuman Cmd+K 体验。用户在搜索框输入自然语言
 * (如"把 LessWrong 这周的所有通知归档"),AI 解析后跳转到 propose()。
 *
 * 简化:本组件只承载 UI 层(parse + 分发),真正的 AI 解析由 runtime.routePrompt
 * 负责,UI 不依赖任何 AI provider 实现细节。
 */
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface AiCommandBarProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
  recentPrompts?: Array<{ id: string; prompt: string; ranAt: string }>;
  busy?: boolean;
}

const STARTER_PROMPTS: ReadonlyArray<{ id: string; title: string; prompt: string }> = [
  { id: "clean-noise", title: "🧹 一键清噪声", prompt: "把本周营销和通知类的邮件归档" },
  { id: "needs-reply", title: "🔁 整理待我回复", prompt: "列出所有需要我回复的邮件并草拟回复" },
  { id: "summarize-week", title: "📅 本周总结", prompt: "用 5 句话总结本周我收件箱里最重要的事" },
  { id: "snooze-low", title: "⏰ 稍后处理低优先级", prompt: "把所有 AI 标记低优先级的邮件 snooze 到下周一" },
];

export function AiCommandBar({
  open,
  onClose,
  onSubmit,
  recentPrompts = [],
  busy = false,
}: AiCommandBarProps): JSX.Element | null {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setDraft("");
      return;
    }
    const handle = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, { enabled: open });

  if (!open) return null;

  return (
    <div className="ai-command-bar">
      {/* 遮罩是个真的 button（无内容，可以安全替换 div）。tabIndex={-1}：
          键盘用户用 Esc 或面板里的关闭路径，不需要在 Tab 序列里撞上一个
          看不见的全屏控件。它同时被排除在焦点陷阱之外（陷阱只包住面板）。 */}
      <button
        type="button"
        className="ai-command-bar__scrim"
        aria-label="关闭 AI 命令栏"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={containerRef}
        className="ai-command-bar__panel"
        role="dialog"
        aria-modal="true"
        aria-label="AI 命令栏"
      >
        <div className="ai-command-bar__input">
          <span aria-hidden="true">✨</span>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder="让 AI 帮你处理邮件…(按 ⏎ 运行,Esc 关闭)"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim() !== "") {
                onSubmit(draft.trim());
              }
            }}
            disabled={busy}
            data-testid="ai-command-input"
          />
          {busy ? <span className="ai-command-bar__busy" aria-hidden="true" /> : null}
        </div>
        <div className="ai-command-bar__section">
          <h6>试试</h6>
          <ul>
            {STARTER_PROMPTS.map((starter) => (
              <li key={starter.id}>
                <button
                  type="button"
                  onClick={() => onSubmit(starter.prompt)}
                  disabled={busy}
                >
                  <span className="ai-command-bar__starter-title">{starter.title}</span>
                  <span className="ai-command-bar__starter-prompt">{starter.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {recentPrompts.length > 0 ? (
          <div className="ai-command-bar__section">
            <h6>最近</h6>
            <ul>
              {recentPrompts.slice(0, 5).map((entry) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => onSubmit(entry.prompt)} disabled={busy}>
                    {entry.prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
