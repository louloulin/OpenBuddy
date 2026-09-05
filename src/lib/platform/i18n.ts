/**
 * Lightweight i18n helper for OpenBuddy renderer.
 *
 * Goals:
 *  - Default locale is `zh-CN` (matches current renderer copy).
 *  - Single-file JSON resources in `src/locales/{zh-CN,en-US}.json`.
 *  - No runtime framework (no react-i18next / lingui) — keep bundle small.
 *  - Locale persists via `localStorage` key `openbuddy:locale`.
 *  - Public API:
 *      - `t(key)` for non-React callers
 *      - `useLocale()` React hook returning `{ locale, setLocale, t }`
 *      - `useT(key)` shortcut for a single translation with reactivity
 *      - `I18nProvider` to mount at app root (optional, but recommended)
 *
 * Source of truth lives in `src/locales/<locale>.json`. Missing keys fall
 * back to the key string (so missing-translation bugs surface immediately).
 *
 * New keys must be added to BOTH `zh-CN.json` and `en-US.json`.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import zhCN from "../../locales/zh-CN.json";
import enUS from "../../locales/en-US.json";

export type Locale = "zh-CN" | "en-US";
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en-US"] as const;

const LOCALE_STORAGE_KEY = "openbuddy:locale";

const resources: Record<Locale, Record<string, unknown>> = {
  "zh-CN": zhCN as Record<string, unknown>,
  "en-US": enUS as Record<string, unknown>,
};

function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function writeStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* storage may be unavailable (private mode, quota); ignore */
  }
}

/**
 * Look up a dotted key path (e.g. `permission.modes.default`) inside the
 * locale resource. Missing intermediate nodes fall back to the key string.
 */
function lookup(locale: Locale, key: string): string {
  const segments = key.split(".");
  let node: unknown = resources[locale];
  for (const segment of segments) {
    if (node && typeof node === "object" && segment in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

// Module-level mutable locale; updated by `setLocale` and listened to via
// a tiny event bus so `useLocale()` / `useT()` can re-render.
let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

function emit(locale: Locale): void {
  for (const listener of listeners) listener(locale);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (currentLocale === locale) return;
  currentLocale = locale;
  writeStoredLocale(locale);
  emit(locale);
}

export function t(key: string, locale: Locale = currentLocale): string {
  return lookup(locale, key);
}

export function useLocale(): { locale: Locale; setLocale: (next: Locale) => void; t: (key: string) => string } {
  const [locale, setLocaleState] = useState<Locale>(() => {
    currentLocale = readStoredLocale();
    return currentLocale;
  });

  useEffect(() => {
    const listener = (next: Locale) => setLocaleState(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const handleSet = useCallback((next: Locale) => {
    setLocale(next);
  }, []);

  const translate = useCallback((key: string) => t(key, locale), [locale]);

  return { locale, setLocale: handleSet, t: translate };
}

export function useT(key: string): string {
  const { t } = useLocale();
  return t(key);
}

/**
 * Optional provider that initializes the module-level locale from
 * localStorage on first mount and persists future changes. Render it once
 * near the React root; if absent, `t()` still works (using the module
 * default).
 */
export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  useEffect(() => {
    currentLocale = readStoredLocale();
    emit(currentLocale);
  }, []);
  return children;
}
