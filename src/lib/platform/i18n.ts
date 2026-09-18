/**
 * renderer i18n —— 微内核 `@openbuddy/ui-locale` 之上的**宿主适配层**。
 *
 * ## 为什么是适配层而不是又一套实现
 *
 * 这里原本是第二套 i18n:`src/locales/*.json` + 自己的事件总线 + 自己的
 * localStorage 读写,与 `@openbuddy/ui-locale`(微内核 `ctx.locale`)并存。
 * 两套系统互不可见 —— 插件用 `ctx.locale.set("en-US")` 不会影响界面,而
 * 界面上切换语言插件也读不到。现在文案仍然住在产品侧(`src/locales/`),
 * 但**状态与查词全在内核**,这里只做三件事:
 *
 *   1. 把产品词表 merge 进内核(模块加载时一次);
 *   2. 保持历史 API(`t` / `useT` / `useLocale` / `setLocale` / `getLocale` /
 *      `I18nProvider`)不变,25 处调用点零改动;
 *   3. 把内核的订阅转成 React 重渲染。
 *
 * 持久化 key 与内核一致(`openbuddy:locale`),因此新旧代码读到的语言相同。
 *
 * 新代码请优先直接用 `@openbuddy/ui-locale` 的 `useT` / `useLocale`(包内
 * 组件不该反向依赖 `src/`)。本文件保留是给历史调用点与宿主使用的。
 */

import { useEffect, useState, type ReactNode } from "react";
import { getOrCreateLocaleService } from "@openbuddy/ui-locale/client";
import zhCN from "../../locales/zh-CN.json";
import enUS from "../../locales/en-US.json";

export type Locale = "zh-CN" | "en-US";

const service = getOrCreateLocaleService();

// 产品词表进内核(幂等:模块只加载一次;HMR 重复执行也只是再合并一次同样的表)。
service.merge("zh-CN", zhCN as Record<string, unknown>);
service.merge("en-US", enUS as Record<string, unknown>);

export const DEFAULT_LOCALE: Locale = "zh-CN";
export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en-US"] as const;
export { LOCALE_STORAGE_KEY } from "@openbuddy/ui-locale/client";

/** 非 React 场景的翻译入口。`locale` 省略时用当前语言。 */
export function t(key: string, locale?: Locale): string {
  return locale ? service.tIn(locale, key) : service.t(key);
}

export function getLocale(): Locale {
  return service.current();
}

export function setLocale(locale: Locale): void {
  service.set(locale);
}

export function subscribeLocale(fn: (locale: Locale) => void): () => void {
  return service.subscribe(() => fn(service.current()));
}

export function useLocale(): {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
} {
  const [locale, setLocaleState] = useState<Locale>(() => service.current());

  useEffect(() => {
    setLocaleState(service.current());
    return service.subscribe(() => setLocaleState(service.current()));
  }, []);

  return {
    locale,
    setLocale,
    t: (key: string) => service.tIn(locale, key),
  };
}

export function useT(key: string): string {
  const { t: translate } = useLocale();
  return translate(key);
}

/**
 * Provider —— 历史 API。语言状态现在归内核所有,所以这里不再读写
 * localStorage,只是把它挂到树上并在挂载时同步一次当前语言。
 */
export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [, force] = useState(0);
  useEffect(() => service.subscribe(() => force((n) => n + 1)), []);
  return children;
}
