/**
 * @openbuddy/ui-theme/theme-store — extended ThemeService.
 *
 * Adds the v2 surface on top of the v1 store (light/dark + system):
 *   - `currentName(): ThemeName`            the named theme in effect
 *   - `setThemeByName(name)`                switch to a named theme
 *   - `setPair({ light, dark })`            used by Match-system mode
 *   - `setMode("manual" | "system")`        Mode toggle
 *   - `getPair()` / `getMode()`             read pair + mode
 *   - `mode()` / `preference()`             already on v1, normalized
 *   - font loading is now driven by the active theme (loadThemeFonts)
 *
 * v1 API is preserved verbatim so all 26 ui-* packages keep working.
 */

import {
  THEMES,
  DEFAULT_THEME_PAIR,
  extractGoogleFontFamily,
  buildFontStylesheetUrl,
  getThemeByName,
  resolveThemeVars,
  type ThemeDefinition,
  type ThemeName,
  type ThemeType,
} from "./themes";

export type ThemeMode = "manual" | "system";
export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "openbuddy.theme";
const STORAGE_NAME_KEY = "openbuddy.theme.name";
const STORAGE_MODE_KEY = "openbuddy.theme.mode";
const STORAGE_PAIR_LIGHT_KEY = "openbuddy.theme.pair.light";
const STORAGE_PAIR_DARK_KEY = "openbuddy.theme.pair.dark";
const FONT_LINK_ID = "openbuddy-theme-fonts-link";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function isThemeName(v: string | null | undefined): v is ThemeName {
  if (!v) return false;
  return THEMES.some((t) => t.name === v);
}

function isPreference(v: string | null): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

function isMode(v: string | null): v is ThemeMode {
  return v === "manual" || v === "system";
}

function readPreference(): ThemePreference {
  const v = safeGet(STORAGE_KEY);
  return isPreference(v) ? v : "system";
}

function readName(): ThemeName | null {
  const v = safeGet(STORAGE_NAME_KEY);
  return isThemeName(v) ? v : null;
}

function readMode(): ThemeMode {
  const v = safeGet(STORAGE_MODE_KEY);
  return isMode(v) ? v : "manual";
}

function readPair(): { light: ThemeName; dark: ThemeName } {
  const l = safeGet(STORAGE_PAIR_LIGHT_KEY);
  const d = safeGet(STORAGE_PAIR_DARK_KEY);
  return {
    light: isThemeName(l) ? l : DEFAULT_THEME_PAIR.light,
    dark: isThemeName(d) ? d : DEFAULT_THEME_PAIR.dark,
  };
}

export function getStoredThemeName(): ThemeName | null {
  return readName();
}

export function getStoredThemeMode(): ThemeMode {
  return readMode();
}

export function getStoredThemePair(): { light: ThemeName; dark: ThemeName } {
  return readPair();
}

// ─── Font loading ────────────────────────────────────────────────────
function applyFontLink(url: string | null): void {
  if (typeof document === "undefined") return;
  const link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (!url) {
    link?.remove();
    return;
  }
  if (link) {
    if (link.href !== url) link.href = url;
    return;
  }
  const el = document.createElement("link");
  el.id = FONT_LINK_ID;
  el.rel = "stylesheet";
  el.href = url;
  document.head.appendChild(el);
}

export function loadThemeFonts(theme: ThemeDefinition | null): void {
  if (typeof document === "undefined") return;
  const families = theme
    ? Array.from(
        new Set(
          [
            extractGoogleFontFamily(theme.font),
            extractGoogleFontFamily(theme.headingFont),
          ].filter((f): f is string => !!f),
        ),
      )
    : [];
  applyFontLink(buildFontStylesheetUrl(families));
}

// ─── Apply CSS variables + attributes ───────────────────────────────
//
// 必须落下 "base + theme.vars" 的**完整**集合,而不是只落 theme.vars:
// theme.vars 只是 delta,像 `--wb-bg-overlay` / `--wb-shadow*` / `--wb-font`
// 只在 LIGHT_BASE / DARK_BASE 里。只写 delta 会让这些 token 停留在上一个
// 主题的内联值上 —— 浅色画布配深色遮罩、深色画布配浅色阴影,以及最典型的
// win95/winxp 的 `--wb-radius-*: 0` 会一路泄漏到之后的每一套主题(圆角
// 永远变不回来,因为内联值永远压过 index.css 里的 `:root` 兜底)。
function applyThemeAttrs(theme: ThemeDefinition | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!theme) {
    lastAppliedType = null;
    root.removeAttribute("data-theme-name");
    loadThemeFonts(null);
    return;
  }
  lastAppliedType = theme.type;
  root.setAttribute("data-theme", theme.type);
  root.setAttribute("data-theme-name", theme.name);
  // 字体是主题的顶层字段(不是 delta),且需要展开 `var(--wb-font)` 自引用,
  // 因此单独解析后覆盖到颜色 token 之上 —— 这样 19 套主题的字体选择才真的生效。
  const vars = resolveThemeVars(theme.name);
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(vars)) {
    seen.add(k);
    root.style.setProperty(k, v);
  }
  // 上一个主题写过、这一套不再提供的 token 必须显式清掉,否则它们会继续
  // 以"更高优先级的内联值"身份生效(见上面的圆角泄漏)。
  for (const k of lastAppliedKeys) {
    if (!seen.has(k)) root.style.removeProperty(k);
  }
  lastAppliedKeys = [...seen];
  // 字体按主题懒加载:一次只挂当前主题用到的 family,而不是把 19 套主题的
  // 30+ 字体全塞进 <head>(会拖慢首屏 LCP)。
  loadThemeFonts(theme);
}

// ─── Observable store ──────────────────────────────────────────────
export interface ThemeService {
  // v1 (preserved)
  current(): ThemeType;
  preference(): ThemePreference;
  subscribe(fn: () => void): () => void;
  setPreference(theme: ThemePreference): void;
  setTheme(theme: ThemeType): void;
  toggle(): void;
  systemPrefersDark(): boolean;

  // v2 (new)
  currentName(): ThemeName;
  mode(): ThemeMode;
  getPair(): { light: ThemeName; dark: ThemeName };
  setThemeByName(name: ThemeName): void;
  setPair(pair: Partial<{ light: ThemeName; dark: ThemeName }>): void;
  setMode(mode: ThemeMode): void;
  list(): ReadonlyArray<ThemeDefinition>;
}

function pickActiveThemeName(
  preference: ThemePreference,
  systemDark: boolean,
  mode: ThemeMode,
  pair: { light: ThemeName; dark: ThemeName },
  stored: ThemeName | null,
): ThemeName {
  if (mode === "system") {
    return systemDark ? pair.dark : pair.light;
  }
  if (stored) return stored;
  // No stored name and manual mode — fall back to a sensible default per type.
  return preference === "dark" ? pair.dark : pair.light;
}

export interface ThemeStoreInternal extends ThemeService {
  /** For tests only: synchronously read the current resolved theme. */
  __theme(): ThemeDefinition | null;
}

// ─── v1 `data-theme` compatibility bridge ──────────────────────────
//
// The theme store writes its resolved OKLCh palette as *inline* custom
// properties on `documentElement`. Inline values outrank any stylesheet rule,
// including `[data-theme="dark"] { --wb-bg-elevated: … }`. That means flipping
// the legacy `data-theme` attribute on its own (which the v1 contract exposes
// as `Theme = "light" | "dark" | "system"`, and which third-party plugins and
// older call sites still do) left every `--wb-*` token at the *previous*
// theme's value. Flipping to dark that way produced a white composer with
// white text — invisible input.
//
// Rather than dropping the attribute, treat it as a real input: observe
// external writes and re-resolve the theme through the normal path. Our own
// writes are recognised via `lastAppliedType` so the observer never fights
// `applyThemeAttrs`.
type CompatListener = (type: ThemeType) => void;

let lastAppliedType: ThemeType | null = null;
/** Keys written by the previous apply — used to remove stale tokens. */
let lastAppliedKeys: string[] = [];
const compatListeners = new Set<CompatListener>();
let compatObserver: MutationObserver | null = null;

function installCompatObserver(): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  if (compatObserver) return;
  compatObserver = new MutationObserver(() => {
    const raw = document.documentElement.getAttribute("data-theme");
    if (raw !== "dark" && raw !== "light") return; // removal / unknown → ignore
    if (raw === lastAppliedType) return; // our own write
    for (const fn of compatListeners) {
      try {
        fn(raw);
      } catch {
        /* a broken listener must not stop the others */
      }
    }
  });
  compatObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

export function createThemeStore(): ThemeStoreInternal {
  const listeners = new Set<() => void>();
  let pref: ThemePreference = readPreference();
  let name: ThemeName | null = readName();
  let mode: ThemeMode = readMode();
  let pair: { light: ThemeName; dark: ThemeName } = readPair();
  let systemDark = readSystemPrefersDark();

  if (typeof window !== "undefined" && window.matchMedia) {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      systemDark = e.matches;
      // Match-system 模式下 palette 完全由 systemDark 决定,只 notify() 会让
      // currentName() 变了、documentElement 上的 OKLCh 变量还是旧值 ——
      // 组件重渲染读到的是旧配色。所以这里必须真的重新落一遍。
      applyThemeAttrs(activeTheme());
      notify();
    };
    mql.addEventListener("change", onChange);
  }

  function notify() {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* swallow per-listener errors */
      }
    }
  }

  function activeName(): ThemeName {
    return pickActiveThemeName(pref, systemDark, mode, pair, name);
  }

  function activeTheme(): ThemeDefinition | null {
    return getThemeByName(activeName());
  }

  const service: ThemeService = {
    current() {
      const t = activeTheme();
      return (t?.type ?? (systemDark ? "dark" : "light")) as ThemeType;
    },
    preference() {
      return pref;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setPreference(theme) {
      pref = theme;
      safeSet(STORAGE_KEY, theme);
      if (theme === "system") {
        // v1 语义:system = 跟随操作系统,交给系统深/浅色决定。
        mode = "system";
        safeSet(STORAGE_MODE_KEY, "system");
      } else if (activeTheme()?.type !== theme) {
        // v1 契约:`setPreference("light"|"dark")` 必须真的改变配色。v2 的
        // 配色由 mode + name 决定,所以这里要把它们一起写上 —— 否则
        // `preference()` 说 dark、`--wb-*` 还停在浅色,调用方(设置面板的
        // 浅色/深色按钮、宿主 IDE 的 colorScheme 同步)看起来"点了没反应"。
        mode = "manual";
        safeSet(STORAGE_MODE_KEY, "manual");
        if (name !== null) {
          // 只有在"已有一个类型不对的命名主题"时才需要钉一个具体名字。
          // 没存名字时 pref 本身就足以解析出正确的类型,此时保持 name 为
          // null —— 否则这次写入会被误当成"用户做过显式选择",让宿主 IDE
          // 的 colorScheme 同步在之后每次启动都被判定为"要尊重用户选择"
          // 而被挡掉。
          const nextName = theme === "dark" ? pair.dark : pair.light;
          name = nextName;
          safeSet(STORAGE_NAME_KEY, nextName);
        }
      }
      applyThemeAttrs(activeTheme());
      notify();
    },
    setTheme(theme) {
      service.setPreference(theme);
    },
    toggle() {
      service.setPreference(activeTheme()?.type === "dark" ? "light" : "dark");
    },
    systemPrefersDark() {
      return systemDark;
    },
    currentName() {
      return activeName();
    },
    mode() {
      return mode;
    },
    getPair() {
      // 必须返回稳定引用：useSyncExternalStore 用 Object.is 比较快照，
      // 每次返回新对象会触发无限重渲染（React error #185）。
      return pair;
    },
    setThemeByName(next) {
      if (!isThemeName(next)) return;
      name = next;
      safeSet(STORAGE_NAME_KEY, next);
      // Switching to a named theme implicitly forces manual mode.
      mode = "manual";
      safeSet(STORAGE_MODE_KEY, "manual");
      applyThemeAttrs(getThemeByName(next));
      notify();
    },
    setPair(next) {
      let changed = false;
      if (next.light && isThemeName(next.light) && next.light !== pair.light) {
        pair = { ...pair, light: next.light };
        safeSet(STORAGE_PAIR_LIGHT_KEY, next.light);
        changed = true;
      }
      if (next.dark && isThemeName(next.dark) && next.dark !== pair.dark) {
        pair = { ...pair, dark: next.dark };
        safeSet(STORAGE_PAIR_DARK_KEY, next.dark);
        changed = true;
      }
      applyThemeAttrs(activeTheme());
      if (changed) notify();
    },
    setMode(next) {
      if (!isMode(next)) return;
      mode = next;
      safeSet(STORAGE_MODE_KEY, next);
      applyThemeAttrs(activeTheme());
      notify();
    },
    list() {
      return THEMES;
    },
  };

  // Apply on construction so documentElement is correct before first paint.
  //
  // `lastAppliedType` 也要在这里落地:observer 靠它区分"我们自己写的
  // data-theme"和"外部(插件 / IDE 桥接 / 测试)改的 data-theme",不初始化
  // 的话第一次外部翻转会被误判成自写而吞掉。
  lastAppliedType = activeTheme()?.type ?? null;
  applyThemeAttrs(activeTheme());

  // ── v1 `data-theme` 兼容桥 ──────────────────────────────────────
  // 外部直接改 data-theme(旧插件、宿主桥接)时,内联 OKLCh 变量不会跟着变,
  // 于是"属性说 dark、配色还是 light"。这里把它当成一次真正的输入,走正常
  // 解析路径重算,而不是把属性删掉了事 —— 因为 `[data-theme="dark"] .foo`
  // 这类后代选择器在 30 个 ui-* 包里被大量使用,属性本身是有意义的。
  const onCompatFlip: CompatListener = (type) => {
    if (activeTheme()?.type === type) return; // already there
    const nextName = type === "dark" ? pair.dark : pair.light;
    name = nextName;
    safeSet(STORAGE_NAME_KEY, nextName);
    mode = "manual";
    safeSet(STORAGE_MODE_KEY, "manual");
    applyThemeAttrs(getThemeByName(nextName));
    notify();
  };
  compatListeners.add(onCompatFlip);
  installCompatObserver();

  return Object.assign(service, {
    __theme: () => activeTheme(),
  });
}
