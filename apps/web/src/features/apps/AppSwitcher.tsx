import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blocks, ChevronLeft, Search } from "lucide-react";
import logoMarkUrl from "@/assets/openbuddy-logo.png";
import { appsHygiene, appsIcon, appsList, type AppEntry } from "@openbuddy/client/api/files";
import { useAppsStore } from "./state/apps-store";
import { pickRecommended, rankRecent, RECENT_VISIBLE } from "./app-panel";

/**
 * Buddy 应用切换器 (20261126-upup / WorkBuddy 1:1)。
 *
 * WorkBuddy 顶栏品牌后有一个「当前应用」药丸，点开是应用面板：
 *   搜索 → 最近使用（3 列图标格，当前项名称旁 4px 绿点，超过 6 个给「更多」）→
 *   推荐（图标 + 名称 + 一句话定位，悬停出「进入」）。
 * 数据全部来自真实 `apps_list`（`pi.app` + 宿主使用日）；排序/筛选规则见 `app-panel.ts`。
 */
export function AppSwitcher({
  cwd,
  onSelectApp,
  onToast,
}: {
  cwd?: string;
  /** 切换应用后回调（例如回首页刷新标题/场景）。 */
  onSelectApp?: (app: AppEntry) => void;
  onToast?: (message: string) => void;
}) {
  const currentAppId = useAppsStore((s) => s.currentAppId);
  const setCurrentApp = useAppsStore((s) => s.setCurrentApp);
  const recentAppIds = useAppsStore((s) => s.recentAppIds);
  const recentAppAt = useAppsStore((s) => s.recentAppAt);
  const dismissed = useAppsStore((s) => s.dismissedRecommendations);

  const [apps, setApps] = useState<AppEntry[]>([]);
  const [idle, setIdle] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "recent">("main");
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    // 测试里 IPC mock 可能同步返回 undefined：统一兜底成数组，避免未处理拒绝。
    let list: AppEntry[] = [];
    try {
      list = (await appsList(cwd)) ?? [];
    } catch {
      // 读失败保留上一次的列表，推荐区给「刷新失败」重试（WorkBuddy 同款）。
      setStatus("error");
      return;
    }
    if (!Array.isArray(list)) list = [];
    setApps(list.filter((app) => app.kind !== "extension"));
    setStatus("ready");
    try {
      const { idle: idleApps = [] } = (await appsHygiene(cwd)) ?? {};
      setIdle(idleApps.map((app) => app.appId));
    } catch {
      setIdle([]);
    }
    for (const app of list) {
      if (!app.icon || !app.packageSource) continue;
      try {
        const { dataUri } = (await appsIcon(app.packageSource, app.icon)) ?? {};
        if (dataUri) setIcons((prev) => ({ ...prev, [app.id]: dataUri }));
      } catch {
        /* 图标缺失静默降级。 */
      }
    }
  }, [cwd]);

  useEffect(() => {
    void load();
    // 装/卸应用后回到窗口时刷新一次。
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // 点外部关闭。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setView("main");
    }
  }, [open]);

  const current = useMemo(
    () => apps.find((app) => app.id === currentAppId) ?? apps[0] ?? null,
    [apps, currentAppId],
  );

  const pick = (app: AppEntry) => {
    setCurrentApp(app.id);
    setOpen(false);
    onSelectApp?.(app);
    onToast?.(`已切换到 ${app.name}`);
  };

  const q = query.trim().toLowerCase();
  const match = (app: AppEntry) =>
    !q || app.name.toLowerCase().includes(q) || (app.tagline ?? "").toLowerCase().includes(q);

  // 最近使用：按真实使用时间倒序，当前应用不置顶（WorkBuddy 实机当前项可以在第 2 格）。
  const recentAll = rankRecent(apps, { recentAppIds, recentAppAt, currentId: current?.id }).filter(match);
  const recent = recentAll.slice(0, RECENT_VISIBLE);
  // 搜索时推荐区列出全部匹配项（停用/闲置/拒绝过的也能搜到），否则按推荐规则筛。
  const recommended = q
    ? apps.filter((app) => match(app) && !recent.includes(app))
    : pickRecommended(apps, { exclude: recentAll.map((app) => app.id), dismissed, idle });

  const iconFor = (app: AppEntry) =>
    app.source === "builtin"
      ? <img src={logoMarkUrl} alt="" />
      : icons[app.id] ? <img src={icons[app.id]} alt="" /> : <Blocks size={16} aria-hidden />;

  const renderGridItem = (app: AppEntry) => {
    const active = current?.id === app.id;
    return (
      <button
        key={`recent-${app.id}`}
        type="button"
        className={`app-switcher__recent-item${active ? " app-switcher__recent-item--active" : ""}`}
        onClick={() => pick(app)}
        title={app.tagline}
        aria-current={active ? "true" : undefined}
      >
        <span className="app-switcher__recent-icon">{iconFor(app)}</span>
        <span className="app-switcher__recent-label">
          <span className="app-switcher__recent-name">{app.name}</span>
          {active && <span className="app-switcher__recent-dot" aria-label="当前" />}
        </span>
      </button>
    );
  };

  return (
    <div className="app-switcher" ref={wrapRef}>
      <button
        type="button"
        className="app-switcher__pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={current ? `当前应用 ${current.name}` : "选择应用"}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? <span className="app-switcher__icon">{iconFor(current)}</span> : <Blocks size={14} aria-hidden />}
        <span className="app-switcher__name">{current?.name ?? "应用"}</span>
        <span className="app-switcher__dot" aria-hidden />
      </button>

      {open && (
        <div className="app-switcher__panel" role="dialog" aria-label="Buddy 应用">
          <div className="app-switcher__search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Buddy 应用"
              aria-label="搜索应用"
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          {view === "recent" ? (
            <div className="app-switcher__group">
              <div className="app-switcher__group-header">
                <button type="button" className="app-switcher__back" onClick={() => setView("main")}>
                  <ChevronLeft size={14} aria-hidden />
                  返回
                </button>
                <span className="app-switcher__group-title">最近使用</span>
              </div>
              <div className="app-switcher__recent">{recentAll.map(renderGridItem)}</div>
            </div>
          ) : (
            <>
              {recent.length > 0 && (
                <div className="app-switcher__group">
                  <div className="app-switcher__group-header">
                    <span className="app-switcher__group-title">最近使用</span>
                    {recentAll.length > recent.length && (
                      <button type="button" className="app-switcher__more" onClick={() => setView("recent")}>
                        更多
                      </button>
                    )}
                  </div>
                  <div className="app-switcher__recent">{recent.map(renderGridItem)}</div>
                </div>
              )}

              <div className="app-switcher__group">
                <div className="app-switcher__group-header">
                  <span className="app-switcher__group-title">{recent.length > 0 ? "推荐" : "应用"}</span>
                </div>
                {status === "loading" && apps.length === 0 ? (
                  <p className="app-switcher__empty" role="status">加载中…</p>
                ) : status === "error" ? (
                  <button type="button" className="app-switcher__retry" onClick={() => void load()}>
                    刷新失败，点此重试
                  </button>
                ) : recommended.length === 0 ? (
                  <p className="app-switcher__empty">
                    {apps.length === 0
                      ? "还没有安装应用。到「专家 · 技能 · 连接器 → 扩展」安装 UpUp。"
                      : q
                        ? "没有匹配的应用"
                        : "暂无更多推荐应用"}
                  </p>
                ) : (
                  <ul className="app-switcher__list">
                    {recommended.map((app) => (
                      <li key={`rec-${app.id}`}>
                        <button type="button" className="app-switcher__row" onClick={() => pick(app)}>
                          <span className="app-switcher__row-icon">{iconFor(app)}</span>
                          <span className="app-switcher__row-text">
                            <span className="app-switcher__row-name">{app.name}</span>
                            {app.tagline && <span className="app-switcher__row-tag">{app.tagline}</span>}
                          </span>
                          <span className="app-switcher__row-action" aria-hidden>进入</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
