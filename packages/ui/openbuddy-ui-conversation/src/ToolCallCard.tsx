import { memo, useEffect, useState } from "react";
import type { ToolCallView } from "@/stores/session-store";
import type { DiffContent, CommandOutputContent } from "@openbuddy/shared-types";
import { checkCommandRisk, riskLabel } from "@/lib/security/command-risk";
import { precheckCommand } from "@/lib/security/sandbox-guard";
import { computeUnifiedDiff, hunksToUnifiedLines, summarizeDiff, type DiffLine } from "@/lib/files/unified-diff";
import { CheckIcon } from "@openbuddy/ui-primitives/icons";
import {
  detectToolRenderer,
  rendererLabel,
  rendererIcon,
  summarizeTool,
} from "@/lib/markdown/tool-renderers";
import { AnsiText } from "./AnsiText";

type ToolCallCardProps = {
  tc: ToolCallView;
  /** Open the right-side detail drawer (Phase 2). */
  onOpen?: (tc: ToolCallView) => void;
};

/**
 * Compact inline tool-call row (Phase 1 — WorkBuddy `unknown-tool-compact`).
 *
 * Always one line in the transcript: kind + short title + status + duration.
 * Details (command/diff/output) open in the side drawer via `onOpen`.
 *
 * Phase R3.0 (pi-web-alignment) — added elapsed-time display:
 *   - `in_progress` tools show "运行中 5s" ticking at 1s intervals
 *   - `completed` / `failed` tools show "完成 1.2s" / "失败 12s"
 *   - Tools without `startedAt` (legacy data) just show status
 */
function ToolCallCardInner({ tc, onOpen }: ToolCallCardProps) {
  // Phase R3.0 — re-render every second while the tool is in_progress so the
  // elapsed-time chip ticks up. The interval is cleared when status flips
  // to completed/failed so the chip freezes at the final value.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tc.status !== "in_progress") return;
    const handle = window.setInterval(() => setTick((n) => n + 1), 1_000);
    return () => window.clearInterval(handle);
  }, [tc.status]);
  void tick;

  const statusCls =
    tc.status === "completed"
      ? "toolcall--ok"
      : tc.status === "failed"
        ? "toolcall--err"
        : "toolcall--run";

  const statusLabel =
    tc.status === "completed" ? "完成" : tc.status === "failed" ? "失败" : "运行中";

  // 状态符号：完成态用 SVG 对勾（文本 "✓" U+2713 在 macOS WKWebView 下依赖
  // 字体回退，可能渲染成 tofu/emoji 样式）；"!" / "…" 是 ASCII/通用字符，安全。
  const statusMark =
    tc.status === "completed" ? (
      <CheckIcon size={10} strokeWidth={3} />
    ) : tc.status === "failed" ? (
      "!"
    ) : (
      "…"
    );

  const shortTitle = shortenTitle(tc.title, tc.kind);

  // Phase R3.0 — derive an elapsed-time label from `startedAt`. Falls back to
  // `null` when the legacy data lacks the field so the UI degrades cleanly.
  const elapsedMs = toolElapsedMs(tc, Date.now());
  const durationLabel = elapsedMs === null ? null : formatMillisAsHumanShort(elapsedMs);

  // 专用渲染器(对齐 WorkBuddy tools/renderers):非 default/unknown 时用图标 +
  // 渲染器标签 + 摘要替代通用 kind 文案。
  const renderer = detectToolRenderer(tc.kind);
  const specialized =
    renderer !== "default" && renderer !== "unknown";
  const kindLabel = specialized
    ? `${rendererIcon(renderer)} ${rendererLabel(renderer)}`
    : prettyKind(tc.kind);
  const summary = specialized ? summarizeTool(tc, renderer) : shortTitle;

  return (
    <button
      type="button"
      className={"toolcall toolcall--compact " + statusCls}
      onClick={() => onOpen?.(tc)}
      title={`${tc.kind}: ${tc.title}（${statusLabel}${durationLabel ? " · " + durationLabel : ""}，点击查看详情）`}
      aria-label={`${tc.kind} ${summary} ${statusLabel}${durationLabel ? " " + durationLabel : ""}`}
    >
      <span className="toolcall__kind">{kindLabel}</span>
      <span className="toolcall__title">{summary}</span>
      {durationLabel && (
        <span
          className="toolcall__duration"
          data-testid="toolcall-duration"
          data-duration-ms={elapsedMs ?? 0}
        >
          {durationLabel}
        </span>
      )}
      <span className={"toolcall__status-mark toolcall__status-mark--" + tc.status}>
        {statusMark}
      </span>
    </button>
  );
}

/**
 * Elapsed milliseconds for a tool call, or `null` when it can't be computed
 * (legacy transcripts recorded before Phase R3.0 have no `startedAt`).
 *
 * A finished tool measures against the `completedAt` stamp recorded by
 * `useAgentSession` rather than against `now`. That distinction matters: the
 * card only re-renders on a 1s interval while `in_progress`, so measuring a
 * finished tool against `now` froze it at "however long until React last
 * happened to render" — and any later unrelated re-render made the number
 * jump upward. With `completedAt` the value is the real duration and it is
 * stable forever.
 */
export function toolElapsedMs(
  tc: Pick<ToolCallView, "startedAt" | "completedAt" | "status">,
  now: number,
): number | null {
  if (typeof tc.startedAt !== "number") return null;
  const end = typeof tc.completedAt === "number" ? tc.completedAt : now;
  return Math.max(0, end - tc.startedAt);
}

/**
 * Format an elapsed-time label. Returns `null` when there's no `startedAt`
 * to base the calculation on (e.g. older transcripts recorded before
 * Phase R3.0). The labels are short (`"5s"` / `"1.2s"` / `"1m 5s"`) so
 * they fit in the compact one-line card without wrapping.
 */
export function formatToolDuration(
  startedAt: number | undefined,
  status: ToolCallView["status"],
  now: number,
  completedAt?: number,
): string | null {
  const elapsed = toolElapsedMs({ startedAt, completedAt, status }, now);
  return elapsed === null ? null : formatMillisAsHumanShort(elapsed);
}

function formatMillisAsHumanShort(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

/**
 * R1.4 — Memoized tool-call card. The card only re-renders when the
 * `tc` reference changes (tool-call update from the store) or when the
 * stable `onOpen` callback reference changes (rare — parent should
 * memoize via useCallback). Default shallow compare is sufficient
 * because `tc` is itself a stable reference from the store until its
 * content actually changes (R0.2 already short-circuits no-op updates).
 */
export const ToolCallCard = memo(ToolCallCardInner);

function prettyKind(kind: string): string {
  const k = (kind || "tool").toLowerCase();
  if (k.includes("edit") || k === "write" || k === "write_file") return "edit";
  if (k.includes("read")) return "read";
  if (k.includes("shell") || k.includes("terminal") || k.includes("execute") || k === "bash")
    return "shell";
  if (k.includes("search") || k.includes("grep") || k.includes("glob")) return "search";
  if (k.includes("list")) return "list";
  if (k.includes("ask") || k.includes("question") || k === "other") return "ask";
  return k.length > 12 ? k.slice(0, 12) : k;
}

/** Prefer a path / command snippet over the full verbose title. */
function shortenTitle(title: string, kind: string): string {
  const t = (title || "").trim();
  if (!t) return kind || "tool";
  // "Write `path`" / Write "path" / Write path
  const write = t.match(/Write\s+[`'"]?(.+?)[`'"]?\s*$/i);
  if (write?.[1]) return write[1];
  // Execute 'cmd' / Run …
  const exec = t.match(/^(?:Execute|Run)\s+[`'"]?(.+?)[`'"]?\s*$/i);
  if (exec?.[1]) {
    const cmd = exec[1];
    return cmd.length > 64 ? cmd.slice(0, 64) + "…" : cmd;
  }
  return t.length > 72 ? t.slice(0, 72) + "…" : t;
}

// ---------- shared detail body (drawer / artifacts) ----------

export function ToolCallDetailBody({
  tc,
  onOpenPath,
}: {
  tc: ToolCallView;
  onOpenPath?: (path: string) => void;
}) {
  const diff = tc.content.find((c) => c.type === "diff") as DiffContent | undefined;
  const cmd = tc.content.find((c) => c.type === "command_output") as
    | CommandOutputContent
    | undefined;
  const texts = tc.content.filter((c) => c.type === "text") as Array<{
    type: "text";
    text: string;
  }>;

  return (
    <div className="tool-detail">
      <div className="tool-detail__meta">
        <span className="toolcall__kind">{prettyKind(tc.kind)}</span>
        <span className={"tool-detail__status tool-detail__status--" + tc.status}>
          {tc.status === "completed"
            ? "已完成"
            : tc.status === "failed"
              ? "失败"
              : "运行中"}
        </span>
      </div>
      <h3 className="tool-detail__title">{tc.title}</h3>

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
          {cmd.output && <pre className="toolcall__output"><AnsiText text={cmd.output} /></pre>}
        </div>
      )}
      {/* R1.4 — partial / streaming output. Shown when the tool is still
          running and emitting tool_execution_update deltas. Lets the user
          watch long-running tools stream without waiting for the final
          result. Aligned with Codex bash streaming UX. */}
      {tc.partial === true && tc.status !== "failed" && (
        <StreamingToolOutput tc={tc} />
      )}

      {/* R1.4 — failed tool call: dedicated red callout that surfaces
          the error message extracted from the text content. Mirrors Codex /
          Claude Code's "error details" affordance so users don't have to
          scroll through raw text dumps. */}
      {tc.status === "failed" && <FailedToolCallError tc={tc} />}

      {texts.map((t, i) => (
        <pre key={i} className="toolcall__text">
          <AnsiText text={t.text} />
        </pre>
      ))}

      {/* R1.4 — apply_patch: surface file path as a clickable button (mirrors
          the existing edit / write file-path affordance). Falls back to a plain
          heading when no path is known. */}
      {tc.kind === "apply_patch" && (
        <ApplyPatchBody tc={tc} onOpenPath={onOpenPath} />
      )}

      {/* R1.4 — apply_command: surface the command + exit code + output. The
          text content already includes the JSON-ish stdout/stderr summary,
          so we render it after a structured header. */}
      {tc.kind === "apply_command" && <ApplyCommandBody tc={tc} />}

      {!diff && !cmd && texts.length === 0 && tc.rawInput != null && tc.kind !== "apply_patch" && tc.kind !== "apply_command" && (
        <pre className="toolcall__text toolcall__raw-input">
          {typeof tc.rawInput === "string"
            ? tc.rawInput
            : JSON.stringify(tc.rawInput, null, 2)}
        </pre>
      )}
      {!diff && !cmd && texts.length === 0 && tc.rawInput == null && (
        <p className="tool-detail__empty">暂无详细输出</p>
      )}
    </div>
  );
}

/**
 * R1.4 — Extract the error message from a failed tool call.
 *
 * Tool call errors surface through three places (in priority order):
 *  1. text content whose first line starts with "Error:" / "apply_patch failed:" /
 *     "apply_command failed:" — the typical extension failure prefix
 *  2. text content whose body contains "exit code N" or "Error:"
 *  3. the entire text content as a fallback
 *
 * Returns the most useful snippet for the inline error callout.
 */
export function extractErrorMessage(tc: ToolCallView): string {
  const texts = tc.content.filter((c) => c.type === "text") as Array<{ type: "text"; text: string }>;
  for (const t of texts) {
    const txt = t.text.trim();
    if (!txt) continue;
    const m = txt.match(/^(?:Error|apply_patch failed|apply_command failed|apply_patch: |TypeError|RangeError|SyntaxError)[:：]\s*(.+)$/m);
    if (m) return m[1].trim().split("\n")[0];
    const ec = txt.match(/exit (?:code )?(\d+)/);
    if (ec) return `进程退出码 ${ec[1]}`;
  }
  for (const t of texts) {
    const first = t.text.trim().split("\n").find((line) => line.trim());
    if (first) return first.slice(0, 240);
  }
  return "工具调用失败(无详细错误信息)";
}

/**
 * R1.4 — Streaming / partial tool output. Shown above the static content
 * block while a tool is still running and emitting tool_execution_update
 * deltas. Renders the most recent partialResult as a pre block with a
 * subtle pulse animation so the user can tell it is live.
 */
function StreamingToolOutput({ tc }: { tc: ToolCallView }) {
  const preview = (() => {
    const r = tc.partialResult;
    if (typeof r === "string") return r;
    try {
      return JSON.stringify(r, null, 2);
    } catch {
      return String(r);
    }
  })();
  return (
    <div className="tool-detail__streaming" aria-live="polite">
      <div className="tool-detail__streaming-head">
        <span className="tool-detail__streaming-dot" aria-hidden="true" />
        <span className="tool-detail__streaming-label">实时输出</span>
      </div>
      <pre className="tool-detail__streaming-body"><AnsiText text={preview} /></pre>
    </div>
  );
}

/** R1.4 — Inline red error callout for failed tool calls. */
function FailedToolCallError({ tc }: { tc: ToolCallView }) {
  const message = extractErrorMessage(tc);
  return (
    <div className="tool-detail__error" role="alert" aria-live="polite">
      <div className="tool-detail__error-head">
        <span className="tool-detail__error-icon" aria-hidden="true">⚠</span>
        <span className="tool-detail__error-label">执行失败</span>
      </div>
      <pre className="tool-detail__error-msg">{message}</pre>
    </div>
  );
}

/** R1.4 — apply_patch detail body. Reads rawInput.file_path + hunks count. */
function ApplyPatchBody({
  tc,
  onOpenPath,
}: {
  tc: ToolCallView;
  onOpenPath?: (path: string) => void;
}) {
  const raw = (tc.rawInput ?? {}) as { file_path?: unknown; hunks?: unknown };
  const filePath = typeof raw.file_path === "string" ? raw.file_path : "";
  const hunks = typeof raw.hunks === "number" ? raw.hunks : null;
  if (!filePath && hunks == null) return null;
  return (
    <div className="apply-patch-body">
      {filePath && (
        <button
          type="button"
          className="diff__path diff__path--clickable"
          onClick={() => onOpenPath?.(filePath)}
          title={`打开:${filePath}`}
        >
          {filePath}
        </button>
      )}
      {hunks != null && (
        <div className="apply-patch-body__stats">
          <span className="apply-patch-body__hunks">{
            hunks === 1 ? "1 hunk" : `${hunks} hunks`
          }</span>
        </div>
      )}
    </div>
  );
}

/** R1.4 — apply_command detail body. Renders command + exit-code badge. */
function ApplyCommandBody({ tc }: { tc: ToolCallView }) {
  const raw = (tc.rawInput ?? {}) as {
    command?: unknown;
    exit_code?: unknown;
    duration_ms?: unknown;
  };
  const command = typeof raw.command === "string" ? raw.command : "";
  const exitCode = typeof raw.exit_code === "number" ? raw.exit_code : null;
  const duration = typeof raw.duration_ms === "number" ? raw.duration_ms : null;
  if (!command && exitCode == null) return null;
  return (
    <div className="apply-command-body">
      {command && (
        <pre className="toolcall__cmd-line">
          <span className="toolcall__prompt">$</span>
          {command}
        </pre>
      )}
      <div className="apply-command-body__meta">
        {exitCode != null && (
          <span
            className={
              "apply-command-body__exit apply-command-body__exit--" +
              (exitCode === 0 ? "ok" : "fail")
            }
          >
            exit {exitCode}
          </span>
        )}
        {duration != null && (
          <span className="apply-command-body__duration">{
            duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(2)}s`
          }</span>
        )}
      </div>
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
  // Sandbox path guard (tsbx alternative): check if command accesses protected paths.
  const sandboxCheck = precheckCommand(command);
  const hasRisk = risk.level !== "low";
  const hasSandboxDeny = sandboxCheck.action === "deny";

  if (!hasRisk && !hasSandboxDeny) return null;

  const badges: React.ReactNode[] = [];
  if (hasRisk) {
    const cls = risk.level === "high" ? "cmd-risk cmd-risk--high" : "cmd-risk cmd-risk--medium";
    const reasons = risk.reasons.length > 0 ? `\n原因:${risk.reasons.join("; ")}` : "";
    badges.push(
      <span key="risk" className={cls} role="status" title={`⚠️ ${riskLabel(risk.level)}命令${reasons}`}>
        ⚠️ {riskLabel(risk.level)}
      </span>,
    );
  }
  if (hasSandboxDeny) {
    badges.push(
      <span key="sandbox" className="cmd-risk cmd-risk--high" role="status"
        title={`🛡️ 路径受保护:${sandboxCheck.reason} (${sandboxCheck.target})`}>
        🛡️ 受保护路径
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
