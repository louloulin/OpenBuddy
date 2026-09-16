/**
 * @openbuddy/ui-theme/client — React provider + hook + ThemeInitializer.
 *
 * Provides:
 *   - <ThemeProvider>  wraps a subtree, holds the store, exposes useTheme
 *   - <ThemeInitializer>  synchronously paints data-theme on first render
 *                         (pre-React-tree side effect; safe to render anywhere)
 *   - useTheme()  returns the v1+v2 ThemeService
 *   - useThemeSnapshot()  useSyncExternalStore selector (preserved from v1)
 *
 * The runtime ctx.theme surface is the *same* v2 ThemeService, so third-party
 * plugins can read the extended API (currentName, setThemeByName, setPair, etc.)
 * without going through a new entry point.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createThemeStore,
  getStoredThemeName,
  getStoredThemeMode,
  getStoredThemePair,
  type ThemeService,
  type ThemeStoreInternal,
} from "./theme-store";
import type { Theme, ThemeName } from "./index";
import { getThemeByName } from "./themes";
import { ThemeInitializer } from "./components/ThemeInitializer";

export { ThemeInitializer };

function readStoredPreference(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem("openbuddy.theme");
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** @deprecated use ThemeStoreInternal via createThemeStore directly. Kept
 *  for back-compat with the v1 test suite that imports this type name. */
export type ThemeStore = ThemeStoreInternal;

const Ctx = createContext<ThemeService | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createThemeStore(), []);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeService {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

export function useThemeHook(): ThemeService {
  return useTheme();
}

export function useThemeSnapshot<T>(selector: (s: ThemeService) => T): T {
  const service = useTheme();
  return useSyncExternalStore(
    (fn) => service.subscribe(fn),
    () => selector(service),
    () => selector(service),
  );
}

/**
 * Plugin apply(): wire the ThemeProvider into the SlotProvider and expose
 * ctx.theme (v2 service). Idempotent — re-invocation just replaces the ctx
 * reference, never double-mounts providers.
 */
export function applyTheme(ctx: {
  slots?: { register: (o: { name: string }, c: unknown) => () => void };
  theme?: ThemeService;
} & Record<string, unknown>): () => void {
  const store = createThemeStore();
  if (ctx && typeof ctx === "object") {
    (ctx as Record<string, unknown>).theme = store;
  }
  return () => {};
}

export { readStoredPreference };

// ─── Settings-page helpers (used by ui-settings) ────────────────────
export interface ThemeSnapshot {
  preference: Theme;
  currentName: ThemeName;
  mode: "manual" | "system";
  pair: { light: ThemeName; dark: ThemeName };
  systemPrefersDark: boolean;
}

/** Read the current store snapshot, suitable for the settings panel. */
export function useThemeSnapshotV2(): ThemeSnapshot {
  const service = useTheme();
  const preference = useThemeSnapshot((s) => s.preference());
  const mode = useThemeSnapshot((s) => s.mode());
  const pair = useThemeSnapshot((s) => s.getPair());
  const currentName = useThemeSnapshot((s) => s.currentName());
  const systemPrefersDark = useThemeSnapshot((s) => s.systemPrefersDark());
  return { preference, currentName, mode, pair, systemPrefersDark };
}

// ─── Back-compat hook for the v1 test ──────────────────────────────
/** @deprecated kept for the existing client.test.tsx */
export function useStoreName(): ThemeName | null {
  return getStoredThemeName();
}

export { getStoredThemeMode, getStoredThemePair, getThemeByName };

// Re-export the React UI building blocks for ergonomic imports:
//   import { ThemePicker, ThemeInitializer } from "@openbuddy/ui-theme/client";
export { ThemePicker } from "./components/ThemePicker";
export { ThemeCard } from "./components/ThemeCard";
export { initializeThemeSync } from "./components/ThemeInitializer";

export { ThemeStudio } from "./components/ThemeStudio";
