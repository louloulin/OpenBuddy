/**
 * @openbuddy/ui-locale/client — 微内核 i18n 服务 + React 绑定。
 *
 * ## 单一 store(修复点)
 *
 * 整个渲染进程只有一个 locale store(module-level singleton)。此前 `I18nProvider`
 * 与 `applyLocale(ctx)` 各建一个 store:插件里 `ctx.locale.set("en-US")` 完全不会
 * 影响 React 树,而 React 树切语言插件也读不到 —— "微内核服务"名存实亡。
 * 现在 `getOrCreateLocaleService()` 是唯一入口,provider / hook / 插件上下文
 * 拿到的都是同一个实例。
 *
 * ## 词表分层(解析顺序)
 *
 *   1. 子表      `register(locale, ns, dict)` —— 每个包 / 插件自己的词表,
 *                只有 `bind(ns)` 能读到,作用域隔离;
 *   2. 全局合并层 `merge(locale, dict)` —— 宿主把产品文案搬进来,`t()` 直接可见;
 *   3. 包内置    `dictionaries/<locale>.json` —— 通用词汇(保存 / 取消 …);
 *   4. 另一种语言(同 1–3 的顺序)—— 缺翻译时至少能看到另一种语言的文案;
 *   5. key 本身 —— 缺 key 会立刻暴露,而不是渲染成空白。
 *
 * 缺 key 返回 key 字符串是有意的:静默回退成空串会把翻译缺失藏起来。
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
import type { Locale, LocaleDictionary, LocaleService } from "./index";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./index";
import zhCN from "./dictionaries/zh-CN.json";
import enUS from "./dictionaries/en-US.json";

export const LOCALE_STORAGE_KEY = "openbuddy:locale";

export type { Locale, LocaleService, LocaleDictionary } from "./index";
export { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./index";

type Dictionary = LocaleDictionary;

const builtins: Record<Locale, Dictionary> = {
  "zh-CN": zhCN as Dictionary,
  "en-US": enUS as Dictionary,
};

function isSupported(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function lookupKey(dict: Dictionary | undefined, key: string): string | undefined {
  if (!dict || !key) return undefined;
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
    params[name] != null ? String(params[name]) : `{${name}}`,
  );
}

/**
 * 深度合并词表:`source` 覆盖 `target` 的同名叶子,子树递归合并。
 *
 * 为什么不用浅合并:产品文案与包内置词表都有 `common` / `settings` 这样的
 * 顶层命名空间,浅合并会让"产品只补了 3 个 key"整体替换掉内置的一整棵子树。
 */
function deepMerge(target: Dictionary, source: Dictionary): Dictionary {
  const out: Dictionary = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const prev = out[key];
    if (
      prev &&
      typeof prev === "object" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(prev) &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(prev as Dictionary, value as Dictionary);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface LocaleStore extends LocaleService {
  /** 子表是否已注册(调试 / 不变式用)。 */
  hasNamespace(locale: Locale, namespace: string): boolean;
  /** 测试用:清空合并层与子表,回到出厂状态。 */
  __reset(): void;
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupported(v) ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function createLocaleStore(): LocaleStore {
  const listeners = new Set<() => void>();
  const namespaces = new Map<string, Dictionary>();
  const merged: Record<Locale, Dictionary> = { "zh-CN": {}, "en-US": {} };
  let current: Locale = readStoredLocale();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const lookup = (locale: Locale, namespace: string | undefined, key: string): string | undefined => {
    if (namespace) {
      const fromNs = lookupKey(namespaces.get(`${locale}:${namespace}`), key);
      if (fromNs !== undefined) return fromNs;
    }
    const fromMerged = lookupKey(merged[locale], key);
    if (fromMerged !== undefined) return fromMerged;
    return lookupKey(builtins[locale], key);
  };

  const resolve = (
    locale: Locale,
    namespace: string | undefined,
    key: string,
    params?: Record<string, unknown>,
  ): string => {
    const direct = lookup(locale, namespace, key);
    if (direct !== undefined) return interpolate(direct, params);
    // 另一种语言兜底:缺翻译时宁可显示另一种语言,也不要显示 key。
    const fallback: Locale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const fromFallback = lookup(fallback, namespace, key);
    if (fromFallback !== undefined) return interpolate(fromFallback, params);
    return key;
  };

  const service: LocaleStore = {
    current: () => current,
    set: (locale) => {
      if (!isSupported(locale) || current === locale) return;
      current = locale;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
        } catch {
          /* storage may be unavailable (private mode, quota); ignore */
        }
      }
      notify();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    t: (key, params) => resolve(current, undefined, key, params),
    tIn: (locale, key, params) => resolve(locale, undefined, key, params),
    bind: (namespace) => (key, params) => resolve(current, namespace, key, params),
    register: (locale, namespace, dictionary) => {
      const id = `${locale}:${namespace}`;
      namespaces.set(id, dictionary);
      notify();
      return () => {
        namespaces.delete(id);
        notify();
      };
    },
    merge: (locale, dictionary) => {
      merged[locale] = deepMerge(merged[locale], dictionary);
      notify();
      return () => {
        /* 合并层没有可靠的撤销语义(多次 merge 会叠加),这里保持幂等 no-op。 */
      };
    },
    available: () => SUPPORTED_LOCALES,
    hasNamespace: (locale, namespace) => namespaces.has(`${locale}:${namespace}`),
    __reset: () => {
      namespaces.clear();
      merged["zh-CN"] = {};
      merged["en-US"] = {};
      notify();
    },
  };

  return service;
}

// ─── 单一 store ──────────────────────────────────────────────────────────
let singleton: LocaleStore | null = null;

/**
 * 取进程内唯一的 locale store(没有就创建)。
 *
 * React provider / `applyLocale(ctx)` / 宿主的 i18n 适配层都走这里 ——
 * 任何一处 `set()` 都能让另外两处立刻看到。
 */
export function getOrCreateLocaleService(): LocaleStore {
  if (!singleton) singleton = createLocaleStore();
  return singleton;
}

/** 测试用:丢弃单例,下一次调用会重新创建。 */
export function __resetLocaleService(): void {
  singleton = null;
}

const Ctx = createContext<LocaleService | null>(null);

/**
 * i18n Provider —— 把单例挂到 React 树上。
 *
 * 不再自己建 store(那会与 `ctx.locale` 分叉);`initial` 只在测试里用来
 * 指定起始语言。
 */
export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const store = useMemo(() => {
    const s = getOrCreateLocaleService();
    if (initial) s.set(initial);
    return s;
  }, [initial]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/**
 * 读取 locale 服务。
 *
 * 不在 Provider 内时回落到单例(而不是抛错):`useT()` 会被包里的叶子组件调用,
 * 单元测试 / Storybook / 独立挂载都是"没有 Provider"的合法场景 —— 没装 Provider
 * 不等于用错了 API(与 `useUiRuntimeOptional` 同一取舍)。
 */
export function useLocale(): LocaleService {
  return useContext(Ctx) ?? getOrCreateLocaleService();
}

/** Convenience hook: returns a translate function bound to the active locale. */
export function useT(key: string, params?: Record<string, unknown>): string {
  const locale = useLocale();
  const [value, setValue] = useState(() => locale.t(key, params));
  useEffect(() => {
    setValue(locale.t(key, params));
    return locale.subscribe(() => setValue(locale.t(key, params)));
    // params 是对象字面量时每次渲染都是新引用,用 JSON 串做依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, key, JSON.stringify(params)]);
  return value;
}

/** 订阅当前语言(需要在语言切换时改变行为 / 语言的组件用)。 */
export function useLocaleName(): Locale {
  const locale = useLocale();
  const [name, setName] = useState(() => locale.current());
  useEffect(() => {
    setName(locale.current());
    return locale.subscribe(() => setName(locale.current()));
  }, [locale]);
  return name;
}

/**
 * 语言的人类可读标签。
 *
 * 刻意**不**放进词表:语言名应该用「它自己那门语言」写(简体中文 / English),
 * 这样即使界面正处在用户看不懂的语言里,下拉框依然能被认出来 —— 这是
 * 语言选择器的通行做法(Chrome / VS Code 同款)。
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

/**
 * 语言选择器 —— 内核 `settings.appearance.language` 槽的默认实现。
 *
 * 读写的都是单例 locale store,所以切换后整个界面(以及第三方插件)立刻跟着变,
 * 不需要刷新。
 */
export function LanguagePicker({
  className = "settings-select",
  id,
}: {
  className?: string;
  id?: string;
} = {}) {
  const locale = useLocale();
  const current = useLocaleName();
  return (
    <select
      id={id}
      className={className}
      value={current}
      aria-label="Language / 语言"
      onChange={(event) => locale.set(event.target.value as Locale)}
    >
      {locale.available().map((code) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code] ?? code}
        </option>
      ))}
    </select>
  );
}

/** Plugin apply(): expose ctx.locale service(与 React 树共用同一个 store)。 */
export function applyLocale(ctx: Record<string, unknown>): () => void {
  ctx.locale = getOrCreateLocaleService();
  return () => {
    delete ctx.locale;
  };
}
