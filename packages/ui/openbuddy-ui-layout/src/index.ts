/**
 * @openbuddy/ui-layout — 统一对外入口
 *
 * 布局层。承载全局布局骨架(顶栏、侧栏、主区、底栏)与响应式断点策略。
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
export { AppFrame } from "./client/AppFrame";
export type { AppFrameProps } from "./client/AppFrame";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /** Whole left navigation column. Owned by ui-sidebar. */
    "sidebar": {
      kind: "single";
      scope: "root";
      owner: {
        collapsed: boolean;
        width: number;
      };
    };
    /** Center column: no-session hero + active conversation. */
    "conversation": {
      kind: "single";
      scope: "session-maybe";
      owner: Record<string, never>;
    };
    /** Right details column. Owned by ui-workbench. */
    "details": {
      kind: "single";
      scope: "session";
      owner: { open: boolean; width: number };
    };
    /** Frame-wide floating layer (toasts, modals). */
    "shell.overlay": {
      kind: "list";
      scope: "root";
    };
  }
}
