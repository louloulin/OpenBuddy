/**
 * @openbuddy/ui-shared — 统一对外入口
 *
 * 跨包共享工具层。提供 McpEndpointCard、PermissionPicker、项目选择器、首页场景模型、横向滚动 hook 等通用 UI 工具。
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
export * from "./McpEndpointCard";
export * from "./PermissionPicker";
export * from "./assistant-workbench-model";
export * from "./home-scenes";
export * from "./project-picker";
export * from "./project-tabs";
export * from "./use-horizontal-scroll";
