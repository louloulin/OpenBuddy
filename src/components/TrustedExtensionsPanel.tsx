import { useEffect, useState } from "react";
import { agentExtensionsAdd, agentExtensionsList, agentExtensionsRemove, agentExtensionsSetEnabled, type ExtensionsConfig } from "@openbuddy/client/agent-client";
import { dialog } from "@openbuddy/client/ipc";
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
  return <section className="res-panel__body" aria-label="可信扩展设置">
    <div className="res-panel__card">
      <h3 className="res-panel__card-title">可信扩展</h3>
      <p className="res-panel__muted">扩展会在本机执行代码，请只加载你信任的来源。项目内的扩展只在工作空间被信任后才会加载。</p>
      {error && <p className="res-panel__error" role="alert">{error}</p>}
      {!config ? <div className="res-panel__toolbar"><button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void update(agentExtensionsList); }}>重新读取扩展配置</button></div> : <>
        <label className="res-panel__switch"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => { void update(() => agentExtensionsSetEnabled(event.target.checked)); }} />启用可信扩展</label>
        <p className="res-panel__muted">当前工作空间：{config.projectTrusted ? "已信任" : "尚未信任，项目扩展不会自动加载"}</p>
      </>}
    </div>
    {config && <>
      <div className="res-panel__toolbar">
        <button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void add(false); }}>添加扩展文件</button>
        <button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void add(true); }}>添加扩展目录</button>
      </div>
      {config.paths.length === 0 && <div className="res-panel__empty">还没有添加扩展。</div>}
      {config.paths.map(path => <div key={path} className="res-panel__item">
        <code className="res-panel__item-name res-panel__path" title={path}>{path}</code>
        <button type="button" className="res-panel__btn res-panel__btn--danger" disabled={busy} onClick={() => { void update(() => agentExtensionsRemove(path)); }}>移除扩展</button>
      </div>)}
      <p className="res-panel__muted">扩展变更会在任务空闲时自动生效；依赖终端专用界面的扩展暂不支持。</p>
    </>}
  </section>;
}
