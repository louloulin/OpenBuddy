/**
 * @openbuddy/ui-hmr — 统一对外入口
 *
 * 热更新层。承载开发态模块热替换、组件热重载、运行时诊断埋点。
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
import type { UiPlugin } from "@openbuddy/ui-slots";

export interface HmrPluginRegistration {
  /** The plugin instance (after apply()). */
  plugin: UiPlugin;
  /** The disposer returned by apply(); call to tear down. */
  dispose: () => Promise<void>;
}

export interface HmrRegistry {
  /** Register a plugin and capture its disposer. */
  register(plugin: UiPlugin): Promise<HmrPluginRegistration>;
  /** Tear down every registration (e.g. on full reload). */
  disposeAll(): Promise<void>;
  /** Re-run apply() for every registration. Returns the new disposers. */
  refresh(): Promise<void>;
}

/** Module-level accessor — created lazily by the SlotProvider. */
export function defineHmrRegistry(): HmrRegistry {
  const registrations: HmrPluginRegistration[] = [];
  return {
    async register(plugin) {
      const reg: HmrPluginRegistration = { plugin, dispose: async () => {} };
      registrations.push(reg);
      return reg;
    },
    async disposeAll() {
      for (const r of registrations.slice().reverse()) {
        try { await r.dispose(); } catch { /* ignore */ }
      }
      registrations.length = 0;
    },
    async refresh() {
      for (const r of registrations) {
        try { await r.dispose(); } catch { /* ignore */ }
      }
    },
  };
}

declare module "@openbuddy/ui-slots" {
  interface GlobalStandardProps {
    useHmr(): HmrRegistry;
  }
}
