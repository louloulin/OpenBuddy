import { TrustedExtensionsPanel } from "./TrustedExtensionsPanel";
import { CapabilityPacksPanel } from "./CapabilityPacksPanel";
import { useCallback, useEffect, useState } from "react";
import { skillsAdd, skillsList, skillsRemove, skillsToggle } from "@openbuddy/client/agent-client";
import { dialog } from "@openbuddy/client/ipc";
import type { SkillInfo } from "@openbuddy/protocol/dto";
import { McpConfigEditor } from "../experts/connectors/McpConfigEditor";
import { McpServersPanel } from "../experts/connectors/McpServersPanel";

/** MVP resources use installed Pi skills and the actual MCP configuration. */
export function AgentResourcesPanel({ cwd, onToast, section, header }: {
  cwd?: string; onToast?: (message: string) => void;
  /** Accepted for API compatibility (MCP sign-in no longer needs a session, W2.4). */
  sessionId?: string;
  /** Show one section without the title and tabs: the management tabs of 专家·技能·连接器 (pii W0.3 / U7.6). */
  section?: "skills" | "mcp" | "extensions";
  /** Rendered in the top bar of an embedded section (the hub's tab pills). */
  header?: React.ReactNode;
}) {
  const [tabState, setTab] = useState<"skills" | "mcp" | "extensions">("skills");
  const tab = section ?? tabState;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { setSkills(await skillsList(cwd)); } catch (e) { setError(String(e)); }
  }, [cwd]);
  useEffect(() => { void load(); }, [load]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); await load(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const add = () => run(async () => {
    const path = await dialog.open({ title: "添加 Pi 技能目录", directory: true });
    if (typeof path === "string") await skillsAdd(path, cwd);
  });
  const tabBtn = (id: typeof tab, label: string) => (
    <button type="button" className={"res-panel__tab" + (tab === id ? " res-panel__tab--on" : "")} onClick={() => setTab(id)} aria-pressed={tab === id}>{label}</button>
  );
  const body = <>
    {error && <p className="res-panel__error" role="alert">{error}</p>}
    {tab === "extensions" ? <div className="res-panel__body"><CapabilityPacksPanel onToast={onToast} /><TrustedExtensionsPanel /></div> : tab === "mcp" ? <div className="res-panel__body">
      <McpServersPanel onToast={onToast} />
      <p className="res-panel__muted">高级模式：直接编辑 mcp.json，保存后会自动重载会话。</p>
      <McpConfigEditor onToast={onToast} />
    </div> : <div className="res-panel__body">
      <div className="res-panel__toolbar">
        <button type="button" className="res-panel__btn res-panel__btn--primary" disabled={busy} onClick={() => { void add(); }}>添加技能</button>
        <button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void load(); }}>刷新</button>
      </div>
      {skills.length === 0 && <div className="res-panel__empty">尚未安装技能。点击「添加技能」，选择包含 SKILL.md 的目录。</div>}
      {skills.map(skill => <div key={skill.path ?? skill.name} className={"res-panel__item" + (skill.enabled ? "" : " res-panel__item--off")}>
        <div className="res-panel__item-main">
          <span className="res-panel__item-name">{skill.displayName || skill.name}</span>
          {skill.description && <span className="res-panel__item-desc">{skill.description}</span>}
        </div>
        <button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void run(() => skillsToggle(skill.name, !skill.enabled)); }}>{skill.enabled ? "禁用" : "启用"}</button>
        <button type="button" className="res-panel__btn res-panel__btn--danger" disabled={busy || !skill.path} onClick={() => { void run(() => skillsRemove(skill.path!, cwd)); }}>移除</button>
      </div>)}
    </div>}
  </>;
  if (section) return <div className="um-page res-panel--embedded">
    <header className="um-topbar"><div className="um-topbar-left">{header}</div></header>
    <div className="um-scroll"><section className="res-panel" aria-label={SECTION_LABEL[section]}>{body}</section></div>
  </div>;
  return <section className="res-panel">
    <header className="res-panel__head">
      <h2 className="res-panel__title">技能与 MCP</h2>
      <p className="res-panel__subtitle">管理已安装的技能、MCP 服务和可信扩展</p>
    </header>
    <nav className="res-panel__tabs" aria-label="资源类型">
      {tabBtn("skills", "已安装技能")}
      {tabBtn("mcp", "MCP 配置")}
      {tabBtn("extensions", "可信扩展")}
    </nav>
    {body}
  </section>;
}
const SECTION_LABEL = { skills: "已安装技能", mcp: "MCP 配置", extensions: "可信扩展" } as const;
