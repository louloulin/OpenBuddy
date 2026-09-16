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
function applyThemeAttrs(theme: ThemeDefinition | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!theme) {
    root.removeAttribute("data-theme-name");
    loadThemeFonts(null);
    return;
  }
  root.setAttribute("data-theme", theme.type);
  root.setAttribute("data-theme-name", theme.name);
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
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
  applyThemeAttrs(activeTheme());

  return Object.assign(service, {
    __theme: () => activeTheme(),
  });
}
