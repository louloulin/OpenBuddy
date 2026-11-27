import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, Blocks, Download, History, RefreshCw } from "lucide-react";
import {
  appsEnsureDefault,
  appsHygiene,
  appsHygieneKeep,
  appsIcon,
  appsInstallState,
  appsList,
  appsRollback,
  appsSetEnabled,
  appsUpdate,
  type AppEntry,
  type AppInstallHistory,
  type IdleApp,
} from "@openbuddy/client/api/files";
import { ContextHygieneCard } from "./ContextHygieneCard";
import {
  agentExtensionsCheckUpdates,
  agentExtensionsList,
  agentExtensionsPackages,
  agentExtensionsPreviewPackage,
  agentExtensionsSetEnabled,
} from "@openbuddy/client/agent-client";
import { describeAppInstallError } from "@openbuddy/protocol/apps";
import type { ExtensionPackage } from "@openbuddy/protocol/extensions";

/** UpUp 官方安装源（与 `pi install <url>` 等价；Pi 包管理器直接接受 https 仓库地址）。 */
export const UPUP_GIT_SOURCE = "https://gitcode.com/lumosaigroup/upup.git";

/** 安装源去 ref：`https://host/repo.git@sha` / `#ref` 视为同一个应用。 */
const sourceKey = (source: string) => source.replace(/#.*$/, "").replace(/@[^/@]+$/, "");

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
  // UpUp Git 安装：先预演（工具/技能数），确认后再装。
  const [gitPreview, setGitPreview] = useState<{ tools: number; skills: number } | null>(null);
  const [gitBusy, setGitBusy] = useState("");
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);
  // U1：全局扩展开关是「装了但没工具」的最常见原因；U2：有更新的包。
  const [extensionsEnabled, setExtensionsEnabled] = useState<boolean | null>(null);
  const [projectTrusted, setProjectTrusted] = useState(true);
  const [updates, setUpdates] = useState<Record<string, true>>({});
  const [checking, setChecking] = useState(false);
  // U6：{source → {current, previous}}，卡片据此显示版本与「回滚」入口。
  const [installs, setInstalls] = useState<Record<string, AppInstallHistory>>({});
  // U5 / UP-6.4：≥14 天未用的已启用应用。
  const [idle, setIdle] = useState<IdleApp[]>([]);

  const load = useCallback(async () => {
    const [list, pkgs, config, history, hygiene] = await Promise.all([
      appsList(cwd).catch(() => [] as AppEntry[]),
      agentExtensionsPackages(cwd).catch(() => [] as ExtensionPackage[]),
      agentExtensionsList(cwd).catch(() => null),
      appsInstallState().catch(() => ({} as Record<string, AppInstallHistory>)),
      appsHygiene(cwd).catch(() => ({ idle: [] as IdleApp[] })),
    ]);
    setApps(list);
    setIdle(hygiene.idle);
    setPackages(pkgs);
    setInstalls(history);
    if (config) {
      setExtensionsEnabled(config.enabled);
      setProjectTrusted(config.projectTrusted);
    }
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
    const key = sourceKey(app.packageSource);
    const entry = packages.find((item) => sourceKey(item.source) === key);
    return entry ? entry.filtered === false : true;
  };

  const toggle = async (app: AppEntry) => {
    if (!app.packageSource || busy) return;
    setBusy(app.packageSource);
    try {
      await appsSetEnabled(app.packageSource, !isOn(app));
      await load();
    } catch (error) {
      onToast?.(describeAppInstallError(error));
    } finally {
      setBusy("");
    }
  };

  /** U1：安装后没开全局开关，应用工具不会加载；这里给一个明确的修复入口。 */
  const enableExtensions = async () => {
    try {
      await agentExtensionsSetEnabled(true);
      await load();
      onToast?.("扩展已启用；新建会话即可使用应用工具");
    } catch (error) {
      onToast?.(describeAppInstallError(error));
    }
  };

  /** U2：检查 Pi 包更新；只标出仍安装着的包。 */
  const checkUpdates = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const list = await agentExtensionsCheckUpdates(cwd);
      const next: Record<string, true> = {};
      for (const item of list) next[item.source] = true;
      setUpdates(next);
      onToast?.(list.length ? `发现 ${list.length} 个可更新应用` : "所有应用都是最新版本");
    } catch (error) {
      onToast?.(describeAppInstallError(error));
    } finally {
      setChecking(false);
    }
  };

  /**
   * U2/U6：更新一个包并刷新列表。
   * 走宿主 `apps_update` 而不是直接调扩展接口，这样才会记录上一版本，回滚才有目标。
   */
  const updateApp = async (app: AppEntry) => {
    if (!app.packageSource || busy) return;
    const source = sourceKey(app.packageSource);
    setBusy(app.packageSource);
    try {
      await appsUpdate(source);
      setUpdates((prev) => {
        const next = { ...prev };
        delete next[source];
        return next;
      });
      await load();
      onToast?.(`${app.name} 已更新`);
    } catch (error) {
      onToast?.(describeAppInstallError(error));
    } finally {
      setBusy("");
    }
  };

  /** U6：按记录的上一份 {source,commit} 重装（Git 源固定到旧 commit）。 */
  const rollbackApp = async (app: AppEntry) => {
    if (!app.packageSource || busy) return;
    setBusy(app.packageSource);
    try {
      await appsRollback(sourceKey(app.packageSource));
      await load();
      onToast?.(`${app.name} 已回滚到上一版本`);
    } catch (error) {
      onToast?.(describeAppInstallError(error));
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

  /** 从 Git 预演 UpUp（不落盘），拿到将安装的工具/技能数。 */
  const previewUpup = async () => {
    if (gitBusy) return;
    setGitBusy("preview");
    try {
      const preview = await agentExtensionsPreviewPackage(UPUP_GIT_SOURCE);
      const tools = preview.extensions.reduce((sum, entry) => sum + entry.tools.length, 0);
      setGitPreview({ tools, skills: preview.skills?.length ?? 0 });
    } catch (error) {
      onToast?.(`检查失败：${describeAppInstallError(error)}`);
    } finally {
      setGitBusy("");
    }
  };

  /** 确认安装 UpUp（宿主 `apps_ensure_default`：安装 + 启用 + 记录版本，等价 `pi install <url>`）。 */
  const installUpup = async () => {
    if (gitBusy) return;
    setGitBusy("install");
    try {
      const result = await appsEnsureDefault(UPUP_GIT_SOURCE);
      if (!result.installed) throw new Error(result.error ?? "install_failed");
      await load();
      setGitPreview(null);
      onToast?.("UpUp 已安装并启用；新建会话即可使用");
    } catch (error) {
      onToast?.(describeAppInstallError(error));
    } finally {
      setGitBusy("");
    }
  };

  const real = apps.filter((app) => app.kind !== "extension");
  const extensions = apps.filter((app) => app.kind === "extension");
  // 是否已装 UpUp（按包 id/source 判断；Git 源同样会出现在 apps_list 里）。
  const hasUpup = apps.some(
    (app) => app.source === "pi" && (/^upup$/i.test(app.id) || /upup/i.test(app.packageSource ?? "")),
  );

  return (
    <div className="apps-page">
      <header className="apps-page__head">
        <div>
          <h1 className="apps-page__title">应用</h1>
          <p className="apps-page__sub">已安装的应用与扩展。应用带场景与工具策略；扩展包只提供工具/技能。</p>
        </div>
        <button type="button" className="apps-page__refresh" onClick={() => void checkUpdates()} disabled={checking} aria-label="检查更新">
          <ArrowUpCircle size={15} />
        </button>
        <button type="button" className="apps-page__refresh" onClick={() => void load()} aria-label="刷新应用列表">
          <RefreshCw size={15} />
        </button>
      </header>

      {/* U1：装了应用但全局扩展开关关着 —— 工具不会加载，给出明确修复入口。 */}
      {loaded && extensionsEnabled === false && real.length > 0 && (
        <div className="apps-bundled" role="region" aria-label="扩展未启用">
          <span className="apps-bundled__icon" aria-hidden><ArrowUpCircle size={18} /></span>
          <div className="apps-bundled__text">
            <strong className="apps-bundled__title">扩展未启用</strong>
            <span className="apps-bundled__desc">应用已安装，但扩展总开关关闭，新会话不会加载它们的工具与技能。</span>
          </div>
          <button type="button" className="apps-bundled__action" onClick={() => void enableExtensions()}>
            启用扩展
          </button>
        </div>
      )}
      {loaded && !projectTrusted && real.length > 0 && (
        <p className="apps-page__sub">当前空间尚未信任：第一次在新任务里使用应用时，按提示授权后工具才会加载。</p>
      )}

      {/* UpUp 官方安装源（Git）：未安装时给「检查 → 安装」入口，等价 pi install。 */}
      {loaded && !hasUpup && (
        <div className="apps-bundled" role="region" aria-label="安装 UpUp">
          <span className="apps-bundled__icon" aria-hidden><Download size={18} /></span>
          <div className="apps-bundled__text">
            <strong className="apps-bundled__title">安装 UpUp</strong>
            <span className="apps-bundled__desc">
              从 <code>{UPUP_GIT_SOURCE}</code> 安装（与 <code>pi install</code> 相同）。装完后它有卡片、场景与工具策略。
            </span>
          </div>
          {gitPreview ? (
            <button type="button" className="apps-bundled__action" disabled={gitBusy === "install"} onClick={() => void installUpup()}>
              {gitBusy === "install" ? "安装中…" : `确认安装（${gitPreview.tools} 个工具）`}
            </button>
          ) : (
            <button type="button" className="apps-bundled__action" disabled={gitBusy === "preview"} onClick={() => void previewUpup()}>
              {gitBusy === "preview" ? "检查中…" : "检查并安装"}
            </button>
          )}
        </div>
      )}

      {loaded && (
        <ContextHygieneCard
          idle={idle}
          onDisable={async (app) => {
            try {
              await appsSetEnabled(app.packageSource, false);
              await load();
              onToast?.(`${app.name} 已停用；需要时在卡片上重新打开`);
            } catch (error) {
              onToast?.(describeAppInstallError(error));
            }
          }}
          onKeep={async (app) => {
            await appsHygieneKeep(app.packageSource).catch(() => undefined);
            setIdle((prev) => prev.filter((item) => item.packageSource !== app.packageSource));
          }}
        />
      )}

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
          {real.length > 0 && (
            <>
              <h2 className="apps-page__section">应用</h2>
              <div className="apps-grid">
                {real.map((app) => {
                  const on = isOn(app);
                  const icon = icons[app.packageSource ?? ""];
                  const builtin = app.source === "builtin";
                  const history = app.packageSource ? installs[sourceKey(app.packageSource)] : undefined;
                  const version = history?.current.version ?? history?.current.commit?.slice(0, 7);
                  const canRollback = !!history?.previous;
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
                      {version && (
                        <span className="app-card__version">
                          当前版本 {version}
                        </span>
                      )}
                      {app.packageSource && updates[sourceKey(app.packageSource)] && (
                        <button
                          type="button"
                          className="app-card__scene"
                          aria-label={`更新 ${app.name}`}
                          disabled={busy === app.packageSource}
                          onClick={() => void updateApp(app)}
                        >
                          可更新 · 更新
                        </button>
                      )}
                      {canRollback && app.packageSource && (
                        <button
                          type="button"
                          className="app-card__scene app-card__scene--muted"
                          aria-label={`回滚 ${app.name}`}
                          disabled={busy === app.packageSource}
                          onClick={() => void rollbackApp(app)}
                        >
                          <History size={12} aria-hidden /> 回滚到上一版本
                        </button>
                      )}
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
