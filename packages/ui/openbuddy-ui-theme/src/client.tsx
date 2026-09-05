/**
 * @openbuddy/ui-theme/client — React provider + hook.
 *
 * Mounts ThemeProvider at the SlotProvider root. Subscribes to the system
 * color-scheme media query, persists the preference to localStorage, and
 * writes `data-theme` on documentElement. The ThemeService context value
 * is the only object components ever see — never read localStorage or
 * `data-theme` directly.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Theme, ThemeService } from "./index";

const STORAGE_KEY = "openbuddy.theme";

function readStored(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function writeStored(theme: Theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode / quota); ignore */
  }
}

function systemPrefersDarkNow(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/** Internal observable store; do not export. */
function createThemeStore(): ThemeService & { subscribe: (fn: () => void) => () => void } {
  const listeners = new Set<() => void>();
  let pref: Theme = readStored();
  let systemDark = systemPrefersDarkNow();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  if (typeof window !== "undefined") {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    mql?.addEventListener("change", (e) => {
      systemDark = e.matches;
      notify();
    });
  }

  const applyDocumentTheme = (theme: Exclude<Theme, "system">) => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
  };

  const service: ThemeService = {
    current() {
      return pref === "system" ? (systemDark ? "dark" : "light") : pref;
    },
    preference() {
      return pref;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setTheme(theme) { service.setPreference(theme); },
    setPreference(theme) {
      pref = theme;
      writeStored(theme);
      applyDocumentTheme(service.current());
      notify();
    },
    toggle() {
      service.setPreference(service.current() === "dark" ? "light" : "dark");
    },
    systemPrefersDark() {
      return systemDark;
    },
  };

  // Apply once on construction so documentElement is correct before first paint.
  applyDocumentTheme(service.current());

  return service as ThemeService & { subscribe: (fn: () => void) => () => void };
}

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

/** Standard-kit hook binding (SlotMap merge): returns the same service. */
export function useThemeHook(): ThemeService {
  return useTheme();
}

/** useSyncExternalStore adapter; reserved for store consumers. */
export function useThemeSnapshot<T>(selector: (s: ThemeService) => T): T {
  const service = useTheme();
  return useSyncExternalStore(
    (fn) => service.subscribe(fn),
    () => selector(service),
    () => selector(service)
  );
}

/** Plugin apply(): wire the ThemeProvider into the SlotProvider and expose ctx.theme. */
export function applyTheme(ctx: { slots?: { register: (o: { name: string }, c: unknown) => () => void } } & Record<string, unknown>): () => void {
  const disposers: Array<() => void> = [];
  const store = createThemeStore();
  // ctx.theme service (declared via @openbuddy/cordis Context augmentation).
  if (ctx && typeof ctx === "object") {
    (ctx as Record<string, unknown>).theme = store;
  }
  return () => {
    for (const d of disposers) d();
  };
}
