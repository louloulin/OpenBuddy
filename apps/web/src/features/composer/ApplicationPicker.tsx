import { useCallback, useEffect, useState } from "react";
import {
  agentExtensionsPackages,
  agentExtensionsSetPackageResources,
  capabilityPackSetEnabled,
  capabilityPacksList,
} from "@openbuddy/client/agent-client";
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
}: {
  /** Working directory: Pi packages are installed per project or per user. */
  cwd?: string;
  /** Open the resource panel where packages are installed and removed. */
  onManage?: () => void;
}) {
  const [packs, setPacks] = useState<CapabilityPack[]>([]);
  const [packages, setPackages] = useState<ExtensionPackage[]>([]);
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [p, k] = await Promise.all([
      capabilityPacksList().catch(() => [] as CapabilityPack[]),
      agentExtensionsPackages(cwd).catch(() => [] as ExtensionPackage[]),
    ]);
    setPacks(p);
    setPackages(k);
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

  if (!loaded) return <div className="iam-sub-empty">正在读取已安装的应用…</div>;
  if (!packs.length && !packages.length) {
    return (
      <>
        <div className="iam-sub-empty">还没有安装任何应用</div>
        {onManage && <div className="iam-sub-footer" onClick={onManage}>安装应用 →</div>}
      </>
    );
  }

  return (
    <>
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
