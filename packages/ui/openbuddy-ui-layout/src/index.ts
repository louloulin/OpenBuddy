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
    /**
     * `details`(右侧助理导轨)的声明权已移交 `@openbuddy/ui-shell` ——
     * 它是该槽的注册方,AppFrame 只是消费者之一。原来这里写着
     * "Right details column. Owned by ui-workbench",owner 形状是
     * `{ open, width }`,和真实注册的 `SecondarySidebar` props 对不上,
     * 结果是"槽被声明了、被注册了、却没人按正确契约消费"。
     */
    /** Frame-wide floating layer (toasts, modals). */
    "shell.overlay": {
      kind: "list";
      scope: "root";
    };
    /**
     * 整个应用外壳(single)—— 本产品最深的一级扩展点。
     *
     * 消费者:`src/App.tsx` 的 `RootSurface`(fallback 是内置 AppShell);
     * 本包的 `AppFrame` 是同一位置的**参考实现**,它的 apply() 有意不注册,
     * 免得内置包自己把产品外壳顶掉。插件(或第三方发行版)注册更高优先级
     * 即可把侧栏 / 顶栏 / 主区 / 全部浮层一起换掉,而不是逐块接管。
     *
     * 零 props:替换实现自己从 runtime 取状态(`ShellWithRuntime` 就是这么做的),
     * 宿主只负责把它挂到 React 树根。
     */
    "root": {
      kind: "single";
      scope: "root";
      owner: Record<string, never>;
    };
  }
}
