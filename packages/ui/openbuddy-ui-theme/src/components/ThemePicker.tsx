/**
 * @openbuddy/ui-theme/ThemePicker — single-button popover for choosing a
 * theme. Inspired by cabinet's picker: groups themes by dark/light, shows
 * an accent swatch and a heading-font preview for each entry, supports
 * "Match system" mode that pairs a different theme per system color scheme.
 *
 * Rendering: portal to document.body so it sits above any z-index on the
 * host page. Position is computed from the trigger's bounding rect on
 * open. Closes on outside click + Escape.
 *
 * Subscriptions: we use a single manual useEffect + useState snapshot
 * instead of multiple useThemeSnapshot calls, because the latter would
 * allocate a fresh selector closure per render and cause useSyncExternalStore
 * to resubscribe — harmless in production but it surfaces as a "Maximum
 * update depth exceeded" warning under React 18 strict-mode (which the
 * test runner enables).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../client";
import { themesByType, type ThemeDefinition, type ThemeName } from "../themes";
import { ThemeCard } from "./ThemeCard";
import { readCustomThemes, getActiveCustomName, type CustomTheme } from "./ThemeStudio";
import styles from "./ThemePicker.module.css";

export interface ThemePickerProps {
  className?: string;
  label?: string;
  compact?: boolean;
  onOpenChange?(open: boolean): void;
}

const ANCHOR_GAP = 8;

interface ThemeSnapshot {
  currentName: ThemeName;
  mode: "manual" | "system";
  pair: { light: ThemeName; dark: ThemeName };
}

function useThemeFields(): ThemeSnapshot {
  const service = useTheme();
  const [snap, setSnap] = useState<ThemeSnapshot>(() => ({
    currentName: service.currentName(),
    mode: service.mode(),
    pair: service.getPair(),
  }));
  useEffect(() => {
    const sync = () => {
      setSnap({
        currentName: service.currentName(),
        mode: service.mode(),
        pair: service.getPair(),
      });
    };
    return service.subscribe(sync);
  }, [service]);
  return snap;
}

function useHydrated(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/**
 * R44 — 读用户在 ThemeStudio 保存的 custom themes,并响应来自同一文档
 * 其它 tab / 其它窗口的 storage 事件。custom theme 在 picker 里跟内置
 * 主题并列展示,点击后走 `applyCustomVars()` 直接写 `--wb-*` 内联值,
 * 不走 `setThemeByName()`(后者对 `ThemeName` literal union 不接受
 * `custom-...` 名字)。
 *
 * 注:active custom theme 由 ThemeStudio 写到 `openbuddy.theme.custom.active`,
 * `getActiveCustomName()` 直接读它。builtin active 由 ThemeStore 维护,
 * `service.currentName()` 读它。两套轨道正交,picker 通过 `activeCustom`
 * + `currentName` 互斥渲染高亮。
 */
function useCustomThemes(): CustomTheme[] {
  const [themes, setThemes] = useState<CustomTheme[]>(() => {
    if (typeof window === "undefined") return [];
    return readCustomThemes();
  });
  useEffect(() => {
    const refresh = () => setThemes(readCustomThemes());
    refresh();
    window.addEventListener("storage", refresh);
    // ThemeStudio 保存后 dispatch 一个自定义事件,同 tab 也能立即刷新。
    window.addEventListener("openbuddy:custom-themes-updated", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("openbuddy:custom-themes-updated", refresh);
    };
  }, []);
  return themes;
}

function useClickOutside(
  enabled: boolean,
  menuRef: React.RefObject<HTMLDivElement | null>,
  buttonRef: React.RefObject<HTMLButtonElement | null>,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (buttonRef.current && buttonRef.current.contains(target)) return;
      onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [enabled, menuRef, buttonRef, onOutside]);
}

export function ThemePicker({
  className,
  label = "Theme",
  compact = true,
  onOpenChange,
}: ThemePickerProps) {
  const hydrated = useHydrated();
  const service = useTheme();
  const { currentName, mode, pair } = useThemeFields();
  const customThemes = useCustomThemes();
  const activeCustom = hydrated ? getActiveCustomName() : null;

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // R61 — theme search. With 19+ themes (plus user-created custom ones)
  // a plain grid is hard to scan. A case-insensitive search input that
  // matches label / name narrows the list without leaving the popover.
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Focus the search input when the popover opens so users can start
  // typing immediately.
  useEffect(() => {
    if (open && searchRef.current) {
      // Small delay so the portal has mounted.
      const id = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);
  // Reset search when the popover closes so the next open shows all.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const handleOpen = useCallback(() => {
    if (open) {
      close();
      return;
    }
    if (buttonRef.current && typeof window !== "undefined") {
      const r = buttonRef.current.getBoundingClientRect();
      setPos({
        top: r.bottom + ANCHOR_GAP,
        right: Math.max(8, window.innerWidth - r.right),
      });
    }
    setOpen(true);
    onOpenChange?.(true);
  }, [open, close, onOpenChange]);

  useClickOutside(open, menuRef, buttonRef, close);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (buttonRef.current && typeof window !== "undefined") {
        const r = buttonRef.current.getBoundingClientRect();
        setPos({
          top: r.bottom + ANCHOR_GAP,
          right: Math.max(8, window.innerWidth - r.right),
        });
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const onSelect = useCallback(
    (name: ThemeName) => {
      service.setThemeByName(name);
      // Selecting a theme is a terminal action — close the popover so the
      // user immediately sees the result. (Keyboard users keep focus on the
      // trigger, so this is also the right UX for them.)
      close();
    },
    [service, close],
  );
  // R44 — 选择 custom theme 走独立路径:`setThemeByName` 对 `ThemeName`
  // literal union 拒绝 `custom-...`,且 custom 主题的 vars 是用户在 Studio
  // 里 OKLCh 调过的 inline 值,需要走 `applyCustomVars()` 直接写到
  // `documentElement.style` + 同步 `data-theme` 兼容属性 + 持久化
  // active custom 名。其它 UI(ThemeCard、SystemPairRow)继续使用合并列表。
  const onSelectCustom = useCallback(
    (theme: CustomTheme) => {
      // 走 ThemeService.applyCustomTheme —— 内部先同步 lastAppliedType,
      // 再写 data-theme + vars,避免 compatObserver 误判为外部修改后
      // 把 store 当前主题(openbuddy-dark)的 vars 覆盖到 custom vars 上。
      service.applyCustomTheme(theme);
      // 通知同 tab 内的其它 picker 实例刷新 active 高亮。
      window.dispatchEvent(
        new CustomEvent("openbuddy:custom-themes-updated"),
      );
      close();
    },
    [service, close],
  );

  const onSetMode = useCallback(
    (next: "manual" | "system") => {
      service.setMode(next);
    },
    [service],
  );

  const dark = useMemo(() => themesByType("dark"), []);
  const light = useMemo(() => themesByType("light"), []);
  // R44 — 把用户在 ThemeStudio 保存的 custom themes 按 type 合进
  // 内置列表后面。ThemeCard 只读 ThemeDefinition 字段(custom 主题
  // 也提供这些字段),`name` 的类型差在运行时不可见(ThemeName 是
  // literal union,custom 主题用 `custom-` 前缀避免冲突)。
  const customAsDef = useCallback(
    (t: CustomTheme): ThemeDefinition =>
      ({
        name: t.name as ThemeName,
        label: t.label,
        type: t.type,
        accent: t.accent,
        vars: t.vars,
        font: t.font,
        headingFont: t.headingFont,
      }) as ThemeDefinition,
    [],
  );
  // R61 — case-insensitive search across label + name. When search is
  // empty we show everything (fast path); otherwise filter each group.
  // Custom themes are searched too, so a user with 10 saved themes can
  // still find "my-dark-blue" by typing "blue".
  const normalizedSearch = search.trim().toLowerCase();
  const matchesSearch = useCallback(
    (t: ThemeDefinition) => {
      if (!normalizedSearch) return true;
      return (
        t.label.toLowerCase().includes(normalizedSearch) ||
        t.name.toLowerCase().includes(normalizedSearch)
      );
    },
    [normalizedSearch],
  );
  const darkAll = useMemo(
    () =>
      [
        ...themesByType("dark"),
        ...customThemes.filter((t) => t.type === "dark").map(customAsDef),
      ].filter(matchesSearch),
    [customThemes, customAsDef, matchesSearch],
  );
  const lightAll = useMemo(
    () =>
      [
        ...themesByType("light"),
        ...customThemes.filter((t) => t.type === "light").map(customAsDef),
      ].filter(matchesSearch),
    [customThemes, customAsDef, matchesSearch],
  );

  // R44 — `usingCustom` 同时覆盖「内置主题里非默认项」与「用户在 Studio
  // 保存的自定义主题」两种情况。Studio 保存后写到 `openbuddy.theme
  // .custom.active`,picker 这里直接读它来显示 active 状态。
  const usingCustom = useMemo(() => {
    if (activeCustom) return true;
    return (
      !!currentName &&
      currentName !== "claude" &&
      currentName !== "white" &&
      currentName !== "black" &&
      currentName !== "paper"
    );
  }, [currentName, activeCustom]);

  const menu = open && hydrated && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          style={{ top: pos.top, right: pos.right }}
        >
          {/* R61 — search input. Hidden on very narrow popovers via CSS. */}
          <div className={styles.searchRow}>
            <svg
              className={styles.searchIcon}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={searchRef}
              className={styles.searchInput}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索主题…"
              aria-label="搜索主题"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              data-testid="theme-search"
            />
            {search && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setSearch("")}
                aria-label="清除搜索"
              >
                ×
              </button>
            )}
          </div>
          <div className={styles.modeRow}>
            <span className={styles.modeLabel}>Match system</span>
            <button
              type="button"
              className={styles.modeBtn + (mode === "manual" ? " " + styles.modeActive : "")}
              onClick={() => onSetMode("manual")}
              aria-pressed={mode === "manual"}
            >
              Off
            </button>
            <button
              type="button"
              className={styles.modeBtn + (mode === "system" ? " " + styles.modeActive : "")}
              onClick={() => onSetMode("system")}
              aria-pressed={mode === "system"}
              title="Match system"
            >
              On
            </button>
          </div>
          {mode === "system" ? (
            <SystemPairRow
              service={service}
              pair={pair}
              currentName={currentName}
              customThemes={customThemes}
              activeCustom={activeCustom}
              onSelectCustom={onSelectCustom}
            />
          ) : null}
          <ThemeGroup
            icon={<MoonGlyph />}
            label="深色"
            items={darkAll}
            currentName={currentName}
            activeCustom={activeCustom}
            onSelect={onSelect}
            onSelectCustom={onSelectCustom}
          />
          <div className={styles.divider} />
          <ThemeGroup
            icon={<SunGlyph />}
            label="浅色"
            items={lightAll}
            currentName={currentName}
            activeCustom={activeCustom}
            onSelect={onSelect}
            onSelectCustom={onSelectCustom}
          />
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={(compact ? styles.triggerCompact : styles.trigger) + (className ? " " + className : "")}
        onClick={handleOpen}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title="切换主题"
      >
        {compact ? (
          usingCustom ? <PaletteIcon /> : <SunMoonIcon />
        ) : (
          <span className={styles.triggerLabel}>
            {usingCustom ? <PaletteIcon /> : <SunMoonIcon />}
            <span className={styles.triggerText}>{currentName}</span>
          </span>
        )}
      </button>
      {menu}
    </>
  );
}

function ThemeGroup({
  icon,
  label,
  items,
  currentName,
  activeCustom,
  onSelect,
  onSelectCustom,
}: {
  icon?: React.ReactNode;
  label: string;
  items: ThemeDefinition[];
  currentName: ThemeName;
  activeCustom: string | null;
  onSelect(name: ThemeName): void;
  onSelectCustom?(theme: CustomTheme): void;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        {icon}
        <span>{label}</span>
      </div>
      <div className={styles.grid}>
        {items.map((t) => {
          // R44 — custom 主题用 activeCustom 单独判定;内置主题仍走
          // currentName(theme-store 的 active)。ThemeCard 的 onSelect
          // 是 `ThemeName => void`,custom 主题的 name 不在 literal
          // union 里,所以走 onSelectCustom(它直接接收 CustomTheme)。
          const isCustom = t.name.startsWith("custom-");
          const active = isCustom
            ? activeCustom === t.name
            : t.name === currentName;
          return (
            <ThemeCard
              key={t.name}
              theme={t}
              active={active}
              onSelect={
                isCustom && onSelectCustom
                  ? () => onSelectCustom(t as unknown as CustomTheme)
                  : onSelect
              }
              variant="chip"
            />
          );
        })}
      </div>
    </div>
  );
}

function SystemPairRow({
  service,
  pair,
  currentName,
  customThemes,
  activeCustom,
  onSelectCustom,
}: {
  service: ReturnType<typeof useTheme>;
  pair: { light: ThemeName; dark: ThemeName };
  currentName: ThemeName;
  customThemes: CustomTheme[];
  activeCustom: string | null;
  onSelectCustom(theme: CustomTheme): void;
}) {
  return (
    <div className={styles.pairRow}>
      <div className={styles.pairGroup}>
        <div className={styles.pairLabel}>浅色</div>
        <select
          className={styles.pairSelect}
          value={pair.light}
          onChange={(e) => {
            const v = e.target.value as ThemeName;
            service.setPair({ light: v });
          }}
        >
          {themesByType("light").map((t) => (
            <option key={t.name} value={t.name}>
              {t.label}
            </option>
          ))}
          {customThemes
            .filter((t) => t.type === "light")
            .map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}（自定义）
              </option>
            ))}
        </select>
      </div>
      <div className={styles.pairGroup}>
        <div className={styles.pairLabel}>深色</div>
        <select
          className={styles.pairSelect}
          value={pair.dark}
          onChange={(e) => {
            const v = e.target.value as ThemeName;
            service.setPair({ dark: v });
          }}
        >
          {themesByType("dark").map((t) => (
            <option key={t.name} value={t.name}>
              {t.label}
            </option>
          ))}
          {customThemes
            .filter((t) => t.type === "dark")
            .map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}（自定义）
              </option>
            ))}
        </select>
      </div>
      <div className={styles.pairHint}>
        当前: {activeCustom ?? currentName}
      </div>
    </div>
  );
}

function SunMoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.673 0-.43-.18-.812-.437-1.106-.25-.286-.43-.622-.43-1.005 0-.83.673-1.5 1.5-1.5H16c3.314 0 6-2.686 6-6 0-4.5-4.5-8-10-8Z" />
    </svg>
  );
}

function SunGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}
