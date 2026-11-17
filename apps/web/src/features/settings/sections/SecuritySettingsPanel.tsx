import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Plus, RotateCcw, Shield, Trash2 } from "lucide-react";
import {
  permissionList,
  permissionProtectedGet,
  permissionProtectedSet,
  permissionSave,
} from "@openbuddy/client/agent-client";
import type { PermissionRule } from "@openbuddy/protocol/dto";
import { SectionShell } from "./shared";

/**
 * 安全中心 (20261116-pii W6.1 / W6.2)。
 *
 * - 规则按 读取 / 写入 / 删除 / 命令 / MCP / 其他 分组，每行可直接改成 允许 / 询问 / 拒绝
 *   （`permission_save`，下一次工具调用立即生效）；「始终允许」产生的规则也在这里撤销。
 * - 受保护路径是硬边界：即使完全访问或 always-approve，写入 `.env` / `.git` / 密钥文件
 *   也会被拒绝；列表可增删、可恢复默认（`permission_protected_get / set`）。
 */

type CategoryId = "read" | "write" | "delete" | "command" | "mcp" | "other";
const CATEGORIES: Array<{ id: CategoryId; label: string; tools: readonly string[] }> = [
  { id: "read", label: "读取", tools: ["read", "grep", "find", "ls"] },
  { id: "write", label: "写入", tools: ["write", "edit"] },
  { id: "delete", label: "删除", tools: [] },
  { id: "command", label: "命令", tools: ["bash"] },
  { id: "mcp", label: "MCP 工具", tools: ["mcp"] },
  { id: "other", label: "其他", tools: [] },
];

function categoryOf(rule: PermissionRule): CategoryId {
  const tool = rule.tool;
  if (tool === "mcp" || tool.startsWith("mcp__")) return "mcp";
  if (/delete|remove/i.test(tool)) return "delete";
  if (CATEGORIES[0].tools.includes(tool)) return "read";
  if (CATEGORIES[1].tools.includes(tool)) return "write";
  if (tool === "bash") return "command";
  return "other";
}

const ACTION_LABEL: Record<string, string> = { allow: "允许", ask: "询问", deny: "拒绝" };
const ACTIONS = ["allow", "ask", "deny"] as const;

export function SecuritySettingsPanel() {
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTool, setNewTool] = useState("write");
  const [newPattern, setNewPattern] = useState("");
  const [newPath, setNewPath] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextRules, protectedPaths] = await Promise.all([permissionList(), permissionProtectedGet()]);
      setRules(Array.isArray(nextRules) ? nextRules : []);
      setPaths(Array.isArray(protectedPaths?.paths) ? protectedPaths.paths : []);
      setDefaults(Array.isArray(protectedPaths?.defaults) ? protectedPaths.defaults : []);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<CategoryId, PermissionRule[]>();
    for (const rule of rules) {
      const id = categoryOf(rule);
      map.set(id, [...(map.get(id) ?? []), rule]);
    }
    return map;
  }, [rules]);

  const commitRules = async (next: PermissionRule[]) => {
    setBusy(true);
    setError(null);
    try {
      await permissionSave(next);
      setRules(next);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const setAction = (index: number, action: string) =>
    commitRules(rules.map((rule, i) => (i === index ? { ...rule, action } : rule)));
  const removeRule = (index: number) => commitRules(rules.filter((_, i) => i !== index));
  const addRule = () => {
    const tool = newTool.trim();
    if (!tool) return;
    const pattern = newPattern.trim();
    void commitRules([...rules, { action: "ask", tool, ...(pattern ? { pattern } : {}) }]);
    setNewPattern("");
  };

  const commitPaths = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await permissionProtectedSet(next);
      setPaths(Array.isArray(saved?.paths) ? saved.paths : next);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="安全中心"
      desc="工具执行的放行规则与受保护路径。改动立即生效：下一次工具调用就按新规则判断。"
    >
      {error && <div className="sec-error">{error}</div>}

      {/* 受保护路径 */}
      <div className="sec-card">
        <div className="sec-card__head">
          <div className="sec-card__title">
            <Lock size={15} />
            <span>受保护路径</span>
          </div>
          <div className="sec-card__hint">写入 / 编辑 / 删除这些文件一律拒绝，完全访问也不例外。</div>
        </div>
        <div className="sec-chips">
          {paths.length === 0 ? (
            <span className="sec-muted">{loading ? "加载中…" : "没有受保护路径（写入不再受硬性拦截）"}</span>
          ) : (
            paths.map((path) => (
              <span className="sec-chip" key={path}>
                <code>{path}</code>
                <button
                  type="button"
                  className="sec-chip__x"
                  aria-label={`移除受保护路径 ${path}`}
                  disabled={busy}
                  onClick={() => void commitPaths(paths.filter((item) => item !== path))}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="sec-add">
          <input
            type="text"
            value={newPath}
            placeholder=".env / *.pem / .git / config/secrets.json"
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newPath.trim()) {
                void commitPaths([...paths, newPath.trim()]);
                setNewPath("");
              }
            }}
          />
          <button
            type="button"
            className="sec-btn sec-btn--ink"
            disabled={busy || !newPath.trim()}
            onClick={() => {
              void commitPaths([...paths, newPath.trim()]);
              setNewPath("");
            }}
          >
            <Plus size={14} /> 添加
          </button>
          <button
            type="button"
            className="sec-btn"
            disabled={busy || defaults.length === 0}
            onClick={() => void commitPaths(defaults)}
            title="恢复为默认的 .env / .git / 密钥等"
          >
            <RotateCcw size={14} /> 恢复默认
          </button>
        </div>
        <p className="sec-footnote">
          <code>.env</code> 同时覆盖 <code>.env.local</code>；<code>*.pem</code> 按后缀匹配；<code>.git</code> 匹配路径中任意一段。
        </p>
      </div>

      {/* 规则 */}
      <div className="sec-card">
        <div className="sec-card__head">
          <div className="sec-card__title">
            <Shield size={15} />
            <span>权限规则</span>
          </div>
          <div className="sec-card__hint">拒绝 &gt; 询问 &gt; 允许。「始终允许」产生的规则可以在这里撤销。</div>
        </div>

        {loading ? (
          <div className="sec-muted">加载中…</div>
        ) : rules.length === 0 ? (
          <div className="sec-muted">还没有自定义规则。所有工具都按当前权限模式处理。</div>
        ) : (
          CATEGORIES.map((category) => {
            const items = grouped.get(category.id) ?? [];
            if (items.length === 0) return null;
            return (
              <div className="sec-group" key={category.id}>
                <div className="sec-group__label">
                  {category.label}
                  <span className="sec-group__count">{items.length}</span>
                </div>
                {items.map((rule) => {
                  const index = rules.indexOf(rule);
                  return (
                    <div className="sec-rule" key={`${rule.tool}-${rule.pattern ?? ""}-${index}`}>
                      <div className="sec-rule__target">
                        <code>{rule.tool === "any" ? "所有工具" : rule.tool}</code>
                        {rule.pattern && <span className="sec-rule__pattern">{rule.pattern}</span>}
                      </div>
                      <div className="sec-seg" role="group" aria-label={`${rule.tool} 的处理方式`}>
                        {ACTIONS.map((action) => (
                          <button
                            key={action}
                            type="button"
                            className={`sec-seg__btn sec-seg__btn--${action}${rule.action === action ? " is-on" : ""}`}
                            aria-pressed={rule.action === action}
                            disabled={busy}
                            onClick={() => void setAction(index, action)}
                          >
                            {ACTION_LABEL[action]}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="sec-rule__delete"
                        aria-label={`删除规则 ${rule.tool}`}
                        disabled={busy}
                        onClick={() => void removeRule(index)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}

        <div className="sec-add sec-add--rule">
          <select value={newTool} onChange={(e) => setNewTool(e.target.value)} aria-label="规则工具">
            <option value="write">write</option>
            <option value="edit">edit</option>
            <option value="read">read</option>
            <option value="bash">bash</option>
            <option value="mcp">mcp（所有 MCP 工具）</option>
            <option value="any">any（所有工具）</option>
          </select>
          <input
            type="text"
            value={newPattern}
            placeholder="可选：路径 / 命令片段"
            onChange={(e) => setNewPattern(e.target.value)}
          />
          <button type="button" className="sec-btn sec-btn--ink" disabled={busy} onClick={addRule}>
            <Plus size={14} /> 添加规则
          </button>
        </div>
        <p className="sec-footnote">
          规则按顺序匹配；<code>mcp</code> 覆盖所有 <code>mcp__</code> 开头的工具。改动保存到本地设置，无需重启。
        </p>
      </div>
    </SectionShell>
  );
}
