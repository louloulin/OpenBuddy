import { ensureSession } from "@/lib/ensure-session";
import { TrustedExtensionsPanel } from "./TrustedExtensionsPanel";
import { useCallback, useEffect, useState } from "react";
import { skillsAdd, skillsList, skillsRemove, skillsToggle, mcpAuthStatus, mcpAuthTrigger } from "@/lib/agent-client";
import { dialog } from "@/lib/ipc";
import type { SkillInfo, McpAuthStatusEntry } from "@/lib/types";
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
  return <section className="placeholder-page placeholder-page--panel">
    <header className="settings-section-head"><h2>技能与 MCP</h2></header>
    <nav aria-label="资源类型">
      <button onClick={() => setTab("skills")} aria-pressed={tab === "skills"}>已安装技能</button>
      <button onClick={() => setTab("mcp")} aria-pressed={tab === "mcp"}>MCP 配置</button>
      <button onClick={() => setTab("extensions")} aria-pressed={tab === "extensions"}>可信扩展</button>
    </nav>
    {error && <p role="alert">{error}</p>}
    {tab === "extensions" ? <TrustedExtensionsPanel /> : tab === "mcp" ? <div>
      <section aria-label="MCP 授权">
        <h3>远程服务授权</h3>
        {!sessionId && <div><p>授权 MCP 需要已加载的 Pi 会话。</p><button disabled={authBusy} onClick={() => { setAuthBusy(true); void ensureSession().catch(error => setAuthMessage(String(error))).finally(() => setAuthBusy(false)); }}>使用当前默认模型创建会话</button></div>}
        {sessionId && <button disabled={authBusy} onClick={() => { void refreshAuth().catch(error => setAuthMessage(`读取授权状态失败：${String(error)}`)); }}>刷新授权状态</button>}
        {authMessage && <p role="alert">{authMessage}</p>}
        {auth.map(entry => <div key={entry.serverName} className="settings-row">
          <span>{entry.serverName}</span><span>{entry.status === "authenticated" ? "已授权" : "需要授权"}</span>
          <button disabled={authBusy} aria-label={`授权 ${entry.serverName}`} onClick={() => { void authorize(entry.serverName); }}>{authBusy ? "授权中…" : entry.status === "authenticated" ? "重新授权" : "授权"}</button>
        </div>)}
      </section>
      <McpConfigEditor onBack={() => setTab("skills")} onToast={onToast} onSaved={() => { void refreshAuth().catch(error => setAuthMessage(String(error))); }} />
    </div> : <div>
      <button disabled={busy} onClick={() => { void add(); }}>添加技能</button>
      <button disabled={busy} onClick={() => { void load(); }}>刷新</button>
      {skills.length === 0 && <p>尚未安装技能。选择包含 SKILL.md 的目录以添加。</p>}
      {skills.map(skill => <div key={skill.path ?? skill.name} className="settings-row">
        <span>{skill.displayName || skill.name}</span><span>{skill.description}</span>
        <button disabled={busy} onClick={() => { void run(() => skillsToggle(skill.name, !skill.enabled)); }}>{skill.enabled ? "禁用" : "启用"}</button>
        <button disabled={busy || !skill.path} onClick={() => { void run(() => skillsRemove(skill.path!, cwd)); }}>移除</button>
      </div>)}
    </div>}
  </section>;
}
