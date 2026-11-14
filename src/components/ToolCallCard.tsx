import { useEffect, useState } from "react";
import type { ToolCallView } from "@/stores/session-store";
import type { DiffContent, CommandOutputContent, ImageToolContent } from "@/lib/types";
import { checkCommandRisk, riskLabel } from "@/lib/command-risk";
import { computeUnifiedDiff, hunksToUnifiedLines, summarizeDiff, type DiffLine } from "@/lib/unified-diff";
import {
  CheckIcon,
  EditToolIcon,
  FolderToolIcon,
  McpIcon,
  SearchToolIcon,
  TerminalToolIcon,
  ToolDefaultIcon,
  ViewedToolIcon,
} from "@/foundation/components/Icon/icons";
import { diffStats, formatDuration, toolDiff, toolLabel, toolOutput, toolSubject } from "@/lib/tool-summary";
import { ChevronGlyph } from "./chat/icons";

type ToolCallCardProps = {
  tc: ToolCallView;
  /** Workspace used to shorten paths. */
  cwd?: string;
  /** Open the right-side detail drawer. */
  onOpen?: (tc: ToolCallView) => void;
};

function ToolIcon({ name }: { name: string }) {
  if (name === "bash" || name === "powershell") return <TerminalToolIcon size={14} />;
  if (name === "edit" || name === "write") return <EditToolIcon size={14} />;
  if (name === "read") return <ViewedToolIcon size={14} />;
  if (name === "ls") return <FolderToolIcon size={14} />;
  if (name === "grep" || name === "find") return <SearchToolIcon size={14} />;
  if (name.startsWith("mcp__")) return <McpIcon size={14} />;
  return <ToolDefaultIcon size={14} />;
}

/** Ticks once a second while a tool is running so the elapsed time stays live. */
function useElapsed(startedAt: number | undefined, running: boolean): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt]);
  return running && startedAt ? now - startedAt : undefined;
}

/**
 * One tool call as a single transcript row: icon · what · object · time · status.
 * Details (command output, diff) open in the side drawer.
 */
export function ToolCallCard({ tc, cwd, onOpen }: ToolCallCardProps) {
  const running = tc.status === "in_progress";
  const elapsed = useElapsed(tc.startedAt, running);
  const label = toolLabel(tc.kind);
  const subject = toolSubject(tc.kind, tc.rawInput, cwd);
  const diff = !running ? toolDiff(tc) : undefined;
  const stats = diff ? diffStats(diff.lines) : undefined;
  const time = running ? (elapsed !== undefined && elapsed >= 1000 ? formatDuration(elapsed) : "") : formatDuration(tc.durationMs);
  const statusLabel = tc.status === "completed" ? "完成" : tc.status === "failed" ? "失败" : "运行中";
  const lastLine = running ? toolOutput(tc).trimEnd().split("\n").at(-1) : undefined;
  return (
    <div className={"toolrow toolrow--" + tc.status}>
      <button
        type="button"
        className="toolrow__main"
        onClick={() => onOpen?.(tc)}
        title={`${label}${subject ? `：${subject}` : ""}（${statusLabel}，点击查看详情）`}
        aria-label={`${label} ${subject} ${statusLabel}`}
      >
        <span className="toolrow__icon"><ToolIcon name={tc.kind} /></span>
        <span className="toolrow__label">{label}</span>
        {subject && <span className="toolrow__subject">{subject}</span>}
        {stats && (stats.added > 0 || stats.removed > 0) && (
          <span className="toolrow__stats">
            {stats.added > 0 && <span className="toolrow__add">+{stats.added}</span>}
            {stats.removed > 0 && <span className="toolrow__del">−{stats.removed}</span>}
          </span>
        )}
        {time && <span className="toolrow__time">{time}</span>}
        <span className={"toolrow__mark toolrow__mark--" + tc.status} aria-hidden>
          {tc.status === "completed" ? <CheckIcon size={12} strokeWidth={2.5} /> : tc.status === "failed" ? "!" : <span className="toolrow__spinner" />}
        </span>
        {onOpen && <span className="toolrow__go" aria-hidden><ChevronGlyph /></span>}
      </button>
      {lastLine && <div className="toolrow__live">{lastLine}</div>}
    </div>
  );
}

// ---------- shared detail body (drawer / artifacts) ----------

export function ToolCallDetailBody({
  tc,
  onOpenPath,
  cwd,
}: {
  tc: ToolCallView;
  onOpenPath?: (path: string) => void;
  cwd?: string;
}) {
  const piDiff = toolDiff(tc);
  const command = (tc.kind === "bash" || tc.kind === "powershell") && tc.rawInput && typeof tc.rawInput === "object" ? (tc.rawInput as { command?: unknown }).command : undefined;
  const diff = tc.content.find((c) => c.type === "diff") as DiffContent | undefined;
  const cmd = tc.content.find((c) => c.type === "command_output") as
    | CommandOutputContent
    | undefined;
  const images = tc.content.filter((c) => c.type === "image") as ImageToolContent[];
  const texts = tc.content.filter((c) => c.type === "text") as Array<{
    type: "text";
    text: string;
  }>;

  return (
    <div className="tool-detail">
      <div className="tool-detail__meta">
        <span className="toolcall__kind">{toolLabel(tc.kind)}</span>
        <span className={"tool-detail__status tool-detail__status--" + tc.status}>
          {tc.status === "completed"
            ? "已完成"
            : tc.status === "failed"
              ? "失败"
              : "运行中"}
        </span>
        {tc.durationMs !== undefined && <span className="tool-detail__time">{formatDuration(tc.durationMs)}</span>}
      </div>
      <h3 className="tool-detail__title">{toolSubject(tc.kind, tc.rawInput, cwd) || toolLabel(tc.kind)}</h3>
      {typeof command === "string" && (
        <div className="toolcall__cmd">
          <CommandRiskBadge command={command} />
          <pre className="toolcall__cmd-line"><span className="toolcall__prompt">$</span>{command}</pre>
        </div>
      )}
      {piDiff && piDiff.lines.length > 0 && <LinesDiffView path={piDiff.path} lines={piDiff.lines} onOpenPath={onOpenPath} />}

      {diff && (
        <DiffView
          diff={diff.diff}
          onOpenPath={onOpenPath}
        />
      )}
      {cmd && (
        <div className="toolcall__cmd">
          {cmd.command && <CommandRiskBadge command={cmd.command} />}
          {cmd.command && (
            <pre className="toolcall__cmd-line">
              <span className="toolcall__prompt">$</span>
              {cmd.command}
            </pre>
          )}
          {cmd.output && <pre className="toolcall__output">{cmd.output}</pre>}
        </div>
      )}
      {images.length > 0 && (
        <div className="toolcall__images">
          {images.map((img, i) => (
            <img
              key={i}
              className="toolcall__image"
              src={img.uri || `data:${img.mimeType};base64,${img.data}`}
              alt={img.uri || `工具输出图片 ${i + 1}`}
              loading="lazy"
            />
          ))}
        </div>
      )}
      {texts.map((t, i) => (
        <pre key={i} className="toolcall__text">
          {t.text}
        </pre>
      ))}
      {!diff && !cmd && !piDiff && typeof command !== "string" && images.length === 0 && texts.length === 0 && tc.rawInput != null && (
        <pre className="toolcall__text toolcall__raw-input">
          {typeof tc.rawInput === "string"
            ? tc.rawInput
            : JSON.stringify(tc.rawInput, null, 2)}
        </pre>
      )}
      {!diff && !cmd && !piDiff && typeof command !== "string" && images.length === 0 && texts.length === 0 && tc.rawInput == null && (
        <p className="tool-detail__empty">暂无详细输出</p>
      )}
    </div>
  );
}

/**
 * 命令风险徽章 —— 对齐 WorkBuddy `command-risk`。
 *
 * 仅在 medium / high 时显示(对齐 WorkBuddy 标注而非拦截);low 不渲染任何东西。
 * `reasons` 通过 title 悬浮提示展示命中原因。
 */
function CommandRiskBadge({ command }: { command: string }) {
  const risk = checkCommandRisk(command);
  const hasRisk = risk.level !== "low";
  if (!hasRisk) return null;

  const badges: React.ReactNode[] = [];
  if (hasRisk) {
    const cls = risk.level === "high" ? "cmd-risk cmd-risk--high" : "cmd-risk cmd-risk--medium";
    const reasons = risk.reasons.length > 0 ? `\n原因:${risk.reasons.join("; ")}` : "";
    badges.push(
      <span key="risk" className={cls} role="status" title={`${riskLabel(risk.level)}命令${reasons}`}>
        {riskLabel(risk.level)}
      </span>,
    );
  }
  return <>{badges}</>;
}

function DiffView({
  diff,
  onOpenPath,
}: {
  diff: DiffContent["diff"];
  onOpenPath?: (path: string) => void;
}) {
  const path = diff.path || "";
  const oldText = diff.old ?? "";
  const newText = diff.new ?? "";

  // Use proper unified diff algorithm when we have old/new text.
  // Fall back to hunks if only hunks are provided.
  let lines: DiffLine[];
  if (diff.hunks && diff.hunks.length && !oldText && !newText) {
    lines = hunksToUnifiedLines(diff.hunks);
  } else {
    lines = computeUnifiedDiff(oldText, newText, 3);
  }

  const summary = summarizeDiff(lines);

  const pathEl = path ? (
    <button
      type="button"
      className="diff__path diff__path--clickable"
      onClick={() => onOpenPath?.(path)}
      title={`打开：${path}`}
    >
      {path}
    </button>
  ) : (
    <div className="diff__path">(unknown path)</div>
  );

  return (
    <div className="diff">
      {pathEl}
      {lines.length > 0 && (
        <div className="diff__stats">
          <span className="diff__stats-add">+{summary.added}</span>
          <span className="diff__stats-del">-{summary.removed}</span>
        </div>
      )}
      <pre className="diff__body">
        {lines.map((l, i) => (
          <div key={i} className={`diff__line diff__line--${l.kind}`}>
            <span className="diff__line-num">
              {l.oldLine ?? ""}
              {l.newLine != null && l.oldLine != null ? "," : ""}
              {l.newLine ?? ""}
            </span>
            <span className="diff__line-prefix">
              {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
            </span>
            <span className="diff__line-text">{l.text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Render pre-computed diff lines (Pi edit patch / write content). */
function LinesDiffView({ path, lines, onOpenPath }: { path: string; lines: DiffLine[]; onOpenPath?: (path: string) => void }) {
  const summary = summarizeDiff(lines);
  return (
    <div className="diff">
      {path ? (
        <button type="button" className="diff__path diff__path--clickable" onClick={() => onOpenPath?.(path)} title={`打开：${path}`}>{path}</button>
      ) : null}
      <div className="diff__stats">
        <span className="diff__stats-add">+{summary.added}</span>
        <span className="diff__stats-del">-{summary.removed}</span>
      </div>
      <pre className="diff__body">
        {lines.map((l, i) => (
          <div key={i} className={`diff__line diff__line--${l.kind}`}>
            <span className="diff__line-num">{l.kind === "del" ? l.oldLine ?? "" : l.newLine ?? ""}</span>
            <span className="diff__line-prefix">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
            <span className="diff__line-text">{l.text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
