/**
 * StatusPill — phase-aware status chip for the chat header.
 *
 * Phase R3.0 (pi-web-alignment):
 *   Phase state machine already exists at `src/lib/stream/agent-phase.ts`
 *   (`phaseLabel` returns Chinese strings for idle / waiting_model /
 *   running_command / running_tools) but had **zero** consumers before this
 *   component landed. LoadingRow previously used a hardcoded 1200 ms timer
 *   that said "准备中 → 等待模型响应" no matter what the agent was actually
 *   doing — users couldn't tell whether the model was thinking, running a
 *   tool, or executing a shell command.
 *
 * This component:
 *   - Subscribes to `useSessionStore((s) => s.phase)` (default; prop override
 *     for non-store callers like App.tsx header chips).
 *   - Renders `phaseLabel(phase)` so the chip is always coherent with the
 *     canonical state machine.
 *   - For `running_tools`, expands the message with the actual tool count
 *     and a comma-separated name list (capped at 3 to keep the chip short).
 *   - Applies a CSS tone token (`--status-pill-tone: idle | waiting | running | error`)
 *     so the chip color matches the underlying activity.
 *
 * High-cohesion design: this is a **display-only** component. It never
 * writes to the store, never spawns timers, and never calls back into Pi.
 * All state derivation lives in `phaseReducer` (pure).
 */
import { memo, useMemo } from "react";
import { phaseLabel, type AgentPhase } from "@/lib/stream/agent-phase";
import { useSessionStore } from "@/stores/session-store";

export interface StatusPillProps {
  /**
   * Optional explicit phase. When omitted the component reads from
   * `useSessionStore((s) => s.phase)` (default — covers the most common
   * ChatView / LoadingRow use case).
   */
  phase?: AgentPhase;
  /** Additional class names appended to the root `<span>`. */
  className?: string;
  /**
   * Hide the textual label and render only the tone dot. Useful for compact
   * header chips where space is at a premium.
   */
  showLabel?: boolean;
}

/** Pick a CSS tone based on phase kind. */
function toneForPhase(phase: AgentPhase): "idle" | "waiting" | "running" | "error" {
  if (!phase || phase.kind === "idle") return "idle";
  if (phase.kind === "waiting_model") return "waiting";
  // running_command and running_tools both imply active work.
  return "running";
}

/**
 * Format the running_tools phase with the actual tool names (capped to 3) so
 * the user can see "运行 3 个工具: read, bash, edit" instead of just the count.
 * Mirrors pi-web's `phaseLabel` extensibility but keeps the chip short.
 */
function renderRunningToolsLabel(phase: Extract<AgentPhase, { kind: "running_tools" }>): string {
  const count = phase.tools.length;
  if (count === 0) return phaseLabel(phase);
  const names = phase.tools.map((t) => t.name);
  const visible = names.slice(0, 3);
  const suffix = names.length > 3 ? ` 等 ${names.length} 个` : "";
  return `运行 ${count} 个工具: ${visible.join(", ")}${suffix}`;
}

function StatusPillInner({ phase: phaseProp, className, showLabel = true }: StatusPillProps) {
  // Read from store when no explicit phase is supplied. The selector returns
  // a referentially-stable value (phaseReducer guarantees this), so
  // memo'd consumers skip re-renders when nothing changed.
  const storePhase = useSessionStore((s) => s.phase);
  const phase = phaseProp ?? storePhase;

  const label = useMemo(() => {
    if (phase && phase.kind === "running_tools") return renderRunningToolsLabel(phase);
    return phaseLabel(phase);
  }, [phase]);

  const tone = toneForPhase(phase);
  const isIdle = tone === "idle";

  return (
    <span
      className={`status-pill status-pill--${tone}${className ? ` ${className}` : ""}`}
      data-tone={tone}
      data-testid="status-pill"
      aria-live="polite"
      aria-atomic="true"
      // Phase R3.0: hide the pill entirely when idle AND no label is needed
      // — saves layout shift on the chat header between turns.
      hidden={isIdle && !showLabel ? true : undefined}
    >
      <span className="status-pill__dot" aria-hidden="true" />
      {showLabel && <span className="status-pill__label">{label}</span>}
    </span>
  );
}

export const StatusPill = memo(StatusPillInner);