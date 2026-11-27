import { useCallback, useEffect, useState } from "react";
import { Blocks, Download, RefreshCw } from "lucide-react";
import {
  appsBundledSource,
  appsIcon,
  appsInstallBundled,
  appsList,
  appsSetEnabled,
  type AppEntry,
  type BundledAppSource,
} from "@openbuddy/client/api/files";
import { agentExtensionsPackages } from "@openbuddy/client/agent-client";
import type { ExtensionPackage } from "@openbuddy/protocol/extensions";

/**
 * 应用页 (20261126-upup UP-2.4 / WorkBuddy 对齐)。
 *
 * WorkBuddy 的「Buddy 应用」是一个独立的网格面板：图标 + 名称 + 一句话定位 + 分类，
 * 点卡片进入应用，卡片上带场景入口。这里按同样的信息层级做，数据全部来自真实
 * `apps_list`（`pi.app`），扩展包单独一栏，不混进应用。
 */
export function AppsPanel({
  cwd,
  onPickPrompt,
  onToast,
}: {
  cwd?: string;
  /** 场景 prompt 交给上层（首页输入框），本页不直接依赖会话 store。 */
  onPickPrompt?: (prompt: string) => void;
  onToast?: (message: string) => void;
}) {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [packages, setPackages] = useState<ExtensionPackage[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [bundled, setBundled] = useState<BundledAppSource | null>(null);
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [list, pkgs, bundledSource] = await Promise.all([
      appsList(cwd).catch(() => [] as AppEntry[]),
      agentExtensionsPackages(cwd).catch(() => [] as ExtensionPackage[]),
      appsBundledSource().catch(() => null),
    ]);
    setApps(list);
    setPackages(pkgs);
    setBundled(bundledSource);
    setLoaded(true);
    for (const app of list) {
      if (!app.icon || !app.packageSource) continue;
      void appsIcon(app.packageSource, app.icon).then(({ dataUri }) => {
        if (dataUri) setIcons((prev) => ({ ...prev, [app.packageSource!]: dataUri }));
      }).catch(() => {});
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOn = (app: AppEntry) => {
    if (!app.packageSource) return true;
    const entry = packages.find((item) => item.source === app.packageSource);
    return entry ? entry.filtered === false : true;
  };

  const toggle = async (app: AppEntry) => {
    if (!app.packageSource || busy) return;
    setBusy(app.packageSource);
    try {
      await appsSetEnabled(app.packageSource, !isOn(app));
      await load();
    } catch (error) {
      onToast?.(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setBusy("");
    }
  };

  /** 场景 → 首页输入框（不直接发送，与选择器里的行为一致）。 */
  const pickScene = (prompt: string) => {
    if (!onPickPrompt) return;
    onPickPrompt(prompt);
    onToast?.("场景已填入首页输入框");
  };

  /** 安装随附（打包进安装包）的应用，例如 UpUp。 */
  const installBundled = async () => {
    if (busy) return;
    setBusy("__bundled__");
    try {
      await appsInstallBundled();
      await load();
      onToast?.("内置应用已安装");
    } catch (error) {
      onToast?.(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setBusy("");
    }
  };

  const real = apps.filter((app) => app.kind !== "extension");
  const extensions = apps.filter((app) => app.kind === "extension");
  const showBundled = !!bundled?.exists && !bundled.installed;

  return (
    <div className="apps-page">
      <header className="apps-page__head">
        <div>
          <h1 className="apps-page__title">应用</h1>
          <p className="apps-page__sub">已安装的应用与扩展。应用带场景与工具策略；扩展包只提供工具/技能。</p>
        </div>
        <button type="button" className="apps-page__refresh" onClick={() => void load()} aria-label="刷新应用列表">
          <RefreshCw size={15} />
        </button>
      </header>

      {!loaded ? (
        <div className="apps-page__empty">正在读取已安装的应用…</div>
      ) : real.length === 0 && extensions.length === 0 ? (
        <div className="apps-page__empty">
          <Blocks size={28} aria-hidden />
          <p>还没有安装任何应用</p>
          <span>到「专家 · 技能 · 连接器 → 扩展」里用本地目录、npm 或 git 安装。</span>
        </div>
      ) : (
        <>
          {/* 随安装包分发的应用（UpUp）：未安装时给一键安装入口。 */}
          {showBundled && (
            <div className="apps-bundled" role="region" aria-label="内置应用">
              <span className="apps-bundled__icon" aria-hidden><Blocks size={18} /></span>
              <div className="apps-bundled__text">
                <strong className="apps-bundled__title">
                  {bundled?.name ?? "内置应用"}{bundled?.version ? ` ${bundled.version}` : ""}
                </strong>
                <span className="apps-bundled__desc">随 OpenBuddy 安装包一起分发，点击即可安装并启用（无需联网）。</span>
              </div>
              <button type="button" className="apps-bundled__action" disabled={busy === "__bundled__"} onClick={() => void installBundled()}>
                <Download size={14} aria-hidden />
                {busy === "__bundled__" ? "安装中…" : "安装内置应用"}
              </button>
            </div>
          )}

          {real.length > 0 && (
            <>
              <h2 className="apps-page__section">应用</h2>
              <div className="apps-grid">
                {real.map((app) => {
                  const on = isOn(app);
                  const icon = icons[app.packageSource ?? ""];
                  const builtin = app.source === "builtin";
                  return (
                    <article key={`${app.id}@${app.packageSource ?? app.installedPath ?? app.source}`} className={"app-card" + (on ? "" : " app-card--off")}>
                      <div className="app-card__head">
                        <span className="app-card__icon" aria-hidden>
                          {icon ? <img src={icon} alt="" /> : <Blocks size={18} />}
                        </span>
                        <div className="app-card__names">
                          <span className="app-card__name">{app.name}</span>
                          <span className="app-card__meta">
                            {app.tagline ?? (app.kind === "skill-pack" ? "技能包" : app.kind === "connector" ? "连接器" : "应用")}
                          </span>
                        </div>
                        {builtin ? (
                          <span className="app-card__builtin">内置</span>
                        ) : (
                          <button
                            type="button"
                            className={"app-card__switch" + (on ? " app-card__switch--on" : "")}
                            role="switch"
                            aria-checked={on}
                            aria-label={`${app.name} ${on ? "已启用" : "已停用"}`}
                            disabled={busy === app.packageSource || !app.packageSource}
                            onClick={() => void toggle(app)}
                          >
                            <span className="app-card__switch-dot" />
                          </button>
                        )}
                      </div>
                      {app.category && <span className="app-card__category">{app.category}</span>}
                      {(app.sceneList?.length ?? 0) > 0 && (
                        <div className="app-card__scenes">
                          {app.sceneList!.map((scene) => (
                            <button
                              key={scene.id}
                              type="button"
                              className="app-card__scene"
                              title={scene.prompt}
                              aria-label={`场景 ${scene.name}`}
                              onClick={() => pickScene(scene.prompt)}
                            >
                              {scene.name}
                              <span aria-hidden>↗</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {app.toolPolicy?.deny?.length ? (
                        <p className="app-card__policy">已拒绝 {app.toolPolicy.deny.join("、")}</p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {extensions.length > 0 && (
            <>
              <h2 className="apps-page__section">扩展包</h2>
              <ul className="apps-page__list">
                {extensions.map((app) => (
                  <li key={app.id + (app.packageSource ?? "")}>{app.name}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
