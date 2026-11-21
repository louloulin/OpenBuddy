import { useCallback, useEffect, useState } from "react";
import {
  agentExtensionsAdd, agentExtensionsInspect, agentExtensionsList, agentExtensionsRemove,
  agentExtensionsSetEnabled, agentExtensionsSetPathEnabled,
  agentExtensionsPackages, agentExtensionsInstallPackage, agentExtensionsRemovePackage, agentExtensionsUpdatePackages,
  agentExtensionsPreviewPackage, agentExtensionsCheckUpdates,
  agentExtensionsSearchRegistry, agentExtensionsResources, agentExtensionsPackageDetails,
  agentExtensionsSetPackageResources,
  onExtensionProgress,
  type ExtensionReport, type ExtensionsConfig,
} from "@openbuddy/client/agent-client";
import {
  EXTENSION_CATEGORIES,
  EXTENSION_CATEGORY_LABELS,
  type ExtensionCategory,
  type ExtensionPackage,
  type ExtensionPackageDetails,
  type ExtensionPackageFilters,
  type ExtensionPackagePreview,
  type ExtensionPackageUpdate,
  type ExtensionRegistrySearch,
  type ExtensionResourceKind,
  type ExtensionResources,
} from "@openbuddy/protocol/extensions";
import { dialog } from "@openbuddy/client/ipc";
import { PackagePatternEditor } from "./PackagePatternEditor";
import { readTextFile } from "@openbuddy/client/api/files";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { PuzzlePieceIcon, AddCircleIcon, DeleteIcon, FolderOpenIcon } from "@openbuddy/ui/icon/icons/index";

/** 12 345 → 1.2 万, for npm download counts (S15). */
const compact = (value: number) => value >= 10_000 ? `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)} 万` : String(value);

/** npm scores are 0–1; show a readable 0–100 (E1). */
const pct = (value: number) => Math.round(value * 100);

/** Only http(s) links from the registry become clickable. */
const safeLink = (value: string | undefined) => value && /^https?:\/\//i.test(value) ? value : undefined;

/** Per-resource switches a Pi package entry can carry (S17). */
const RESOURCE_KINDS: Array<[ExtensionResourceKind, string]> = [
  ["extensions", "扩展"], ["skills", "技能"], ["prompts", "指令"], ["themes", "主题"],
];

/** What one configured package contributes, from Pi's resolved resource list (S15). */
function packageResources(source: string, resources: ExtensionResources | null) {
  if (!resources) return "";
  const pick = (list: ExtensionResources["extensions"]) => list.filter((entry) => entry.source === source);
  return [
    [pick(resources.extensions).length, "扩展"],
    [pick(resources.skills).length, "技能"],
    [pick(resources.prompts).length, "指令"],
    [pick(resources.themes).length, "主题"],
  ].filter(([count]) => (count as number) > 0).map(([count, label]) => `${count} 个${label as string}`).join(" · ");
}

/**
 * 扩展中心 (pii W2.6 / U7.3): one card per extension — path, per-path switch, the tools / commands /
 * shortcuts it registers, and the error it last failed with. Adding a path first loads it in an
 * isolated loader, so the user sees what it would do *before* it is trusted; a broken extension is
 * refused there and can never fail a session (engine records per-path errors instead of throwing).
 */
export function TrustedExtensionsPanel() {
  const [config, setConfig] = useState<ExtensionsConfig>();
  const [packages, setPackages] = useState<ExtensionPackage[]>([]);
  const [resources, setResources] = useState<ExtensionResources | null>(null);
  const [packagePreview, setPackagePreview] = useState<ExtensionPackagePreview | null>(null);
  const [updates, setUpdates] = useState<ExtensionPackageUpdate[]>([]);
  const [source, setSource] = useState("");
  const [registryQuery, setRegistryQuery] = useState("");
  const [registry, setRegistry] = useState<ExtensionRegistrySearch | null>(null);
  const [registryBusy, setRegistryBusy] = useState(false);
  const [registrySort, setRegistrySort] = useState<"default" | "downloads" | "score">("default");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ExtensionReport | null>(null);
  const [changelog, setChangelog] = useState<{ source: string; text: string } | null>(null);
  const [changelogBusy, setChangelogBusy] = useState(false);
  const [details, setDetails] = useState<ExtensionPackageDetails | null>(null);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [category, setCategory] = useState<ExtensionCategory | "all">("all");
  /** 过滤模式编辑 (E1): which package card shows its Pi glob editor. */
  const [patternOpen, setPatternOpen] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [nextConfig, nextPackages, nextResources] = await Promise.all([
        agentExtensionsList(),
        agentExtensionsPackages().catch(() => []),
        agentExtensionsResources().catch(() => null),
      ]);
      setConfig(nextConfig);
      setPackages(nextPackages);
      setResources(nextResources);
    } catch (error) { setError(friendlyError(error)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // 扩展包安装 / 更新进度 (W2.6 P2).
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void onExtensionProgress((event) => {
      setProgress(`${event.action === "update" ? "更新" : event.action === "remove" ? "移除" : "安装"} ${event.source}${event.message ? ` · ${event.message}` : ""}`);
    }).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten; }).catch(() => {});
    return () => { cancelled = true; dispose?.(); };
  }, []);

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

  const installPackage = async () => {
    const value = source.trim();
    if (!value || busy) return;
    setBusy(true); setError(""); setProgress("");
    try {
      setPackages(await agentExtensionsInstallPackage(value));
      setResources(await agentExtensionsResources().catch(() => null));
      setConfig(await agentExtensionsList());
      setSource("");
      setProgress("安装完成");
    } catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  /** Pi resolves a package's `changelogPath` while loading it (E1); read it on demand, bounded. */
  const changelogPathFor = (source: string) => {
    if (!resources) return undefined;
    const all = [...resources.extensions, ...resources.skills, ...resources.prompts, ...resources.themes];
    return all.find((entry) => entry.source === source && entry.changelogPath)?.changelogPath;
  };
  const openChangelog = async (source: string) => {
    const path = changelogPathFor(source);
    if (!path) return;
    setChangelogBusy(true); setError("");
    try {
      setChangelog({ source, text: await readTextFile(path, 64 * 1024) });
    } catch (error) { setError(friendlyError(error)); }
    finally { setChangelogBusy(false); }
  };
  const updatePackages = async (one?: string) => {
    if (busy) return;
    setBusy(true); setError(""); setProgress("");
    try {
      setPackages(await agentExtensionsUpdatePackages(one));
      setResources(await agentExtensionsResources().catch(() => null));
      setConfig(await agentExtensionsList());
      setProgress("更新完成");
      // E1: after a single-package update, show what the package itself says changed.
      if (one) void openChangelog(one);
    } catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  const removePackage = async (one: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      setPackages(await agentExtensionsRemovePackage(one));
      setResources(await agentExtensionsResources().catch(() => null));
      setConfig(await agentExtensionsList());
    } catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  /** 包资源开关 (S17): Pi's object-form filter — `[]` for off, key removed for on. */
  const setPackageResources = async (one: string, filters: ExtensionPackageFilters) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      setPackages(await agentExtensionsSetPackageResources(one, filters));
      setResources(await agentExtensionsResources().catch(() => null));
      setConfig(await agentExtensionsList());
    } catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  /** 模式编辑 (E1): 保留已有的 glob，再开关该类型。 */
  const toggleResource = (entry: ExtensionPackage, kind: ExtensionResourceKind, enabled: boolean) => {
    const current = entry.filters?.[kind];
    const patterns = Array.isArray(current) ? current : [];
    void setPackageResources(entry.source, { [kind]: enabled ? (patterns.length ? patterns : true) : false });
  };
  const previewPackage = async (value = source.trim()) => {
    if (!value || busy) return;
    setBusy(true); setError(""); setProgress("正在解析包…");
    try {
      setPackagePreview(await agentExtensionsPreviewPackage(value));
      setProgress("");
    } catch (error) { setError(friendlyError(error)); setProgress(""); }
    finally { setBusy(false); }
  };
  const confirmInstallPackage = async () => {
    if (!packagePreview) return;
    const value = packagePreview.source;
    setPackagePreview(null);
    setSource("");
    setBusy(true); setError(""); setProgress("");
    try {
      setPackages(await agentExtensionsInstallPackage(value));
      setResources(await agentExtensionsResources().catch(() => null));
      setConfig(await agentExtensionsList());
      setProgress("安装完成");
    } catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  const searchRegistry = async () => {
    if (registryBusy) return;
    setRegistryBusy(true); setError("");
    try {
      setRegistry(await agentExtensionsSearchRegistry(registryQuery.trim()));
    } catch (error) { setError(friendlyError(error)); }
    finally { setRegistryBusy(false); }
  };
  /** Append the next npm page; rows already shown are dropped by name (S16). */
  const loadMoreRegistry = async () => {
    if (!registry || registryBusy) return;
    setRegistryBusy(true); setError("");
    try {
      const next = await agentExtensionsSearchRegistry(registry.query, registry.packages.length);
      setRegistry((current) => {
        if (!current) return next;
        const seen = new Set(current.packages.map((item) => item.name));
        return { ...next, from: current.from, packages: [...current.packages, ...next.packages.filter((item) => !seen.has(item.name))] };
      });
    } catch (error) { setError(friendlyError(error)); }
    finally { setRegistryBusy(false); }
  };
  const checkUpdates = async () => {
    if (busy) return;
    setBusy(true); setError(""); setProgress("");
    try {
      const found = await agentExtensionsCheckUpdates();
      setUpdates(found);
      setProgress(found.length ? `有 ${found.length} 个扩展包可更新` : "已是最新版本");
    } catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  };

  const items = config?.items ?? [];
  const failed = new Map((config?.errors ?? []).map((entry) => [entry.path, entry.error]));
  const marketPackages = (registry
    ? registrySort === "downloads"
      ? [...registry.packages].sort((a, b) => (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0))
      : registrySort === "score"
        ? [...registry.packages].sort((a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0))
        : registry.packages
    : []).filter((item) => category === "all" || (item.categories?.includes(category) ?? false));
  /** 分类下拉的选项只列真实出现过的分类（来自包的 npm keywords）。 */
  const availableCategories = registry
    ? EXTENSION_CATEGORIES.filter((one) => registry.packages.some((item) => item.categories?.includes(one)))
    : [];

  /** 包详情 (E1)：integrity / 维护者 / 发布时间 / git commit，来自真实 npm packument。 */
  const openDetails = async (name: string) => {
    setDetailsBusy(true);
    setError("");
    try {
      setDetails(await agentExtensionsPackageDetails(name));
    } catch (error) { setError(friendlyError(error)); }
    finally { setDetailsBusy(false); }
  };
  const canLoadMore = !!registry && registry.packages.length < registry.total && registry.packages.length < 1000;

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

    {/* 扩展包 (W2.6 P2 / S14): npm / git sources through Pi's DefaultPackageManager. */}
    <div className="res-panel__card" aria-label="扩展包">
      <h3 className="res-panel__card-title">从 npm / git 安装</h3>
      <p className="res-panel__muted">支持 <code>npm:@scope/pkg</code>、<code>git:https://…</code>、<code>owner/repo</code>。安装与更新使用 Pi 的包管理器，进度会显示在下方。</p>
      <div className="ext-install">
        <input
          className="ext-install__input"
          aria-label="扩展包来源"
          value={source}
          placeholder="npm:pi-extension-example 或 owner/repo"
          spellCheck={false}
          onChange={(event) => setSource(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void installPackage(); }}
        />
        <button type="button" className="res-panel__btn" disabled={busy || !source.trim()} onClick={() => void previewPackage()}>检查</button>
        <button type="button" className="res-panel__btn res-panel__btn--primary" disabled={busy || !source.trim()} onClick={() => void installPackage()}>安装</button>
        <button type="button" className="res-panel__btn" disabled={busy || packages.length === 0} onClick={() => void updatePackages()}>全部更新</button>
        <button type="button" className="res-panel__btn" disabled={busy} onClick={() => void checkUpdates()}>检查更新</button>
      </div>
      {progress && <p className="res-panel__muted" role="status">{progress}</p>}
      {packages.length > 0 && <div className="ext-packages">
        {packages.map((entry) => {
          const summary = packageResources(entry.source, resources);
          const failure = resources?.failures.find((item) => item.source === entry.source);
          const count = (kind: ExtensionResourceKind) => resources?.[kind].filter((item) => item.source === entry.source).length ?? 0;
          return (
            <div key={entry.source} className="ext-package">
              <div className="ext-package__text">
                <code className="ext-package__source" title={entry.installedPath ?? entry.source}>{entry.source}</code>
                <span className="ext-package__meta">{entry.scope === "project" ? "项目" : "用户"}{entry.filtered ? " · 有过滤" : ""}{entry.installedPath ? "" : " · 尚未安装"}{updates.some((update) => update.source === entry.source) ? " · 可更新" : ""}{summary ? ` · ${summary}` : ""}</span>
                {failure && <span className="ext-package__meta ext-package__meta--bad" role="alert">{failure.message}</span>}
                <div className="ext-package__filters" aria-label={`${entry.source} 资源开关`}>
                  {RESOURCE_KINDS.map(([kind, label]) => {
                    const off = entry.filters?.[kind] === false;
                    const total = count(kind);
                    if (!total && !off) return null;
                    return (
                      <label key={kind} className={"ext-package__filter" + (off ? " ext-package__filter--off" : "")} title={off ? `已关闭：${label}` : `已启用：${label}`}>
                        <input type="checkbox" checked={!off} disabled={busy} aria-label={`${entry.source} ${label}`}
                          onChange={(event) => toggleResource(entry, kind, event.target.checked)} />
                        {label}{total ? ` ${total}` : ""}
                      </label>
                    );
                  })}
                  <button type="button" className="res-panel__btn" aria-expanded={patternOpen === entry.source}
                    aria-label={`${entry.source} 过滤模式`} disabled={busy}
                    onClick={() => setPatternOpen(patternOpen === entry.source ? null : entry.source)}>过滤</button>
                </div>
                {patternOpen === entry.source && (
                  <PackagePatternEditor key={`${entry.source}:${JSON.stringify(entry.filters ?? {})}`} entry={entry}
                    onApply={(filters) => void setPackageResources(entry.source, filters)} />
                )}
              </div>
              {changelogPathFor(entry.source) && (
                <button type="button" className="res-panel__btn" disabled={busy || changelogBusy} onClick={() => void openChangelog(entry.source)}>更新日志</button>
              )}
              <button type="button" className="res-panel__btn" disabled={busy} onClick={() => void updatePackages(entry.source)}>更新</button>
              <button type="button" className="res-panel__btn res-panel__btn--danger" disabled={busy} aria-label={`移除扩展包 ${entry.source}`} onClick={() => void removePackage(entry.source)}><DeleteIcon size="sm" /></button>
            </div>
          );
        })}
      </div>}
    </div>

    {/* Pi 包市场 (S15): real npm registry results, installed through Pi's package manager. */}
    <div className="res-panel__card" aria-label="Pi 包市场">
      <h3 className="res-panel__card-title">发现 Pi 扩展包</h3>
      <p className="res-panel__muted">搜索 npm 上带 <code>pi-package</code> 标记的包；点「检查并安装」会先在临时目录解析它的扩展、技能和指令，再由你确认。</p>
      <div className="ext-install">
        <input
          className="ext-install__input"
          aria-label="搜索 Pi 扩展包"
          value={registryQuery}
          placeholder="搜索：网页访问、记忆、MCP…"
          spellCheck={false}
          onChange={(event) => setRegistryQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void searchRegistry(); }}
        />
        <button type="button" className="res-panel__btn res-panel__btn--primary" disabled={registryBusy} onClick={() => void searchRegistry()}>{registryBusy ? "搜索中…" : "搜索"}</button>
      </div>
      {registry && <>
        <div className="ext-market__bar">
          <p className="res-panel__muted">{registry.query ? `“${registry.query}” 找到 ${registry.total} 个包` : `共 ${registry.total} 个 Pi 扩展包`}（npm 实时结果，已加载 {registry.packages.length} 个）</p>
          <label className="res-panel__switch"><span>排序</span>
            <select className="ext-market__sort" aria-label="市场排序" value={registrySort} onChange={(event) => setRegistrySort(event.target.value as "default" | "downloads" | "score")}>
              <option value="default">npm 默认</option>
              <option value="downloads">周下载量</option>
              <option value="score">npm 评分</option>
            </select>
          </label>
          {availableCategories.length > 0 && (
            <label className="res-panel__switch"><span>能力</span>
              <select className="ext-market__sort" aria-label="按能力筛选" value={category} onChange={(event) => setCategory(event.target.value as ExtensionCategory | "all")}>
                <option value="all">全部能力</option>
                {availableCategories.map((one) => (
                  <option key={one} value={one}>{EXTENSION_CATEGORY_LABELS[one]}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {registry.packages.length === 0 && <div className="res-panel__empty"><PuzzlePieceIcon size="xl" className="ec-empty-icon" /><p>没有匹配的扩展包。</p></div>}
        <div className="ext-market">
          {marketPackages.map((item) => (
            <div key={item.name} className="ext-market__item">
              <div className="ext-market__head">
                <code className="ext-market__name">{item.name}</code>
                {item.version && <span className="ext-market__badge">v{item.version}</span>}
                {item.weeklyDownloads !== undefined && <span className="ext-market__badge">{compact(item.weeklyDownloads)} 次/周</span>}
                {item.score && <>
                  <span className="ext-market__badge ext-market__badge--score" title={`npm final ${item.score.final}`}>质量 {pct(item.score.quality)}</span>
                  <span className="ext-market__badge">人气 {pct(item.score.popularity)}</span>
                  <span className="ext-market__badge">维护 {pct(item.score.maintenance)}</span>
                </>}
                {item.publisher && <span className="ext-market__meta">@{item.publisher}</span>}
              </div>
              {item.categories && item.categories.length > 0 && (
                <p className="ext-market__cats">
                  {item.categories.map((one) => (
                    <span key={one} className="ext-market__cat">{EXTENSION_CATEGORY_LABELS[one]}</span>
                  ))}
                </p>
              )}
              {item.description && <p className="ext-market__desc">{item.description}</p>}
              <div className="ext-market__foot">
                <span className="ext-market__meta">
                  {item.license ? `${item.license} · ` : ""}
                  {item.keywords.filter((keyword) => keyword !== "pi-package").slice(0, 4).join(" · ")}
                </span>
                {safeLink(item.repository) && <a className="ext-market__link" href={safeLink(item.repository)} target="_blank" rel="noreferrer">仓库</a>}
                {safeLink(item.npmUrl) && <a className="ext-market__link" href={safeLink(item.npmUrl)} target="_blank" rel="noreferrer">npm</a>}
                <button type="button" className="res-panel__btn" disabled={detailsBusy} onClick={() => void openDetails(item.name)}>详情</button>
                <button type="button" className="res-panel__btn" disabled={busy || registryBusy} onClick={() => { setSource(`npm:${item.name}`); void previewPackage(`npm:${item.name}`); }}>检查并安装</button>
              </div>
            </div>
          ))}
        </div>
        {canLoadMore && <div className="res-panel__toolbar">
          <button type="button" className="res-panel__btn" disabled={registryBusy} onClick={() => void loadMoreRegistry()}>{registryBusy ? "加载中…" : "加载更多"}</button>
        </div>}
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

    {details && <div className="ext-preview" role="dialog" aria-label="包详情">
      <div className="ext-preview__card">
        <h3 className="res-panel__card-title">包详情 · {details.name}</h3>
        <p className="res-panel__muted">来自 npm 官方包文档（packument）的真实信息；这里不提供“官方签名”这类无法验证的说法。</p>
        <dl className="ext-details">
          <div><dt>版本</dt><dd>{details.version || "—"}</dd></div>
          <div><dt>完整性 (integrity)</dt><dd><code className="ext-details__mono">{details.integrity ?? details.shasum ?? "npm 未提供"}</code></dd></div>
          <div><dt>维护者</dt><dd>{details.maintainers.length ? details.maintainers.map((one) => `@${one}`).join("、") : "npm 未提供"}</dd></div>
          <div><dt>发布时间</dt><dd>{details.publishedAt ?? "npm 未提供"}</dd></div>
          <div><dt>git commit</dt><dd><code className="ext-details__mono">{details.gitHead ?? "非 git 包或 npm 未提供"}</code></dd></div>
          <div><dt>许可</dt><dd>{details.license ?? "—"}</dd></div>
          <div><dt>解包大小</dt><dd>{details.unpackedSize !== undefined ? `${(details.unpackedSize / 1024).toFixed(1)} KB` : "—"}</dd></div>
          <div><dt>能力分类</dt><dd>{details.categories.map((one) => EXTENSION_CATEGORY_LABELS[one]).join("、")}</dd></div>
        </dl>
        <div className="ext-preview__actions">
          <button type="button" className="res-panel__btn" onClick={() => setDetails(null)}>关闭</button>
        </div>
      </div>
    </div>}

    {changelog && <div className="ext-preview" role="dialog" aria-label="更新日志">
      <div className="ext-preview__card">
        <h3 className="res-panel__card-title">更新日志 · {changelog.source}</h3>
        <p className="res-panel__muted">来自 Pi 解析到的包内 changelog，本地读取（最多 64 KB），不会上传。</p>
        <pre className="ext-changelog">{changelog.text.trim() || "这个包没有提供更新日志。"}</pre>
        <div className="ext-preview__actions">
          <button type="button" className="res-panel__btn" onClick={() => setChangelog(null)}>关闭</button>
        </div>
      </div>
    </div>}

    {packagePreview && <div className="ext-preview" role="dialog" aria-label="扩展包预览">
      <div className="ext-preview__card">
        <h3 className="res-panel__card-title">安装前确认 · {packagePreview.source}</h3>
        <p className="res-panel__muted">已在临时目录解析这个包，尚未安装。它会注册：</p>
        {packagePreview.failures.map((failure) => <p key={failure.source} className="res-panel__error" role="alert">{failure.source}：{failure.message}</p>)}
        <div className="ext-preview__list">
          {packagePreview.extensions.length === 0 && packagePreview.failures.length === 0 && <p className="res-panel__muted">这个包没有包含加载成功的扩展。</p>}
          {packagePreview.extensions.map((extension) => (
            <div key={extension.path} className="ext-card">
              <code className="ext-card__path" title={extension.path}>{extension.path}</code>
              {extension.error && <p className="ext-card__error" role="alert">{extension.error}</p>}
              {extension.commands.length > 0 && <p className="ext-card__meta"><span>命令</span>{extension.commands.map((name) => <code key={name}>/{name}</code>)}</p>}
              {extension.tools.length > 0 && <p className="ext-card__meta"><span>工具</span>{extension.tools.map((name) => <code key={name}>{name}</code>)}</p>}
              {extension.shortcuts.length > 0 && <p className="ext-card__meta"><span>快捷键</span>{extension.shortcuts.map((name) => <code key={name}>{name}</code>)}</p>}
            </div>
          ))}
          {(packagePreview.skills.length > 0 || packagePreview.prompts.length > 0) && (
            <p className="ext-card__meta"><span>附带资源</span>{packagePreview.skills.length > 0 && <code>{packagePreview.skills.length} 个技能</code>}{packagePreview.prompts.length > 0 && <code>{packagePreview.prompts.length} 个指令</code>}</p>
          )}
        </div>
        <div className="ext-preview__actions">
          <button type="button" className="res-panel__btn" onClick={() => setPackagePreview(null)}>取消</button>
          <button type="button" className="res-panel__btn res-panel__btn--primary" disabled={busy || packagePreview.failures.length > 0} onClick={() => void confirmInstallPackage()}>信任并安装</button>
        </div>
      </div>
    </div>}

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
