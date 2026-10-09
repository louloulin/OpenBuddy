/**
 * PermissionPanel — 「权限管理」面板 (P1.2 三件套之 1)
 *
 * 三个核心功能:
 *   1. **视图切换**:all / allow / deny / ask 四种筛选
 *   2. **规则 CRUD**:新增规则 / 切换 action / 删除规则
 *   3. **mode 选择**:default / acceptEdits / dontAsk / plan / bypassPermissions
 *
 * 数据流:
 *   - rules + mode 由 caller 注入(从 agentPermissionBridge.readRules / readMode)
 *   - onModeChange / onRuleAdd / onRuleDelete / onRuleToggle 由 caller 注入
 *     (回写 agentPermissionBridge.writeRules / writeMode)
 *
 * 设计:
 *   - 纯展示组件,无内部状态(除了 viewMode 本地 UI 状态)
 *   - 零业务逻辑:不直接调 host-core / IPC,保持 package 边界
 *   - 测试 friendly:callsite 可注入 vi.fn() 验证交互
 *
 * 单元测试: `__tests__/PermissionPanel.test.tsx`
 */

import { useMemo, useState } from "react";

import type { PermissionAction, PermissionRule } from "@openbuddy/auth-permission";

import {
  filterRules,
  formatRule,
  PERMISSION_ACTIONS,
  PERMISSION_MODES,
  type PermissionMode,
  type PermissionPanelProps,
  type PermissionViewMode,
} from "./types.js";

const VIEW_TABS: ReadonlyArray<{ id: PermissionViewMode; label: string }> = [
  { id: "all", label: "全部" },
  { id: "allow", label: "允许" },
  { id: "deny", label: "拒绝" },
  { id: "ask", label: "询问" },
];

export function PermissionPanel(props: PermissionPanelProps) {
  const {
    rules,
    mode,
    onModeChange,
    onRuleAdd,
    onRuleDelete,
    onRuleToggle,
    loading = false,
  } = props;

  const [viewMode, setViewMode] = useState<PermissionViewMode>("all");
  const [newTool, setNewTool] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newAction, setNewAction] = useState<PermissionAction>("allow");

  const filteredRules = useMemo(() => filterRules(rules, viewMode), [rules, viewMode]);
  const grouped = useMemo(() => groupRulesByTool(filteredRules), [filteredRules]);

  const handleAdd = async () => {
    const tool = newTool.trim();
    if (!tool || !onRuleAdd) return;
    const rule: PermissionRule = {
      action: newAction,
      tool,
      ...(newPattern.trim() ? { pattern: newPattern.trim() } : {}),
    };
    await onRuleAdd(rule);
    setNewTool("");
    setNewPattern("");
  };

  return (
    <div className="permission-panel" data-testid="permission-panel">
      <header className="permission-panel__header">
        <h2>权限管理</h2>
        <p className="permission-panel__subtitle">
          规则按 deny &gt; ask &gt; allow 优先级匹配。可按工具/模式精细控制。
        </p>
      </header>

      <section className="permission-panel__mode" aria-labelledby="mode-heading">
        <h3 id="mode-heading">默认模式</h3>
        <select
          aria-label="默认模式"
          value={mode}
          onChange={(e) => void onModeChange?.(e.target.value as PermissionMode)}
          disabled={loading || !onModeChange}
          data-testid="permission-mode-select"
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>{describeMode(m)}</option>
          ))}
        </select>
      </section>

      {/* 原为 <section role="tablist">：section 是地标元素，赋予 tablist 角色
          语义冲突（且会污染地标导航）。tablist 不需要地标语义，改用 div。 */}
      <div className="permission-panel__view-tabs" role="tablist" aria-label="视图筛选">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={viewMode === tab.id}
            className={"permission-panel__tab" + (viewMode === tab.id ? " is-active" : "")}
            onClick={() => setViewMode(tab.id)}
            data-testid={`permission-tab-${tab.id}`}
          >
            {tab.label} ({countByAction(rules, tab.id)})
          </button>
        ))}
      </div>

      {onRuleAdd && (
        <section className="permission-panel__add" aria-labelledby="add-heading">
          <h3 id="add-heading">新增规则</h3>
          <div className="permission-panel__add-form">
            <input
              type="text"
              placeholder="工具名(例如 bash)"
              value={newTool}
              onChange={(e) => setNewTool(e.target.value)}
              disabled={loading}
              aria-label="工具名"
              data-testid="permission-add-tool"
            />
            <input
              type="text"
              placeholder="模式(可选,例如 git *)"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              disabled={loading}
              aria-label="模式"
              data-testid="permission-add-pattern"
            />
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value as PermissionAction)}
              disabled={loading}
              aria-label="动作"
              data-testid="permission-add-action"
            >
              {PERMISSION_ACTIONS.map((a) => (
                <option key={a} value={a}>{describeAction(a)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={loading || !newTool.trim()}
              data-testid="permission-add-submit"
            >
              添加
            </button>
          </div>
        </section>
      )}

      <section className="permission-panel__list" aria-labelledby="list-heading">
        <h3 id="list-heading">规则列表 ({filteredRules.length})</h3>
        {loading ? (
          <p className="permission-panel__loading">加载中…</p>
        ) : filteredRules.length === 0 ? (
          <p className="permission-panel__empty">当前视图下没有规则</p>
        ) : (
          <table className="permission-panel__table" data-testid="permission-rules-table">
            <thead>
              <tr>
                <th>工具</th>
                <th>模式</th>
                <th>动作</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule, idx) => (
                <tr key={idx} data-testid={`permission-rule-${idx}`}>
                  <td>{rule.tool}</td>
                  <td>{rule.pattern ?? "—"}</td>
                  <td>
                    {onRuleToggle ? (
                      <select
                        value={rule.action}
                        onChange={(e) => void onRuleToggle(rule, e.target.value as PermissionAction)}
                        disabled={loading}
                        aria-label={`规则 ${formatRule(rule)} 的动作`}
                        data-testid={`permission-rule-action-${idx}`}
                      >
                        {PERMISSION_ACTIONS.map((a) => (
                          <option key={a} value={a}>{describeAction(a)}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={"permission-panel__action permission-panel__action--" + rule.action}>
                        {describeAction(rule.action)}
                      </span>
                    )}
                  </td>
                  <td>
                    {onRuleDelete && (
                      <button
                        type="button"
                        onClick={() => void onRuleDelete(rule)}
                        disabled={loading}
                        aria-label={`删除规则 ${formatRule(rule)}`}
                        data-testid={`permission-rule-delete-${idx}`}
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {Object.keys(grouped).length > 1 && (
          <details className="permission-panel__grouping">
            <summary>按工具分组(参考)</summary>
            <ul>
              {Object.entries(grouped).map(([tool, count]) => (
                <li key={tool}>{tool}: {count} 条</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------

function countByAction(rules: PermissionRule[], mode: PermissionViewMode): number {
  return filterRules(rules, mode).length;
}

function groupRulesByTool(rules: PermissionRule[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rules) {
    out[r.tool] = (out[r.tool] ?? 0) + 1;
  }
  return out;
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
