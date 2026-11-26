import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Plus, RotateCcw, Shield, ShieldAlert, Trash2 } from "lucide-react";
import {
  permissionList,
  permissionProtectedGet,
  permissionProtectedSet,
  permissionSave,
} from "@openbuddy/client/agent-client";
import { skillsList } from "@openbuddy/client/agent-client";
import { appsToolPolicyGet, type ToolPolicy } from "@openbuddy/client/api/files";
import { readTextFile } from "@openbuddy/client/api/files";
import type { PermissionRule, SkillInfo } from "@openbuddy/protocol/dto";
import { useLocale } from "@/shared/i18n";
import { SectionShell } from "./shared";
import { scanSkillContent, skillManifestPath, type SkillScan } from "./skill-security";
import { SecuritySandboxTab } from "./SecuritySandboxTab";
import { SecurityAuditTab } from "./SecurityAuditTab";
import { SecuritySystemTab } from "./SecuritySystemTab";

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

/** 安全中心 2.0 (G2-1)：与 WorkBuddy 一致的五个分区。 */
type TabId = "tools" | "sandbox" | "skills" | "audit" | "system";
const TABS: Array<{ id: TabId; labelKey: string }> = [
  { id: "tools", labelKey: "security.tab.tools" },
  { id: "sandbox", labelKey: "security.tab.sandbox" },
  { id: "skills", labelKey: "security.tab.skills" },
  { id: "audit", labelKey: "security.tab.audit" },
  { id: "system", labelKey: "security.tab.system" },
];

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
  // G2-4 技能安全审查：按需读取已安装技能的 SKILL.md 做静态风险扫描。
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillScans, setSkillScans] = useState<Record<string, SkillScan>>({});
  const [scanningSkill, setScanningSkill] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  // 工具策略 (UP-3.2)：平台红线只读展示；用户/应用声明的 deny 与只读也在这里。
  const [policy, setPolicy] = useState<ToolPolicy | null>(null);
  const [tab, setTab] = useState<TabId>("tools");
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());
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

  useEffect(() => {
    void appsToolPolicyGet().then(setPolicy).catch(() => setPolicy(null));
  }, []);

  useEffect(() => {
    void skillsList()
      .then((list) => setSkills(Array.isArray(list) ? list : []))
      .catch(() => setSkills([]));
  }, []);

  const reviewSkill = useCallback(async (skill: SkillInfo) => {
    if (!skill.path) return;
    setScanningSkill(skill.name);
    setSkillError(null);
    try {
      const content = await readTextFile(skillManifestPath(skill.path), 512 * 1024);
      setSkillScans((prev) => ({ ...prev, [skill.name]: scanSkillContent(content) }));
    } catch (error) {
      setSkillError(t("security.skills.unreadable", { message: String(error).replace(/^Error:\s*/, "") }));
    } finally {
      setScanningSkill(null);
    }
  }, [t]);

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

      {/* 五个分区 (G2-1)：与 WorkBuddy 安全中心一致，键盘左右键切换。 */}
      <div className="sec-tabs" role="tablist" aria-label={t("security.title")}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`security-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`security-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={"sec-tabs__tab" + (tab === item.id ? " is-on" : "")}
            ref={(node) => { if (node) tabRefs.current.set(item.id, node); else tabRefs.current.delete(item.id); }}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              const index = TABS.findIndex((one) => one.id === tab);
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                setTab(next.id);
                tabRefs.current.get(next.id)?.focus();
              }
            }}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div id="security-panel-tools" role="tabpanel" aria-labelledby="security-tab-tools" hidden={tab !== "tools"}>
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
      </div>

      <div id="security-panel-sandbox" role="tabpanel" aria-labelledby="security-tab-sandbox" hidden={tab !== "sandbox"}>
        {tab === "sandbox" && <SecuritySandboxTab />}
      </div>

      <div id="security-panel-skills" role="tabpanel" aria-labelledby="security-tab-skills" hidden={tab !== "skills"}>
      {/* 平台工具策略 (20261126-upup UP-3.2) */}
      {policy && (
        <div className="sec-card" aria-label="平台工具策略">
          <div className="sec-card__head">
            <div className="sec-card__title">
              <ShieldAlert size={15} />
              <span>平台工具策略</span>
            </div>
            <div className="sec-card__hint">真实交易类工具始终被拒绝（规则、模式与「始终允许」都不能放行）。应用可再声明自己的禁用与只读工具。</div>
          </div>
          <div className="sec-list">
            <div className="sec-list__row">
              <span className="sec-list__name">真实交易（始终拒绝）</span>
              <span className="sec-list__meta">place_trade_order / cancel_trade_order（含 upup_ 前缀）</span>
            </div>
            <div className="sec-list__row">
              <span className="sec-list__name">额外禁用</span>
              <span className="sec-list__meta">{policy.denied.length ? policy.denied.join("、") : "无"}</span>
            </div>
            <div className="sec-list__row">
              <span className="sec-list__name">只读（auto 模式免审）</span>
              <span className="sec-list__meta">{policy.readonly.length ? policy.readonly.join("、") : "无"}</span>
            </div>
          </div>
        </div>
      )}

      {/* 技能安全审查 (G2-4) */}
      <div className="sec-card">
        <div className="sec-card__head">
          <div className="sec-card__title">
            <ShieldAlert size={15} />
            <span>{t("security.skills.title")}</span>
          </div>
          <div className="sec-card__hint">{t("security.skills.hint")}</div>
        </div>
        {skillError && <div className="sec-error">{skillError}</div>}
        {skills.length === 0 ? (
          <div className="sec-muted">{t("security.skills.empty")}</div>
        ) : (
          <div className="sec-list">
            {skills.map((skill) => {
              const scan = skillScans[skill.name];
              const level = scan?.level;
              return (
                <div className="sec-list__row" key={skill.name}>
                  <span className="sec-list__name">{skill.displayName || skill.name}</span>
                  <span className="sec-list__meta">{skill.scope ?? "local"}</span>
                  {level && (
                    <span className={"sec-badge sec-badge--" + level}>
                      {t(level === "high" ? "security.skills.level.high" : level === "medium" ? "security.skills.level.medium" : "security.skills.level.low")}
                    </span>
                  )}
                  {scan && scan.findings.length > 0 && (
                    <span className="sec-list__meta">{t("security.skills.findings", { count: scan.findings.length })}</span>
                  )}
                  <button
                    type="button"
                    className="sec-btn"
                    disabled={!skill.path || scanningSkill === skill.name}
                    onClick={() => void reviewSkill(skill)}
                  >
                    {scanningSkill === skill.name ? t("security.skills.scanning") : t("security.skills.scan")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {Object.entries(skillScans).flatMap(([name, scan]) =>
          scan.findings.map((finding) => (
            <p className="sec-footnote" key={`${name}-${finding.line}-${finding.rule}`}>
              <strong>{name}</strong> · {t(`security.skills.rule.${finding.rule}`, { default: finding.rule })} · L{finding.line} · <code>{finding.text}</code>
            </p>
          )),
        )}
      </div>
      </div>

      <div id="security-panel-audit" role="tabpanel" aria-labelledby="security-tab-audit" hidden={tab !== "audit"}>
        {tab === "audit" && <SecurityAuditTab />}
      </div>

      <div id="security-panel-system" role="tabpanel" aria-labelledby="security-tab-system" hidden={tab !== "system"}>
        {tab === "system" && <SecuritySystemTab />}
      </div>
    </SectionShell>
  );
}
