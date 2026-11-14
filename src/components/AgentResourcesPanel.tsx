import { ensureSession } from "@/lib/ensure-session";
import { TrustedExtensionsPanel } from "./TrustedExtensionsPanel";
import { useCallback, useEffect, useState } from "react";
import { skillsAdd, skillsList, skillsRemove, skillsToggle, mcpAuthStatus, mcpAuthTrigger } from "@openbuddy/client/agent-client";
import { dialog } from "@openbuddy/client/ipc";
import type { SkillInfo, McpAuthStatusEntry } from "@openbuddy/protocol/dto";
import { McpConfigEditor } from "./experts-panel/connectors/McpConfigEditor";

/** MVP resources use installed Pi skills and the actual MCP configuration. */
export function AgentResourcesPanel({ cwd, sessionId, onToast }: { cwd?: string; sessionId?: string; onToast?: (message: string) => void }) {
  const [tab, setTab] = useState<"skills" | "mcp" | "extensions">("skills");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [auth, setAuth] = useState<McpAuthStatusEntry[]>([]);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { setSkills(await skillsList(cwd)); } catch (e) { setError(String(e)); }
  }, [cwd]);
  useEffect(() => { void load(); }, [load]);
  const refreshAuth = useCallback(async () => {
    if (!sessionId) { setAuth([]); return; }
    setAuth(await mcpAuthStatus(sessionId));
  }, [sessionId]);
  useEffect(() => {
    if (tab !== "mcp") return;
    let active = true;
    if (sessionId) void mcpAuthStatus(sessionId).then(entries => { if (active) setAuth(entries); }).catch(error => { if (active) setAuthMessage(`读取授权状态失败：${String(error)}`); });
    else setAuth([]);
    return () => { active = false; };
  }, [tab, sessionId]);
  const authorize = async (serverName: string) => {
    if (!sessionId || authBusy) return;
    setAuthBusy(true); setAuthMessage("");
    try {
      const result = await mcpAuthTrigger(sessionId, serverName);
      if (result.status === "authenticated") await refreshAuth();
      else setAuthMessage(result.status === "cancelled" ? "授权已取消，可重试。" : "授权失败，请检查 MCP OAuth 配置后重试。");
    } catch (error) { setAuthMessage(`授权失败：${String(error)}`); }
    finally { setAuthBusy(false); }
  };
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
    {error && <p className="res-panel__error" role="alert">{error}</p>}
    {tab === "extensions" ? <div className="res-panel__body"><TrustedExtensionsPanel /></div> : tab === "mcp" ? <div className="res-panel__body">
      <section className="res-panel__card" aria-label="MCP 授权">
        <h3 className="res-panel__card-title">远程服务授权</h3>
        {!sessionId && <div className="res-panel__row"><p className="res-panel__muted">授权 MCP 需要先打开一个任务。</p><button type="button" className="res-panel__btn" disabled={authBusy} onClick={() => { setAuthBusy(true); void ensureSession().catch(error => setAuthMessage(String(error))).finally(() => setAuthBusy(false)); }}>使用当前默认模型创建会话</button></div>}
        {sessionId && <button type="button" className="res-panel__btn" disabled={authBusy} onClick={() => { void refreshAuth().catch(error => setAuthMessage(`读取授权状态失败：${String(error)}`)); }}>刷新授权状态</button>}
        {authMessage && <p className="res-panel__error" role="alert">{authMessage}</p>}
        {auth.map(entry => <div key={entry.serverName} className="res-panel__item">
          <span className="res-panel__item-name">{entry.serverName}</span><span className={"res-panel__badge" + (entry.status === "authenticated" ? " res-panel__badge--ok" : "")}>{entry.status === "authenticated" ? "已授权" : "需要授权"}</span>
          <button type="button" className="res-panel__btn" disabled={authBusy} aria-label={`授权 ${entry.serverName}`} onClick={() => { void authorize(entry.serverName); }}>{authBusy ? "授权中…" : entry.status === "authenticated" ? "重新授权" : "授权"}</button>
        </div>)}
      </section>
      <McpConfigEditor onToast={onToast} onSaved={() => { void refreshAuth().catch(error => setAuthMessage(String(error))); }} />
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
  </section>;
}
