import { useEffect, useState } from "react";
import { agentExtensionsAdd, agentExtensionsList, agentExtensionsRemove, agentExtensionsSetEnabled, type ExtensionsConfig } from "@/lib/agent-client";
import { dialog } from "@/lib/ipc";
import { friendlyError } from "@/lib/error-format";

export function TrustedExtensionsPanel() {
  const [config, setConfig] = useState<ExtensionsConfig>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void agentExtensionsList().then(config => { if (active) setConfig(config); }).catch(error => { if (active) setError(friendlyError(error)); });
    return () => { active = false; };
  }, []);
  const update = async (action: () => Promise<ExtensionsConfig>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { setConfig(await action()); } catch (error) { setError(friendlyError(error)); } finally { setBusy(false); }
  };
  const add = async (directory: boolean) => {
    try {
      const path = await dialog.open({ directory, multiple: false, title: directory ? "选择可信扩展目录" : "选择可信扩展文件", ...(directory ? {} : { filters: [{ name: "Pi 扩展", extensions: ["ts", "js", "mjs", "cjs"] }] }) });
      if (typeof path === "string") await update(() => agentExtensionsAdd(path));
    } catch (error) { setError(friendlyError(error)); }
  };
  return <section className="settings-section" aria-label="可信扩展设置">
    <h3>可信 Pi 扩展</h3><p>扩展在本机执行代码，请仅加载信任的来源。项目扩展的发现遵循 Pi 工作区信任状态。</p>
    {error && <p role="alert">{error}</p>}
    {!config ? <button disabled={busy} onClick={() => { void update(agentExtensionsList); }}>重新读取扩展配置</button> : <>
      <label><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => { void update(() => agentExtensionsSetEnabled(event.target.checked)); }} />启用可信扩展</label>
      <p>Pi 当前加载工作区：{config.projectTrusted ? "已信任" : "尚未信任，项目扩展不会自动加载"}</p>
      <button disabled={busy} onClick={() => { void add(false); }}>添加扩展文件</button>
      <button disabled={busy} onClick={() => { void add(true); }}>添加扩展目录</button>
      {config.paths.length === 0 && <p>没有显式添加的扩展路径。</p>}
      <ul>{config.paths.map(path => <li key={path}><code>{path}</code> <button disabled={busy} onClick={() => { void update(() => agentExtensionsRemove(path)); }}>移除扩展</button></li>)}</ul>
      <p>扩展变更会在会话空闲时由 Pi 重新加载。需要终端专用界面的扩展不受桌面输入桥支持。</p>
    </>}
  </section>;
}
