import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Plus, RotateCcw, Shield, Trash2 } from "lucide-react";
import {
  permissionList,
  permissionProtectedGet,
  permissionProtectedSet,
  permissionSave,
} from "@openbuddy/client/agent-client";
import type { PermissionRule } from "@openbuddy/protocol/dto";
import { useLocale } from "@/shared/i18n";
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
const CATEGORIES: Array<{ id: CategoryId; labelKey: string; tools: readonly string[] }> = [
  { id: "read", labelKey: "security.category.read", tools: ["read", "grep", "find", "ls"] },
  { id: "write", labelKey: "security.category.write", tools: ["write", "edit"] },
  { id: "delete", labelKey: "security.category.delete", tools: [] },
  { id: "command", labelKey: "security.category.command", tools: ["bash"] },
  { id: "mcp", labelKey: "security.category.mcp", tools: ["mcp"] },
  { id: "other", labelKey: "security.category.other", tools: [] },
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

const ACTION_LABEL_KEY: Record<string, string> = {
  allow: "security.action.allow",
  ask: "security.action.ask",
  deny: "security.action.deny",
};
const ACTIONS = ["allow", "ask", "deny"] as const;

export function SecuritySettingsPanel() {
  const { t } = useLocale();
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTool, setNewTool] = useState("write");
  const [newPattern, setNewPattern] = useState("");
  const [newPath, setNewPath] = useState("");
  // W6.1: 审批卡「查看拦截规则」定位到对应分类（protected → 受保护路径卡片）。
  const [focus, setFocus] = useState<CategoryId | "protected" | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupsRef = useRef(new Map<string, HTMLDivElement>());
  const protectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onFocus = (event: Event) => {
      const category = (event as CustomEvent<{ category?: string }>).detail?.category;
      const allowed = [...CATEGORIES.map((item) => item.id), "protected"];
      if (!category || !allowed.includes(category)) return;
      setFocus(category as CategoryId | "protected");
      if (focusTimer.current) clearTimeout(focusTimer.current);
      focusTimer.current = setTimeout(() => setFocus(null), 2200);
    };
    window.addEventListener("openbuddy:security-focus", onFocus);
    return () => {
      window.removeEventListener("openbuddy:security-focus", onFocus);
      if (focusTimer.current) clearTimeout(focusTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!focus) return;
    const target = focus === "protected" ? protectedRef.current : (groupsRef.current.get(focus) ?? groupsRef.current.get("__rules"));
    target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focus]);

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
      title={t("security.title")}
      desc={t("security.desc")}
    >
      {error && <div className="sec-error">{error}</div>}

      {/* 受保护路径 */}
      <div ref={protectedRef} className={"sec-card" + (focus === "protected" ? " is-focus" : "")}>
        <div className="sec-card__head">
          <div className="sec-card__title">
            <Lock size={15} />
            <span>{t("security.protected.title")}</span>
          </div>
          <div className="sec-card__hint">{t("security.protected.hint")}</div>
        </div>
        <div className="sec-chips">
          {paths.length === 0 ? (
            <span className="sec-muted">{loading ? t("security.loading") : t("security.protected.empty")}</span>
          ) : (
            paths.map((path) => (
              <span className="sec-chip" key={path}>
                <code>{path}</code>
                <button
                  type="button"
                  className="sec-chip__x"
                  aria-label={t("security.protected.remove", { path })}
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
            placeholder={t("security.protected.placeholder")}
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
            <Plus size={14} /> {t("security.protected.add")}
          </button>
          <button
            type="button"
            className="sec-btn"
            disabled={busy || defaults.length === 0}
            onClick={() => void commitPaths(defaults)}
            title={t("security.protected.restoreTitle")}
          >
            <RotateCcw size={14} /> {t("security.protected.restore")}
          </button>
        </div>
        <p className="sec-footnote">
          <code>.env</code> {t("security.protected.note.env")} <code>.env.local</code>{t("security.protected.note.sep")}<code>*.pem</code> {t("security.protected.note.pem")}{t("security.protected.note.sep")}<code>.git</code> {t("security.protected.note.git")}
        </p>
      </div>

      {/* 规则 */}
      <div
        className={"sec-card" + (focus && focus !== "protected" && !(grouped.get(focus)?.length) ? " is-focus" : "")}
        ref={(node) => { if (node) groupsRef.current.set("__rules", node); else groupsRef.current.delete("__rules"); }}
      >
        <div className="sec-card__head">
          <div className="sec-card__title">
            <Shield size={15} />
            <span>{t("security.rules.title")}</span>
          </div>
          <div className="sec-card__hint">{t("security.rules.hint")}</div>
        </div>

        {loading ? (
          <div className="sec-muted">{t("security.loading")}</div>
        ) : rules.length === 0 ? (
          <div className="sec-muted">{t("security.rules.empty")}</div>
        ) : (
          CATEGORIES.map((category) => {
            const items = grouped.get(category.id) ?? [];
            if (items.length === 0) return null;
            return (
              <div
                className={"sec-group" + (focus === category.id ? " is-focus" : "")}
                key={category.id}
                ref={(node) => { if (node) groupsRef.current.set(category.id, node); else groupsRef.current.delete(category.id); }}
              >
                <div className="sec-group__label">
                  {t(category.labelKey)}
                  <span className="sec-group__count">{items.length}</span>
                </div>
                {items.map((rule) => {
                  const index = rules.indexOf(rule);
                  return (
                    <div className="sec-rule" key={`${rule.tool}-${rule.pattern ?? ""}-${index}`}>
                      <div className="sec-rule__target">
                        <code>{rule.tool === "any" ? t("security.rules.anyTool") : rule.tool}</code>
                        {rule.pattern && <span className="sec-rule__pattern">{rule.pattern}</span>}
                      </div>
                      <div className="sec-seg" role="group" aria-label={t("security.rules.actionGroup", { tool: rule.tool })}>
                        {ACTIONS.map((action) => (
                          <button
                            key={action}
                            type="button"
                            className={`sec-seg__btn sec-seg__btn--${action}${rule.action === action ? " is-on" : ""}`}
                            aria-pressed={rule.action === action}
                            disabled={busy}
                            onClick={() => void setAction(index, action)}
                          >
                            {t(ACTION_LABEL_KEY[action])}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="sec-rule__delete"
                        aria-label={t("security.rules.delete", { tool: rule.tool })}
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
          <select value={newTool} onChange={(e) => setNewTool(e.target.value)} aria-label={t("security.rules.toolLabel")}>
            <option value="write">write</option>
            <option value="edit">edit</option>
            <option value="read">read</option>
            <option value="bash">bash</option>
            <option value="mcp">{t("security.rules.optMcp")}</option>
            <option value="any">{t("security.rules.optAny")}</option>
          </select>
          <input
            type="text"
            value={newPattern}
            placeholder={t("security.rules.patternPlaceholder")}
            onChange={(e) => setNewPattern(e.target.value)}
          />
          <button type="button" className="sec-btn sec-btn--ink" disabled={busy} onClick={addRule}>
            <Plus size={14} /> {t("security.rules.add")}
          </button>
        </div>
        <p className="sec-footnote">
          {t("security.rules.note.head")}<code>mcp</code>{t("security.rules.note.mcp")}<code>mcp__</code>{t("security.rules.note.tail")}
        </p>
      </div>
    </SectionShell>
  );
}
