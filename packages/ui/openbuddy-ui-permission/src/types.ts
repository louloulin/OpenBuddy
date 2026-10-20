/**
 * P1.2 权限 UI — 共享类型
 */

import type { PermissionAction, PermissionMode, PermissionRule } from "@openbuddy/auth-permission";

/** 三种视图(对应 TODO.md "Permission management panel") */
export type { PermissionAction, PermissionMode, PermissionRule } from "@openbuddy/auth-permission";

export type PermissionViewMode = "all" | "allow" | "deny" | "ask";

export interface PermissionPanelProps {
  rules: PermissionRule[];
  mode: PermissionMode;
  onModeChange?: (mode: PermissionMode) => void | Promise<void>;
  onRuleAdd?: (rule: PermissionRule) => void | Promise<void>;
  onRuleDelete?: (rule: PermissionRule) => void | Promise<void>;
  onRuleToggle?: (rule: PermissionRule, nextAction: PermissionAction) => void | Promise<void>;
  /** 可选:加载状态,UI 会显示 skeleton */
  loading?: boolean;
}

export interface PermissionOverrideDialogProps {
  open: boolean;
  sessionId: string | null;
  currentMode: PermissionMode;
  rules: PermissionRule[];
  onClose: () => void;
  onApply: (input: { mode: PermissionMode; rules: PermissionRule[] }) => void | Promise<void>;
}

export interface FolderTrustPanelProps {
  /** 已知文件夹列表(folder → trusted?) */
  entries: ReadonlyArray<{ cwd: string; trusted: boolean; decidedAt?: string }>;
  onGrant?: (cwd: string) => void | Promise<void>;
  onRevoke?: (cwd: string) => void | Promise<void>;
  /** 用户可输入新文件夹路径 */
  onAdd?: (cwd: string) => void | Promise<void>;
  loading?: boolean;
}

export const PERMISSION_ACTIONS: readonly PermissionAction[] = ["allow", "deny", "ask"];
export const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "dontAsk",
  "plan",
  "bypassPermissions",
];

export function filterRules(rules: PermissionRule[], mode: PermissionViewMode): PermissionRule[] {
  if (mode === "all") return rules;
  return rules.filter((r) => r.action === mode);
}

export function formatRule(rule: PermissionRule): string {
  return rule.pattern ? `${rule.tool}(${rule.pattern})` : rule.tool;
}
