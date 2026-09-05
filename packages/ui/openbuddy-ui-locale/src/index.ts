/**
 * @openbuddy/ui-locale — 统一对外入口
 *
 * 国际化层。承载语言切换、时区、货币、数字格式、RTL/LTR 方向等本地化能力。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染
 *   - 公共工具 (Utilities)    → 函数 / 常量 / hooks,无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
import type { SlotMap } from "@openbuddy/ui-slots";
export type Locale = "zh-CN" | "en-US";
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en-US"] as const;

export interface LocaleService {
  current(): Locale;
  set(locale: Locale): void;
  subscribe(fn: () => void): () => void;
  /**
   * Look up a dotted key path in the current locale, falling back to the
   * key string when missing (so missing-translation bugs surface immediately).
   */
  t(key: string, params?: Record<string, unknown>): string;
  /**
   * Bind a namespace to a translate function. The returned function reads
   * the active locale at call time, so a locale switch hands out NEW
   * function references.
   */
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string;
}

declare module "@openbuddy/ui-slots" {
  interface GlobalStandardProps {
    useLocale(): LocaleService;
  }
  interface SlotMap {
    /** Settings: language picker. */
    "settings.appearance.language": {
      kind: "single";
      scope: "root";
      owner: { currentLocale: Locale };
    };
  }
}

declare module "@openbuddy/cordis" {
  interface Context {
    locale: LocaleService;
  }
}
