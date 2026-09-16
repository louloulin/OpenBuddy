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

/** 一份词表:嵌套的 key → 字符串(或子树)。 */
export type LocaleDictionary = Record<string, unknown>;

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
   * 指定语言查词(与 `t` 的区别:不读当前语言)。宿主里带 locale 参数的
   * `t(key, locale)` 兼容面用得上。
   */
  tIn(locale: Locale, key: string, params?: Record<string, unknown>): string;
  /**
   * Bind a namespace to a translate function. The returned function reads
   * the active locale at call time, so a locale switch hands out NEW
   * function references.
   */
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string;
  /**
   * 注册一个包 / 插件自己的词表(带语言维度)。
   *
   * 与 `merge` 的分工:子表是**作用域隔离**的(只有 `bind(ns)` / 带 ns 的
   * 查询能读到),合并层是**全局**的(产品文案直接进 `t`)。
   */
  register(locale: Locale, namespace: string, dictionary: LocaleDictionary): () => void;
  /**
   * 把一份词表**深度合并**进全局词表(宿主把产品文案搬进内核用)。
   * 返回 disposer,重复调用是幂等的(同一个 locale 多次 merge 会叠加)。
   */
  merge(locale: Locale, dictionary: LocaleDictionary): () => void;
  /** 当前支持的语言(按 SUPPORTED_LOCALES 顺序)。 */
  available(): readonly Locale[];
}

declare module "@openbuddy/ui-slots" {
  interface UiRuntimeContext {
    /**
     * 语言服务。与 React 树的 I18nProvider 是**同一个 store**:
     * 插件 `ctx.locale.set("en-US")` 会立刻让订阅了 `useT` 的组件重渲染。
     */
    locale: LocaleService;
  }
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
