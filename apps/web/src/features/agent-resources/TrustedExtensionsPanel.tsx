import { useCallback, useEffect, useState } from "react";
import {
  agentExtensionsAdd, agentExtensionsInspect, agentExtensionsList, agentExtensionsRemove,
  agentExtensionsSetEnabled, agentExtensionsSetPathEnabled,
  type ExtensionReport, type ExtensionsConfig,
} from "@openbuddy/client/agent-client";
import { dialog } from "@openbuddy/client/ipc";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { PuzzlePieceIcon, AddCircleIcon, DeleteIcon, FolderOpenIcon } from "@openbuddy/ui/icon/icons/index";

/**
 * 扩展中心 (pii W2.6 / U7.3): one card per extension — path, per-path switch, the tools / commands /
 * shortcuts it registers, and the error it last failed with. Adding a path first loads it in an
 * isolated loader, so the user sees what it would do *before* it is trusted; a broken extension is
 * refused there and can never fail a session (engine records per-path errors instead of throwing).
 */
export function TrustedExtensionsPanel() {
  const [config, setConfig] = useState<ExtensionsConfig>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ExtensionReport | null>(null);

  const reload = useCallback(async () => {
    try { setConfig(await agentExtensionsList()); } catch (error) { setError(friendlyError(error)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const update = async (action: () => Promise<ExtensionsConfig>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { setConfig(await action()); } catch (error) { setError(friendlyError(error)); } finally { setBusy(false); }
  };

  const pick = async (directory: boolean) => {
    try {
      const path = await dialog.open({
        directory, multiple: false,
        title: directory ? "选择扩展目录" : "选择扩展文件",
        ...(directory ? {} : { filters: [{ name: "Pi 扩展", extensions: ["ts", "js", "mjs", "cjs"] }] }),
      });
      if (typeof path !== "string") return;
      // Preview first: what would this extension register? Then the user decides to trust it.
      const report = await agentExtensionsInspect(path);
      if (!report.ok) { setError(`这个扩展无法加载：${report.error ?? "未知错误"}`); setPreview(report); return; }
      setPreview(report);
    } catch (error) { setError(friendlyError(error)); }
  };

  const confirmAdd = async () => {
    if (!preview) return;
    const path = preview.path;
    setPreview(null);
    await update(() => agentExtensionsAdd(path));
  };

  const items = config?.items ?? [];
  const failed = new Map((config?.errors ?? []).map((entry) => [entry.path, entry.error]));

  return <section className="res-panel__body" aria-label="扩展中心">
    <div className="res-panel__card">
      <h3 className="res-panel__card-title">扩展中心</h3>
      <p className="res-panel__muted">扩展会在本机执行代码，请只加载你信任的来源。项目内的扩展只在工作空间被信任后才会加载。</p>
      {error && <p className="res-panel__error" role="alert">{error}</p>}
      {!config ? <div className="res-panel__toolbar">
        <button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void reload(); }}>重新读取扩展配置</button>
      </div> : <>
        <label className="res-panel__switch"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => { void update(() => agentExtensionsSetEnabled(event.target.checked)); }} />启用可信扩展</label>
        <p className="res-panel__muted">当前工作空间：{config.projectTrusted ? "已信任" : "尚未信任，项目扩展不会自动加载"}{config.enabled ? "" : "；总开关关闭时不会加载任何扩展"}</p>
      </>}
    </div>

    {config && <>
      <div className="res-panel__toolbar">
        <button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void pick(false); }}>
          <AddCircleIcon size="sm" /><span>添加扩展文件</span>
        </button>
        <button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void pick(true); }}>
          <FolderOpenIcon size="sm" /><span>添加扩展目录</span>
        </button>
      </div>
      {items.length === 0 && <div className="res-panel__empty"><PuzzlePieceIcon size="xl" className="ec-empty-icon" /><p>还没有添加扩展。</p></div>}
      <div className="ext-cards">
        {items.map(item => {
          const runtimeError = failed.get(item.path);
          const problem = item.error ?? runtimeError;
          return <div key={item.path} className={"ext-card" + (problem ? " ext-card--broken" : "")}>
            <div className="ext-card__head">
              <PuzzlePieceIcon size="md" className="ext-card__icon" />
              <div className="ext-card__title">
                <code className="ext-card__path" title={item.path}>{item.path}</code>
                <span className={"ext-card__state " + (problem ? "ext-card__state--bad" : item.enabled === false ? "ext-card__state--off" : "ext-card__state--ok")}>
                  {problem ? "加载失败" : item.enabled === false ? "已停用" : "已启用"}
                </span>
              </div>
              <label className="sk-toggle" title={item.enabled === false ? "已停用" : "已启用"}>
                <input type="checkbox" checked={item.enabled !== false} disabled={busy}
                  onChange={event => { void update(() => agentExtensionsSetPathEnabled(item.path, event.target.checked)); }} />
                <span className="sk-toggle-track"><span className="sk-toggle-thumb" /></span>
              </label>
              <button type="button" className="res-panel__btn res-panel__btn--danger" disabled={busy}
                onClick={() => { void update(() => agentExtensionsRemove(item.path)); }} title="移除扩展"><DeleteIcon size="sm" /></button>
            </div>
            {problem && <p className="ext-card__error" role="alert"><code>{problem}</code></p>}
            {!problem && <>
              {item.commands.length > 0 && <p className="ext-card__meta"><span>命令</span>{item.commands.map(name => <code key={name}>/{name}</code>)}</p>}
              {item.tools.length > 0 && <p className="ext-card__meta"><span>工具</span>{item.tools.map(name => <code key={name}>{name}</code>)}</p>}
              {item.shortcuts.length > 0 && <p className="ext-card__meta"><span>快捷键</span>{item.shortcuts.map(name => <code key={name}>{name}</code>)}</p>}
              {!item.commands.length && !item.tools.length && !item.shortcuts.length && <p className="ext-card__meta ext-card__meta--empty">没有注册命令、工具或快捷键</p>}
            </>}
          </div>;
        })}
      </div>
      <p className="res-panel__muted">扩展变更会在任务空闲时自动生效；依赖终端专用界面的扩展暂不支持。</p>
    </>}

    {preview && <div className="ext-preview" role="dialog" aria-label="扩展预览">
      <div className="ext-preview__card">
        <h3 className="res-panel__card-title">加载前确认</h3>
        <p className="res-panel__muted">这个扩展会在本机执行代码。它将要注册：</p>
        <div className="ext-preview__list">
          {preview.ok ? <>
            {preview.commands.length > 0 && <p className="ext-card__meta"><span>命令</span>{preview.commands.map(name => <code key={name}>/{name}</code>)}</p>}
            {preview.tools.length > 0 && <p className="ext-card__meta"><span>工具</span>{preview.tools.map(name => <code key={name}>{name}</code>)}</p>}
            {preview.shortcuts.length > 0 && <p className="ext-card__meta"><span>快捷键</span>{preview.shortcuts.map(name => <code key={name}>{name}</code>)}</p>}
            {!preview.commands.length && !preview.tools.length && !preview.shortcuts.length && <p className="res-panel__muted">没有注册命令、工具或快捷键。</p>}
          </> : <p className="res-panel__error" role="alert">这个扩展无法加载：{preview.error ?? "未知错误"}</p>}
        </div>
        <div className="ext-preview__actions">
          <button type="button" className="res-panel__btn" onClick={() => setPreview(null)}>取消</button>
          <button type="button" className="res-panel__btn res-panel__btn--primary" disabled={busy || !preview.ok} onClick={() => { void confirmAdd(); }}>信任并添加</button>
        </div>
      </div>
    </div>}
  </section>;
}
