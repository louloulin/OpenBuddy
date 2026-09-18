/**
 * @openbuddy/ui-theme/ThemeInitializer — paints the document with the right
 * theme synchronously during the first React render, so users never see a
 * white flash before the React tree mounts.
 *
 * The component renders nothing. It is intended to be placed as the first
 * child of <SlotProvider>; it reads localStorage, resolves the active
 * theme, and writes the CSS variables + data attributes immediately. The
 * ThemeProvider (which mounts later) takes over for subsequent changes.
 *
 * Why a component and not a top-of-file script?
 *   - Cabinet shipped a `next-themes` <ThemeProvider> that injects an inline
 *     <script> tag for FOUC prevention. React 19 + Next 16 logged that as a
 *     console error on every render. By contrast, our ThemeInitializer runs
 *     a single useLayoutEffect on first mount — no script injection.
 *   - The renderer is in Electron, so first paint is the main-process
 *     window show. Running the side effect during the renderer's React
 *     bootstrap is fast enough; the host page hasn't been shown yet.
 *
 * Note: We do NOT call `createThemeStore()` here, because the ThemeProvider
 * (a parent component) already does that, and creating a second store
 * would register duplicate matchMedia listeners and double-apply the
 * theme. We only re-apply the document attributes here in case the
 * ThemeProvider's initial store created a different theme than what the
 * standalone `initializeThemeSync` set on the documentElement.
 */
import { useLayoutEffect } from "react";
import {
  getStoredThemeName,
  getStoredThemeMode,
  getStoredThemePair,
} from "../theme-store";
import { resolveThemeVars, getThemeByName } from "../themes";

export interface ThemeInitializerProps {
  /** Custom storage keys — defaults match the v2 store. Mostly useful for tests. */
  storageKey?: string;
  /** When true, do not write to localStorage on init. Tests use this. */
  readOnly?: boolean;
  /**
   * Synchronous mode: resolve on every render (default true, runs in
   * useLayoutEffect so it lands before paint). If false, defers to a
   * microtask.
   */
  sync?: boolean;
}

function pickActiveName(
  pref: "light" | "dark" | "system",
  systemDark: boolean,
  mode: "manual" | "system",
  pair: { light: string; dark: string },
  stored: string | null,
): string {
  if (mode === "system") {
    return systemDark ? pair.dark : pair.light;
  }
  if (stored) return stored;
  return pref === "dark" ? pair.dark : pair.light;
}

function isThemeName(v: string | null): v is import("../themes").ThemeName {
  if (!v) return false;
  return !!getThemeByName(v);
}

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readPref(): "light" | "dark" | "system" {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem("openbuddy.theme");
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

function paintDocument(): void {
  if (typeof document === "undefined") return;
  const pref = readPref();
  const stored = getStoredThemeName();
  const mode = getStoredThemeMode();
  const pair = getStoredThemePair();
  const systemDark = readSystemPrefersDark();
  const activeName = pickActiveName(
    pref,
    systemDark,
    mode,
    pair as { light: string; dark: string },
    stored,
  );
  if (!isThemeName(activeName)) return;
  const theme = getThemeByName(activeName);
  if (!theme) return;
  // 与 store 用同一个组合入口 —— 首屏就带上主题字体,避免挂载后字体跳一次。
  const vars = resolveThemeVars(activeName);
  const root = document.documentElement;
  // Only paint if the document doesn't already have the right state, to
  // avoid clobbering changes made by the live store between initializeThemeSync
  // and the React mount.
  if (root.getAttribute("data-theme-name") === activeName) return;
  root.setAttribute("data-theme", theme.type);
  root.setAttribute("data-theme-name", theme.name);
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
}

export function ThemeInitializer(_props: ThemeInitializerProps = {}): null {
  useLayoutEffect(() => {
    paintDocument();
  }, []);
  return null;
}

/**
 * Standalone sync initializer that runs without React. Useful at the very
 * top of the renderer entry (before <SlotProvider /> mounts) to paint the
 * theme as early as possible. Calling it more than once is safe — it is
 * idempotent.
 */
export function initializeThemeSync(): void {
  paintDocument();
}
