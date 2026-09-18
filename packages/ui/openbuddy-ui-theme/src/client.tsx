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
  useLayoutEffect,
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

// ─── 单一 store ──────────────────────────────────────────────────────────
//
// 与 ui-locale 同样的问题与同样的修法:React 树的 ThemeProvider 与插件上下文
// `ctx.theme` 曾经各建一个 store —— 插件里 setThemeByName("sakura") 界面纹丝
// 不动,而界面切主题插件也读不到。现在两处共用这一个实例。
let singleton: ThemeStoreInternal | null = null;

/** 取进程内唯一的主题 store(没有就创建)。 */
export function getOrCreateThemeService(): ThemeStoreInternal {
  if (!singleton) singleton = createThemeStore();
  return singleton;
}

/** 测试用:丢弃单例(下一次调用会新建,并重新读 localStorage)。 */
export function __resetThemeService(): void {
  singleton = null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => getOrCreateThemeService(), []);
  // 单例 store 只在"构造那一瞬间"apply 过 DOM。若 documentElement 之后被外部
  // 重置(HMR / 单测 afterEach / 同文档第二份应用),属性缺失会让整棵 UI 掉回
  // 无主题状态,而 store 内部状态却是对的 —— 所以挂载时必须重新落一遍。
  // 用 layout effect 是为了在浏览器绘制前生效,避免闪一下无主题的界面。
  useLayoutEffect(() => {
    store.syncDocument();
  }, [store]);
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
 * ctx.theme (v2 service).
 *
 * 必须走 `getOrCreateThemeService()` 而不是再 `createThemeStore()`:再建一个
 * store 会让 `ctx.theme` 与 React 树的 `<ThemeProvider>` 变成两个独立实例,
 * 插件里 `ctx.theme.setThemeByName("sakura")` 界面纹丝不动,界面上换主题插件
 * 也读不到 —— 微内核服务名存实亡。单例之后两处是同一个 store,而且
 * `matchMedia` / MutationObserver 只会装一次。
 *
 * 幂等:重复调用只是把同一个引用重新赋给 ctx.theme。
 */
export function applyTheme(ctx: {
  slots?: { register: (o: { name: string }, c: unknown) => () => void };
  theme?: ThemeService;
} & Record<string, unknown>): () => void {
  const store = getOrCreateThemeService();
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

export {
  getStoredThemeName,
  getStoredThemeMode,
  getStoredThemePair,
  getThemeByName,
};

// Re-export the React UI building blocks for ergonomic imports:
//   import { ThemePicker, ThemeInitializer } from "@openbuddy/ui-theme/client";
export { ThemePicker } from "./components/ThemePicker";
export { ThemeCard } from "./components/ThemeCard";
export { initializeThemeSync } from "./components/ThemeInitializer";

export { ThemeStudio } from "./components/ThemeStudio";
