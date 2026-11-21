import { useCallback, useEffect, useRef, useState } from "react";
import { agentSessionInfo, agentSessionUsage } from "@openbuddy/client/agent-client";
import type { ContextInfo, SessionUsage } from "@openbuddy/protocol/dto";
import type { SessionUsageExtras } from "@openbuddy/protocol/agent-settings";
import { ContextUsageActions } from "./ContextUsageActions";



interface Snapshot {
  ctx: ContextInfo;
  usage?: SessionUsage & SessionUsageExtras;
  /** Automatic compaction for this session (W1.5); undefined from an older host. */
  autoCompaction?: boolean;
}

/** Adaptive token formatting: ≥100万 → 万, else K. */
function fmtToken(t: number, useWan: boolean): string {
  if (useWan) {
    const wan = t / 10000;
    return `${Number.isInteger(wan) ? wan : wan.toFixed(1)}万`;
  }
  if (t >= 1000) return `${(t / 1000).toFixed(1)}K`;
  return String(t);
}

interface CategoryRow {
  key: string;
  label: string;
  tokens: number;
  detail?: string;
}

function buildRows(ctx: ContextInfo): CategoryRow[] {
  const cats = ctx.usageCategories ?? [];
  const skills = cats.find((c) => c.label === "Skills");
  const mcp = cats.find((c) => c.label === "MCP servers");
  const rows: CategoryRow[] = [
    { key: "messages", label: "消息", tokens: ctx.messageTokens },
    { key: "tools", label: "系统工具", tokens: ctx.toolDefinitionsTokens },
    { key: "skills", label: "技能", tokens: skills?.tokens ?? 0, detail: skills?.detail },
    { key: "system", label: "系统提示词", tokens: ctx.systemPromptTokens },
  ];
  if (mcp && mcp.tokens > 0) {
    rows.push({ key: "mcp", label: "MCP", tokens: mcp.tokens, detail: mcp.detail });
  }
  // 估算,口径与 used 不完全一致(可能重叠),总和可能超过 used。超过时按比例
  // 缩放到 used,保证各项占比之和恒为 100%;不足时差额归入「其他」。
  const known = rows.reduce((s, r) => s + r.tokens, 0);
  if (known > ctx.used && known > 0) {
    const scale = ctx.used / known;
    for (const r of rows) r.tokens = Math.round(r.tokens * scale);
    rows.push({ key: "other", label: "其他", tokens: Math.max(0, ctx.used - rows.reduce((s, r) => s + r.tokens, 0)) });
  } else {
    rows.push({ key: "other", label: "其他", tokens: Math.max(0, ctx.used - known) });
  }
  return rows;
}

export function ContextUsagePill({ sessionId, onRefreshSignal }: { sessionId: string; onRefreshSignal?: number }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // One request at a time; a refresh asked for mid-flight runs once afterwards.
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    const run = async () => {
      try {
        const [info, usage] = await Promise.all([
          agentSessionInfo(sessionId),
          agentSessionUsage(sessionId).catch(() => undefined as SessionUsage | undefined),
        ]);
        if (info?.context?.total) setSnap({ ctx: info.context, usage, autoCompaction: info.autoCompaction });
      } catch { /* session not live in agent — pill stays hidden */ }
    };
    inflight.current = run();
    await inflight.current;
    inflight.current = null;
    if (again.current) { again.current = false; void refresh(); }
  }, [sessionId]);

  // Fetch on mount + session change.
  useEffect(() => {
    setSnap(null);
    setOpen(false);
    void refresh();
  }, [sessionId, refresh]);

  // Re-fetch when parent signals (e.g. agent://complete).
  useEffect(() => {
    if (onRefreshSignal !== undefined) void refresh();
  }, [onRefreshSignal, refresh]);

  // Re-fetch when popover opens.
  useEffect(() => {
    if (!open) return;
    void refresh();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, refresh]);

  const ctx = snap?.ctx;
  if (!ctx || !ctx.total) return null;

  const pct = ctx.usagePct;
  const pctLabel = `${Math.round(pct)}%`;
  const level = pct >= 95 ? "danger" : pct >= 80 ? "warn" : "normal";
  const useWan = ctx.total >= 1_000_000;
  const rows = buildRows(ctx);
  const cacheHit =
    snap.usage && snap.usage.inputTokens > 0
      ? `${((snap.usage.cachedReadTokens / snap.usage.inputTokens) * 100).toFixed(1)}%`
      : "—";

  // Ring SVG params
  const r = 7;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;

  return (
    <div className="context-usage" ref={ref}>
      <button
        type="button"
        className={"context-usage__pill context-usage__pill--" + level + (open ? " context-usage__pill--open" : "")}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={`${pctLabel} · ${fmtToken(ctx.used, useWan)} / ${fmtToken(ctx.total, useWan)} 上下文已使用`}
        aria-label={`上下文已使用 ${pctLabel}`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" className="context-usage__ring">
          <circle cx="9" cy="9" r={r} fill="none" className="context-usage__ring-track" />
          <circle
            cx="9" cy="9" r={r} fill="none"
            className="context-usage__ring-progress"
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <span className="context-usage__pill-text">{pctLabel}</span>
      </button>
      {open && (
        <div className="context-usage__popover" onClick={(e) => e.stopPropagation()}>
          <div className="context-usage__popover-header">
            <span className="context-usage__popover-title">上下文容量</span>
            <span className="context-usage__popover-summary">
              {fmtToken(ctx.used, useWan)}/{fmtToken(ctx.total, useWan)}（{pct.toFixed(pct < 10 ? 1 : 0)}%）
            </span>
          </div>
          <div className="context-usage__bar">
            <div
              className="context-usage__bar-fill"
              style={{ width: `${Math.min(100, Math.max(0, (ctx.used / ctx.total) * 100))}%` }}
            />
          </div>
          <ul className="context-usage__rows">
            {rows.map((r) => (
              <li key={r.key} className="context-usage__row">
                <span className={`context-usage__swatch context-usage__swatch--${r.key}`} />
                <span className="context-usage__row-label">
                  {r.label}
                  {r.detail ? <span className="context-usage__row-detail">{r.detail}</span> : null}
                </span>
                <span className="context-usage__row-value">
                  {ctx.used > 0 ? `${((r.tokens / ctx.used) * 100).toFixed(1)}%` : "0%"}
                </span>
              </li>
            ))}
          </ul>
          <div className="context-usage__footer">
            <span>平均缓存命中率</span>
            <span className="context-usage__footer-value">{cacheHit}</span>
          </div>
          <ContextUsageActions sessionId={sessionId} cost={snap.usage?.cost} autoCompaction={snap.autoCompaction} onChanged={() => void refresh()} />
        </div>
      )}
    </div>
  );
}
