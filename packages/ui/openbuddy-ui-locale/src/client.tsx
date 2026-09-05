/**
 * @openbuddy/ui-locale/client — React provider + dictionary registration.
 *
 * Single-file JSON resources live in src/dictionaries/<locale>.json. The
 * common vocabulary (`LocaleNamespaceMap.common`) is the union of all
 * registered namespaces' keys. Missing keys fall back to the key string.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Locale, LocaleService } from "./index";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./index";
import zhCN from "./dictionaries/zh-CN.json";
import enUS from "./dictionaries/en-US.json";

const LOCALE_STORAGE_KEY = "openbuddy:locale";

type Dictionary = Record<string, unknown>;
type Namespaces = Map<string, Dictionary>;

const builtins: Record<Locale, Dictionary> = {
  "zh-CN": zhCN as Dictionary,
  "en-US": enUS as Dictionary,
};

function isSupported(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function lookupKey(dict: Dictionary, key: string): string | undefined {
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(dict, key)) {
    const v = dict[key];
    return typeof v === "string" ? v : undefined;
  }
  // dotted path
  const parts = key.split(".");
  let cursor: unknown = dict;
  for (const p of parts) {
    if (cursor && typeof cursor === "object" && p in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] != null ? String(params[name]) : `{${name}}`
  );
}

function createLocaleStore(): LocaleService & { subscribe: (fn: () => void) => () => void } {
  const listeners = new Set<() => void>();
  const namespaces: Namespaces = new Map();
  let current: Locale = (() => {
    if (typeof window === "undefined") return DEFAULT_LOCALE;
    try {
      const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      return isSupported(v) ? v : DEFAULT_LOCALE;
    } catch {
      return DEFAULT_LOCALE;
    }
  })();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const resolve = (locale: Locale, namespace: string | undefined, key: string, params?: Record<string, unknown>): string => {
    const dict = builtins[locale];
    const direct = lookupKey(dict, key);
    if (direct !== undefined) return interpolate(direct, params);
    if (namespace) {
      const ns = namespaces.get(namespace);
      if (ns) {
        const fromNs = lookupKey(ns, key);
        if (fromNs !== undefined) return interpolate(fromNs, params);
      }
    }
    // Try the other locale as fallback.
    const fallback: Locale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const fromFallback = lookupKey(builtins[fallback], key);
    if (fromFallback !== undefined) return interpolate(fromFallback, params);
    return key;
  };

  const service: LocaleService = {
    current: () => current,
    set: (locale) => {
      current = locale;
      if (typeof window !== "undefined") {
        try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* ignore */ }
      }
      notify();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    t: (key, params) => resolve(current, undefined, key, params),
    bind: (namespace) => (key, params) => resolve(current, namespace, key, params),
  };

  // Public registration API: each ui-* package can ship its own dict.
  (service as LocaleService & { register: (ns: string, dict: Dictionary) => () => void }).register = (ns, dict) => {
    namespaces.set(ns, dict);
    notify();
    return () => {
      namespaces.delete(ns);
      notify();
    };
  };

  return service as LocaleService & { subscribe: (fn: () => void) => () => void };
}

const Ctx = createContext<LocaleService | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const store = useMemo(() => {
    const s = createLocaleStore();
    if (initial) s.set(initial);
    return s;
  }, [initial]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleService {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLocale must be used inside <I18nProvider>");
  return ctx;
}

/** Convenience hook: returns a translate function bound to the active locale. */
export function useT(key: string, params?: Record<string, unknown>): string {
  const locale = useLocale();
  const [value, setValue] = useState(() => locale.t(key, params));
  useEffect(() => {
    setValue(locale.t(key, params));
    return locale.subscribe(() => setValue(locale.t(key, params)));
  }, [locale, key, JSON.stringify(params)]);
  return value;
}

/** Plugin apply(): expose ctx.locale service. */
export function applyLocale(ctx: Record<string, unknown>): () => void {
  const store = createLocaleStore();
  ctx.locale = store;
  return () => {};
}
