import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, RetryState, ToolCallView } from "@/stores/session-store";
import { usePermissionStore } from "@/stores/permission-store";
import { Markdown, type MarkdownConfig } from "../markdown/index";
import { ToolCallCard } from "../ToolCallCard";
import { PermissionCard } from "../PermissionDialog";
import { LoadingRow } from "../LoadingRow";
import { useTheme } from "../ThemeProvider";
import { copyText } from "@/lib/clipboard";
import { formatDuration } from "@/lib/tool-summary";
import { useSmoothText } from "@/lib/use-smooth-text";
import { useUiPrefs } from "@/stores/ui-prefs-store";
import { splitTurn, turnError, turnMarkdown, turnModel, turnTiming } from "./turns";
import { ErrorCard } from "./ErrorCard";
import { FeedbackButtons } from "./FeedbackButtons";
import { ChevronGlyph, CopyGlyph, MoreGlyph, RetryGlyph } from "./icons";
import logoMarkUrl from "@/assets/openbuddy-logo.svg";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function clock(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * How long each thinking block ran, measured while it streams (keyed by part).
 * Replayed history has no per-block timing and keeps the plain label.
 */
const thoughtTimes = new Map<string, { start: number; end?: number }>();

function useThoughtDuration(key: string, live: boolean): number | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    const record = thoughtTimes.get(key);
    if (live) {
      if (!record) thoughtTimes.set(key, { start: Date.now() });
      return;
    }
    if (record && record.end === undefined) {
      record.end = Date.now();
      bump((n) => n + 1);
    }
  }, [key, live]);
  const record = thoughtTimes.get(key);
  return record?.end !== undefined ? record.end - record.start : undefined;
}

/** A thinking block: one line while folded; the live block previews its last line. */
function ThoughtRow({ text, live, timingKey, markdownConfig }: { text: string; live: boolean; timingKey: string; markdownConfig?: MarkdownConfig }) {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme();
  const took = useThoughtDuration(timingKey, live);
  const preview = text.trim().split("\n").filter(Boolean).at(-1) ?? "";
  const label = live ? "思考中" : took !== undefined && took >= 1000 ? `已思考 ${formatDuration(took)}` : "思考过程";
  return (
    <div className={"thought" + (open ? " thought--open" : "") + (live ? " thought--live" : "")}>
      <button type="button" className="thought__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronGlyph open={open} />
        <span className={"thought__label" + (live ? " ob-shining-text" : "")}>{label}</span>
        {!open && live && preview && <span className="thought__preview">{preview}</span>}
      </button>
      {open && (
        <div className="thought__body">
          <Markdown complete={!live} markdownTheme="reasoning" theme={theme} config={markdownConfig}>{text}</Markdown>
        </div>
      )}
    </div>
  );
}

/** Markdown whose streamed text is revealed at a steady pace while live. */
function LiveMarkdown({ text, live, markdownConfig }: { text: string; live: boolean; markdownConfig?: MarkdownConfig }) {
  const { theme } = useTheme();
  const shown = useSmoothText(text, live);
  return <Markdown complete={!live} markdownTheme="loose" theme={theme} config={markdownConfig}>{shown}</Markdown>;
}

export interface TurnViewProps {
  messages: ChatMessage[];
  user?: ChatMessage;
  /** This is the turn currently streaming. */
  running: boolean;
  isLast: boolean;
  sessionId: string;
  cwd?: string;
  markdownConfig?: MarkdownConfig;
  retry?: RetryState | null;
  compacting?: string | null;
  turnStartedAt?: number | null;
  /** Session-level error to show at the end of the last turn. */
  error?: string | null;
  onOpenTool?: (tc: ToolCallView) => void;
  onRetry?: () => void;
  onFork?: () => void;
  onToast?: (msg: string) => void;
}

/**
 * One assistant turn. While running, the steps stream in place; once done the
 * steps fold into "已完成 · 用时 Xs ›" and only the final answer stays visible.
 */
export function TurnView(props: TurnViewProps) {
  const { messages, user, running, isLast, sessionId, cwd, markdownConfig, retry, compacting, turnStartedAt, error, onOpenTool, onRetry, onFork, onToast } = props;
  const concise = useUiPrefs((s) => s.conciseMode);
  const [expanded, setExpanded] = useState(!concise);
  useEffect(() => setExpanded(!concise), [concise]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const content = useMemo(() => splitTurn(messages), [messages]);
  const pending = usePermissionStore((s) => s.queues[sessionId]);
  const pendingByTool = useMemo(() => new Map((pending ?? []).map((request) => [request.toolCallId, request])), [pending]);
  const now = useNow(running);
  const timing = turnTiming(messages, user);
  const started = running ? turnStartedAt ?? timing.start : timing.start;
  const elapsed = started ? (running ? now : timing.end ?? started) - started : undefined;
  const failure = turnError(messages);
  const aborted = !running && failure.stopReason === "aborted";
  const inlineError = (isLast ? error : null) ?? (failure.stopReason === "error" ? failure.errorMessage : undefined);
  const awaiting = running && (pending?.length ?? 0) > 0;
  // Thinking is live only while it is the newest step (a tool call or the answer ends it).
  const liveThoughtIndex = running && !content.answer && content.process.at(-1)?.part.kind === "thought" ? content.process.length - 1 : -1;
  const showProcess = running || expanded;
  const hasAnything = content.process.length > 0 || !!content.answer;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const status = retry
    ? `请求失败，正在重试（${retry.attempt}/${retry.maxAttempts}）`
    : compacting
      ? "正在压缩上下文"
      : awaiting
        ? "等待你的确认"
        : content.answer
          ? "正在回答"
          : content.process.length
            ? "正在处理"
            : "";
  const answerText = content.answer || messages.flatMap((m) => m.parts).filter((p) => p.kind === "text").map((p) => (p.kind === "text" ? p.text : "")).join("\n\n");
  const model = turnModel(messages);
  const turnKey = `t${user?.meta?.timestamp ?? messages[0]?.meta?.timestamp ?? messages[0]?.id}`;

  return (
    <div className={"turn" + (running ? " turn--running" : "") + (isLast ? " turn--last" : "")}>
      <div className="turn__head">
        <img className="msg__avatar msg__avatar--logo" src={logoMarkUrl} alt="" aria-hidden="true" draggable={false} />
        <span className="msg__name">Buddy</span>
        {running && status && (
          <span className="turn__status" role="status">
            <span className={awaiting ? "" : "ob-shining-text"}>{status}</span>
            {elapsed !== undefined && elapsed >= 1000 && <span className="turn__elapsed"> · {formatDuration(elapsed)}</span>}
          </span>
        )}
      </div>
      <div className="turn__body">
        {!running && content.process.length > 0 && (
          <button type="button" className="turn__fold" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            <span>{aborted ? "已停止" : inlineError ? "已中断" : "已完成"}{elapsed !== undefined && elapsed >= 1000 ? ` · 用时 ${formatDuration(elapsed)}` : ""}</span>
            <ChevronGlyph open={expanded} />
          </button>
        )}
        {showProcess && content.process.length > 0 && (
          <div className={"turn__process" + (running ? "" : " turn__process--folded")}>
            {content.process.map((item, index) => {
              const part = item.part;
              if (part.kind === "thought") return <ThoughtRow key={item.key} timingKey={item.key} text={part.text} live={index === liveThoughtIndex} markdownConfig={markdownConfig} />;
              if (part.kind === "tool_call") {
                const request = pendingByTool.get(part.toolCall.toolCallId);
                return (
                  <div key={item.key} className="turn__step">
                    <ToolCallCard tc={part.toolCall} cwd={cwd} onOpen={onOpenTool} />
                    {request && <PermissionCard request={request} cwd={cwd} />}
                  </div>
                );
              }
              return (
                <div key={item.key} className="turn__interim">
                  <LiveMarkdown text={part.text} live={running} markdownConfig={markdownConfig} />
                </div>
              );
            })}
          </div>
        )}
        {content.answer && (
          <div className={"turn__answer" + (running ? " turn__answer--live" : "")}>
            <LiveMarkdown text={content.answer} live={running} markdownConfig={markdownConfig} />
          </div>
        )}
        {running && !hasAnything && !retry && !compacting && <LoadingRow />}
        {running && (retry || compacting) && !hasAnything && <div className="turn__waiting ob-shining-text">{status}</div>}
        {aborted && !content.process.length && <div className="turn__stopped">已停止</div>}
        {inlineError && !running && <ErrorCard error={inlineError} onRetry={isLast ? onRetry : undefined} onToast={onToast} />}
        {!running && hasAnything && (
          <div className="turn__actions">
            <button type="button" className="turn-action" onClick={() => copyText(answerText).then(() => onToast?.("已复制"), () => onToast?.("复制失败"))} aria-label="复制" data-tip="复制"><CopyGlyph /></button>
            {isLast && onRetry && <button type="button" className="turn-action" onClick={onRetry} aria-label="重试" data-tip="重新生成"><RetryGlyph /></button>}
            <FeedbackButtons sessionId={sessionId} turnKey={turnKey} />
            <div className="turn-action__menu" ref={menuRef}>
              <button type="button" className="turn-action" onClick={() => setMenuOpen((v) => !v)} aria-label="更多" aria-expanded={menuOpen} data-tip="更多"><MoreGlyph /></button>
              {menuOpen && (
                <div className="turn-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void copyText(turnMarkdown(messages)).then(() => onToast?.("已复制 Markdown"), () => onToast?.("复制失败")); }}>复制 Markdown</button>
                  {onFork && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onFork(); }}>分叉为新任务</button>}
                </div>
              )}
            </div>
            <span className="turn__meta">
              {[clock(timing.end ?? timing.start), elapsed !== undefined && elapsed >= 1000 ? `用时 ${formatDuration(elapsed)}` : "", model].filter(Boolean).join(" · ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
