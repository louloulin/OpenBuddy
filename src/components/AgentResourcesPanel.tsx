import { useCallback, useEffect, useState } from "react";
import { skillsAdd, skillsList, skillsRemove, skillsToggle } from "@/lib/agent-client";
import { dialog } from "@/lib/ipc";
import type { SkillInfo } from "@/lib/types";
import { McpConfigEditor } from "./experts-panel/connectors/McpConfigEditor";

/** MVP resources use installed Pi skills and the actual MCP configuration. */
export function AgentResourcesPanel({ cwd, onToast }: { cwd?: string; onToast?: (message: string) => void }) {
  const [tab, setTab] = useState<"skills" | "mcp">("skills");
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
  return <section className="placeholder-page placeholder-page--panel">
    <header className="settings-section-head"><h2>技能与 MCP</h2></header>
    <nav aria-label="资源类型">
      <button onClick={() => setTab("skills")} aria-pressed={tab === "skills"}>已安装技能</button>
      <button onClick={() => setTab("mcp")} aria-pressed={tab === "mcp"}>MCP 配置</button>
    </nav>
    {error && <p role="alert">{error}</p>}
    {tab === "mcp" ? <McpConfigEditor onBack={() => setTab("skills")} onToast={onToast} /> : <div>
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
