import { useCallback, useEffect, useState } from "react";
import {
  agentExtensionsPackages,
  agentExtensionsSetPackageResources,
  capabilityPackSetEnabled,
  capabilityPacksList,
} from "@openbuddy/client/agent-client";
import { appsList, appsSetEnabled, type AppEntry } from "@openbuddy/client/api/files";
import type { CapabilityPack } from "@openbuddy/protocol/experts";
import type { ExtensionPackage } from "@openbuddy/protocol/extensions";

/**
 * 应用选择器 (G1-16): the `+ → 应用` submenu.
 *
 * 「应用」 here means what is really installed on this machine: the capability packs a
 * WorkBuddy import added (skills / prompts / MCP) and the Pi packages configured through the
 * package manager. Nothing is invented: the list comes from the same host commands the
 * resource panel uses, and the empty state says so.
 *
 * The switches are global (they change what later sessions load), which the footer states.
 */
export function ApplicationPicker({
  cwd,
  onManage,
  onPickPrompt,
}: {
  /** Working directory: Pi packages are installed per project or per user. */
  cwd?: string;
  /** UP-4.1: 应用自带场景 → 把 prompt 填进输入框。 */
  onPickPrompt?: (prompt: string) => void;
  /** Open the resource panel where packages are installed and removed. */
  onManage?: () => void;
}) {
  const [packs, setPacks] = useState<CapabilityPack[]>([]);
  const [packages, setPackages] = useState<ExtensionPackage[]>([]);
  // 应用卡 (UP-2.4)：有 pi.app 的包显示名称/定位/分类，整体启停走 apps_set_enabled。
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [p, k, a] = await Promise.all([
      capabilityPacksList().catch(() => [] as CapabilityPack[]),
      agentExtensionsPackages(cwd).catch(() => [] as ExtensionPackage[]),
      appsList(cwd).catch(() => [] as AppEntry[]),
    ]);
    setPacks(p);
    setPackages(k);
    setApps(a);
    setLoaded(true);
  }, [cwd]);

  useEffect(() => { void load(); }, [load]);

  const togglePack = async (pack: CapabilityPack) => {
    if (busy) return;
    setBusy(pack.id);
    try { setPacks(await capabilityPackSetEnabled(pack.id, !pack.enabled)); }
    catch { /* keep the previous state */ }
    finally { setBusy(""); }
  };

  /** A Pi package loads every resource kind, or none of them (S17 filters). */
  const togglePackage = async (entry: ExtensionPackage) => {
    if (busy) return;
    setBusy(entry.source);
    try {
      const filters = { extensions: false, skills: false, prompts: false, themes: false } as const;
      const next = entry.filtered ? { ...filters, extensions: true, skills: true, prompts: true, themes: true } : filters;
      setPackages(await agentExtensionsSetPackageResources(entry.source, next, cwd));
    } catch { /* keep the previous state */ }
    finally { setBusy(""); }
  };

  /** 应用卡开关：整体启停该 Pi 包的全部资源。 */
  const toggleApp = async (app: AppEntry) => {
    if (busy || !app.packageSource) return;
    setBusy(app.packageSource);
    try {
      // `filtered === true` 表示该包被资源过滤关掉了（见 togglePackage）。
      const on = packages.find((entry) => entry.source === app.packageSource)?.filtered === false;
      await appsSetEnabled(app.packageSource, !on);
      setPackages(await agentExtensionsPackages(cwd));
      setApps(await appsList(cwd).catch(() => apps));
    } catch { /* keep the previous state */ }
    finally { setBusy(""); }
  };

  if (!loaded) return <div className="iam-sub-empty">正在读取已安装的应用…</div>;
  if (!packs.length && !packages.length && !apps.length) {
    return (
      <>
        <div className="iam-sub-empty">还没有安装任何应用</div>
        {onManage && <div className="iam-sub-footer" onClick={onManage}>安装应用 →</div>}
      </>
    );
  }

  return (
    <>
      {apps.some((app) => app.kind !== "extension") && (
        <>
          <div className="iam-sub-heading">应用</div>
          {apps.filter((app) => app.kind !== "extension").map((app) => {
            const entry = packages.find((item) => item.source === app.packageSource);
            const on = entry ? entry.filtered === false : true;
            return (
              <button
                key={`${app.id}@${app.packageSource ?? app.installedPath}`}
                type="button"
                className="iam-sub-item"
                disabled={busy === app.packageSource || !app.packageSource}
                onClick={() => { void toggleApp(app); }}
                aria-pressed={on}
                aria-label={`应用 ${app.name}`}
              >
                <span className="iam-sub-text">
                  <span className="iam-sub-name">{app.name}</span>
                  <span className="iam-sub-desc">
                    {app.tagline ?? (app.kind === "skill-pack" ? "技能包" : app.kind === "connector" ? "连接器" : "应用")}
                    {app.category ? ` · ${app.category}` : ""}
                    {on ? "" : " · 已停用"}
                  </span>
                </span>
                <span className={"iam-switch" + (on ? " iam-switch--on" : "")} aria-hidden="true">
                  <span className="iam-switch__dot" />
                </span>
              </button>
            );
          })}
        </>
      )}
      {onPickPrompt && apps.some((app) => (app.sceneList?.length ?? 0) > 0) && (
        <>
          <div className="iam-sub-heading">应用场景</div>
          <div className="iam-scenes">
            {apps.flatMap((app) =>
              (app.sceneList ?? []).map((scene) => (
                <button
                  key={`${app.id}:${scene.id}`}
                  type="button"
                  className="iam-scene"
                  title={scene.prompt}
                  aria-label={`场景 ${scene.name}`}
                  onClick={() => onPickPrompt(scene.prompt)}
                >
                  <span className="iam-scene__name">{scene.name}</span>
                  <span className="iam-scene__app">{app.name}</span>
                </button>
              )),
            )}
          </div>
        </>
      )}
      {packs.length > 0 && (
        <>
          <div className="iam-sub-heading">能力包</div>
          {packs.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className="iam-sub-item"
              disabled={busy === pack.id}
              onClick={() => { void togglePack(pack); }}
              aria-pressed={pack.enabled}
            >
              <span className="iam-sub-text">
                <span className="iam-sub-name">{pack.name}</span>
                <span className="iam-sub-desc">
                  {pack.contributions.filter((item) => item.enabled).length}/{pack.contributions.length} 项启用
                  {pack.version ? ` · v${pack.version}` : ""}
                </span>
              </span>
              <span className={"iam-switch" + (pack.enabled ? " iam-switch--on" : "")} aria-hidden="true">
                <span className="iam-switch__dot" />
              </span>
            </button>
          ))}
        </>
      )}
      {packages.length > 0 && (
        <>
          <div className="iam-sub-heading">扩展包</div>
          {packages.map((entry) => (
            <button
              key={entry.source}
              type="button"
              className="iam-sub-item"
              disabled={busy === entry.source}
              onClick={() => { void togglePackage(entry); }}
              aria-pressed={!entry.filtered}
            >
              <span className="iam-sub-text">
                <span className="iam-sub-name">{entry.source.replace(/^npm:/, "")}</span>
                <span className="iam-sub-desc">{entry.scope === "user" ? "用户级" : "项目级"}{entry.filtered ? " · 已停用" : ""}</span>
              </span>
              <span className={"iam-switch" + (!entry.filtered ? " iam-switch--on" : "")} aria-hidden="true">
                <span className="iam-switch__dot" />
              </span>
            </button>
          ))}
        </>
      )}
      <div className="iam-sub-hint">开关是全局的：改动会影响之后打开的所有任务</div>
      {onManage && <div className="iam-sub-footer" onClick={onManage}>管理应用 →</div>}
    </>
  );
}
