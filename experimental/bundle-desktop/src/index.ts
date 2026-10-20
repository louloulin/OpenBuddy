/**
 * @openbuddy/bundle-desktop — 桌面端 UI 组合包。
 *
 * 把 22 个 @openbuddy/ui-* 业务包(账户/账单/协作/对话/对话框/...)组合为单一入口,
 * 让消费方(electron renderer、第三方 plugin host)只需 import 一个包即可。
 *
 * 对齐 deepseek-harness `packages/client/*` 的 bundle 模式:
 *   - 每个 bundle 是一个独立 workspace package
 *   - 依赖多个 ui-* 子包,通过 runtime 层做组合
 *   - 下游仅 import bundle,不直接面对细粒度 ui-* 包
 *
 * 子路径:
 *   - ./          → 类型与 utilities(SlotMap / UiRuntime 类型 re-export)
 *   - ./runtime   → bootstrapDesktopRuntime() 启动器
 *   - ./slots     → 合并 SlotMap 类型扩展点
 */
export * from "./slots";
export * from "./runtime";

// 重导出常用 ui-slots 类型,让消费方 @openbuddy/bundle-desktop 一处搞定。
export type {
  SlotKind,
  SlotScope,
  SlotSpec,
  SlotEntryDef,
  SlotCoreLike,
  UiPlugin,
  UiRuntimeContext,
  ChildrenDecl,
  SlotCore,
} from "@openbuddy/ui-slots";

// 重导出 ui-runtime 公开 API
export {
  SlotProvider,
  useUiRuntime,
  useUiRuntimeHook,
  useSessionHook,
  useSessionsHook,
  useWorkspacesHook,
  useSlotHook,
  useCurrentSessionId,
  applyUiRuntime,
  registerAllBuiltinUis,
  getRuntime,
  lastRegisteredPackageCount,
} from "@openbuddy/ui-runtime/client";
