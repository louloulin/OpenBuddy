/**
 * R1 — Session controls (thinking-level + permission-mode segmented controls).
 *
 * Sits in the chat topbar. Aligns with Codex App's topbar segmented controls
 * and WorkBuddy's tool-mode chip. Wired to the new `piSetThinkingLevel` and
 * `piSetPermissionMode` IPCs so the user can switch without typing a command.
 *
 * The component is intentionally presentation-only: it receives the current
 * values, the IPC callbacks, and a toast. The parent owns session-scope state
 * so a focus change can swap the controls without losing the in-flight
 * request.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { SparklesIcon, ShieldCheckIcon } from "@openbuddy/ui-primitives/icons";
import {
  piSetThinkingLevel,
  piSetPermissionMode,
  type OpenBuddyThinkingLevel,
  type OpenBuddyPermissionMode,
} from "@/lib/agent/pi-client";

const THINKING_OPTIONS: ReadonlyArray<{ value: OpenBuddyThinkingLevel; label: string; title: string }> = [
  { value: "off", label: "关", title: "关闭深度思考" },
  { value: "low", label: "低", title: "轻度思考" },
  { value: "medium", label: "中", title: "中度思考" },
  { value: "high", label: "高", title: "深度思考" },
];

const PERMISSION_OPTIONS: ReadonlyArray<{ value: OpenBuddyPermissionMode; label: string; title: string }> = [
  { value: "default", label: "默认", title: "默认:每次工具调用都询问" },
  { value: "acceptEdits", label: "编辑", title: "自动接受文件编辑" },
  { value: "plan", label: "计划", title: "先写计划再执行" },
  { value: "dontAsk", label: "静默", title: "不询问,直接执行" },
  { value: "bypassPermissions", label: "Bypass", title: "所有工具调用无询问(危险)" },
];

interface SessionControlsProps {
  sessionId: string;
  /** Initial thinking level (loaded from session metadata). */
  initialThinkingLevel?: OpenBuddyThinkingLevel;
  /** Initial permission mode (loaded from settings). */
  initialPermissionMode?: OpenBuddyPermissionMode;
  onToast?: (msg: string) => void;
  /** Disabled while the agent is mid-turn (matches Codex topbar UX). */
  disabled?: boolean;
  /** Show the thinking-level segmented control (default true). */
  showThinking?: boolean;
  /** Show the permission-mode segmented control (default true).
   *  Set false when the composer footer already renders a compact
   *  PermissionPicker dropdown (matches the WorkBuddy / home-page footer
   *  pattern and avoids showing two parallel permission widgets). */
  showPermission?: boolean;
}

export const SessionControls = memo(function SessionControls({
  sessionId,
  initialThinkingLevel = "medium",
  initialPermissionMode = "default",
  onToast,
  disabled = false,
  showThinking = true,
  showPermission = true,
}: SessionControlsProps) {
  const [thinking, setThinking] = useState<OpenBuddyThinkingLevel>(initialThinkingLevel);
  const [perm, setPerm] = useState<OpenBuddyPermissionMode>(initialPermissionMode);
  const [busy, setBusy] = useState<"thinking" | "permission" | null>(null);
  // Track the latest in-flight request so a stale response can't overwrite a
  // newer click.
  const reqRef = useRef(0);

  // Sync to prop changes when the focused session changes
  useEffect(() => {
    setThinking(initialThinkingLevel);
    setPerm(initialPermissionMode);
  }, [sessionId, initialThinkingLevel, initialPermissionMode]);

  const handleThinking = useCallback(
    async (next: OpenBuddyThinkingLevel) => {
      if (next === thinking || busy) return;
      const ticket = ++reqRef.current;
      setBusy("thinking");
      setThinking(next); // optimistic
      try {
        await piSetThinkingLevel(sessionId, next);
        onToast?.(`思考档位已切换为 ${next}`);
      } catch (e) {
        if (ticket === reqRef.current) setThinking(thinking);
        onToast?.(`切换失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (ticket === reqRef.current) setBusy(null);
      }
    },
    [sessionId, thinking, busy, onToast],
  );

  const handlePerm = useCallback(
    async (next: OpenBuddyPermissionMode) => {
      if (next === perm || busy) return;
      const ticket = ++reqRef.current;
      setBusy("permission");
      setPerm(next);
      try {
        await piSetPermissionMode(sessionId, next);
        onToast?.(`权限模式已切换为 ${next}`);
      } catch (e) {
        if (ticket === reqRef.current) setPerm(perm);
        onToast?.(`切换失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (ticket === reqRef.current) setBusy(null);
      }
    },
    [sessionId, perm, busy, onToast],
  );

  return (
    <div className="session-controls" role="toolbar" aria-label="会话控制">
      {showThinking && (
        <SegmentedControl
          icon={<SparklesIcon size="sm" />}
          label="思考"
          value={thinking}
          options={THINKING_OPTIONS}
          onChange={handleThinking}
          disabled={disabled || busy === "thinking"}
        />
      )}
      {showPermission && (
        <SegmentedControl
          icon={<ShieldCheckIcon size="sm" />}
          label="权限"
          value={perm}
          options={PERMISSION_OPTIONS}
          onChange={handlePerm}
          disabled={disabled || busy === "permission"}
        />
      )}
    </div>
  );
});

interface SegmentedControlProps<T extends string> {
  icon?: React.ReactNode;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
}

/** Compact 4-5 option segmented control. Used for thinking/permission modes. */
function SegmentedControl<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
  disabled,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={"session-controls__segment" + (disabled ? " session-controls__segment--disabled" : "")}
      role="radiogroup"
      aria-label={label}
    >
      {icon && <span className="session-controls__icon" aria-hidden="true">{icon}</span>}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={opt.title}
            className={
              "session-controls__chip" + (active ? " session-controls__chip--active" : "")
            }
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
