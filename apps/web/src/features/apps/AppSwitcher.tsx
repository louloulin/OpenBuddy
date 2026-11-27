import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blocks, Search } from "lucide-react";
import logoMarkUrl from "@/assets/openbuddy-logo.png";
import { appsIcon, appsList, type AppEntry } from "@openbuddy/client/api/files";
import { useAppsStore } from "./state/apps-store";

/**
 * Buddy 应用切换器 (20261126-upup / WorkBuddy 1:1)。
 *
 * WorkBuddy 顶栏品牌后有一个「当前应用」药丸，点开是应用面板：
 *   搜索 → 最近使用（图标行，当前项带绿点）→ 推荐（图标 + 名称 + 一句话定位）。
 * 数据全部来自真实 `apps_list`（`pi.app`）；第一个应用默认是 upup。
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

  const [apps, setApps] = useState<AppEntry[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    // 测试里 IPC mock 可能同步返回 undefined：统一兜底成数组，避免未处理拒绝。
    let list: AppEntry[] = [];
    try {
      list = (await appsList(cwd)) ?? [];
    } catch {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    setApps(list.filter((app) => app.kind !== "extension"));
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
    if (!open) setQuery("");
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

  // 最近使用：当前应用始终在列（WorkBuddy 的当前应用带绿点），其后是历史使用。
  const recentIds = [current?.id, ...recentAppIds].filter((id): id is string => !!id);
  const recent = [...new Set(recentIds)]
    .map((id) => apps.find((app) => app.id === id))
    .filter((app): app is AppEntry => !!app)
    .filter(match);
  const recommended = apps.filter((app) => !recent.some((r) => r.id === app.id) && match(app));

  const iconFor = (app: AppEntry) =>
    app.source === "builtin"
      ? <img src={logoMarkUrl} alt="" />
      : icons[app.id] ? <img src={icons[app.id]} alt="" /> : <Blocks size={16} aria-hidden />;

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

          {recent.length > 0 && (
            <div className="app-switcher__group">
              <span className="app-switcher__group-title">最近使用</span>
              <div className="app-switcher__recent">
                {recent.map((app) => (
                  <button
                    key={`recent-${app.id}`}
                    type="button"
                    className="app-switcher__recent-item"
                    onClick={() => pick(app)}
                    title={app.tagline}
                  >
                    <span className="app-switcher__recent-icon">
                      {iconFor(app)}
                      {current?.id === app.id && <span className="app-switcher__recent-dot" aria-label="当前" />}
                    </span>
                    <span className="app-switcher__recent-name">{app.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="app-switcher__group">
            <span className="app-switcher__group-title">{recent.length > 0 ? "推荐" : "应用"}</span>
            {recommended.length === 0 ? (
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
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
