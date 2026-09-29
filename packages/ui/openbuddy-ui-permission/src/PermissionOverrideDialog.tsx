/**
 * PermissionOverrideDialog — 「per-session 权限覆盖」对话框 (P1.2 三件套之 2)
 *
 * 用途:
 *   当前会话期间,临时覆盖 mode 和 rules;关闭时回退到全局设置。
 *
 * 数据流:
 *   - open:控制可见性
 *   - currentMode / rules:初始值(从 caller 注入)
 *   - onApply:用户点击「应用」时触发,携带当前编辑的 mode + rules
 *   - onClose:用户点击「取消」/「关闭」时触发
 *
 * 行为:
 *   - 编辑 mode select(同 PermissionPanel 的 5 个选项)
 *   - 编辑 rules(简化版:不新增/删除,只切换 action)
 *   - 「仅本次会话」标识明确,避免误以为永久修改
 *
 * 单元测试: `__tests__/PermissionOverrideDialog.test.tsx`
 */

import { useEffect, useState } from "react";

import type { PermissionAction, PermissionRule } from "@openbuddy/auth-permission";

import {
  formatRule,
  PERMISSION_ACTIONS,
  PERMISSION_MODES,
  type PermissionMode,
  type PermissionOverrideDialogProps,
} from "./types.js";

export function PermissionOverrideDialog(props: PermissionOverrideDialogProps) {
  const { open, sessionId, currentMode, rules, onClose, onApply } = props;

  const [mode, setMode] = useState<PermissionMode>(currentMode);
  const [localRules, setLocalRules] = useState<PermissionRule[]>(rules);

  // Reset local state when dialog opens or upstream props change
  useEffect(() => {
    if (open) {
      setMode(currentMode);
      setLocalRules(rules);
    }
  }, [open, currentMode, rules]);

  if (!open) return null;

  const handleToggle = (idx: number, nextAction: PermissionAction) => {
    setLocalRules((prev) => prev.map((r, i) => (i === idx ? { ...r, action: nextAction } : r)));
  };

  const handleApply = async () => {
    await onApply({ mode, rules: localRules });
    onClose();
  };

  return (
    <div
      className="permission-override-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-override-title"
      data-testid="permission-override-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="permission-override-modal">
        <header className="permission-override-modal__header">
          <h2 id="permission-override-title">本次会话权限覆盖</h2>
          <p className="permission-override-modal__session">
            会话: <code data-testid="permission-override-session-id">{sessionId ?? "(无)"}</code>
          </p>
          <p className="permission-override-modal__hint">
            关闭此对话框或会话结束都会自动回退到全局设置。
          </p>
        </header>

        <section className="permission-override-modal__mode">
          <label htmlFor="permission-override-mode">默认模式</label>
          <select
            id="permission-override-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as PermissionMode)}
            data-testid="permission-override-mode-select"
          >
            {PERMISSION_MODES.map((m) => (
              <option key={m} value={m}>{describeMode(m)}</option>
            ))}
          </select>
        </section>

        <section className="permission-override-modal__rules">
          <h3>规则覆盖({localRules.length})</h3>
          {localRules.length === 0 ? (
            <p className="permission-override-modal__empty">当前无规则</p>
          ) : (
            <table data-testid="permission-override-rules-table">
              <thead>
                <tr>
                  <th>工具</th>
                  <th>模式</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {localRules.map((rule, idx) => (
                  <tr key={idx} data-testid={`permission-override-rule-${idx}`}>
                    <td>{rule.tool}</td>
                    <td>{rule.pattern ?? "—"}</td>
                    <td>
                      <select
                        value={rule.action}
                        onChange={(e) => handleToggle(idx, e.target.value as PermissionAction)}
                        aria-label={`规则 ${formatRule(rule)} 的动作`}
                        data-testid={`permission-override-rule-action-${idx}`}
                      >
                        {PERMISSION_ACTIONS.map((a) => (
                          <option key={a} value={a}>{describeAction(a)}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <footer className="permission-override-modal__footer">
          <button type="button" onClick={onClose} data-testid="permission-override-cancel">取消</button>
          <button
            type="button"
            className="permission-override-modal__apply"
            onClick={() => void handleApply()}
            data-testid="permission-override-apply"
          >
            应用到本次会话
          </button>
        </footer>
      </div>
    </div>
  );
}

function describeAction(action: PermissionAction): string {
  switch (action) {
    case "allow": return "允许";
    case "deny": return "拒绝";
    case "ask": return "询问";
  }
}

function describeMode(mode: PermissionMode): string {
  switch (mode) {
    case "default": return "默认";
    case "acceptEdits": return "自动接受编辑";
    case "dontAsk": return "不再询问";
    case "plan": return "仅计划模式";
    case "bypassPermissions": return "绕过权限检查";
  }
}
