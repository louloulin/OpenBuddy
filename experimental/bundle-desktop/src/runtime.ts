/**
 * @openbuddy/bundle-desktop/runtime — 桌面端 UI 运行时启动器。
 *
 * 把 22 个 ui-* 业务包的 apply() 一次性注册到运行时,避免 App.tsx 手动 import 22 个
 * client 子路径。调用方:
 *
 *   import { bootstrapDesktopRuntime } from "@openbuddy/bundle-desktop/runtime";
 *   const dispose = bootstrapDesktopRuntime();
 *
 * 返回的 dispose 反序释放所有 22 个 ui-* 注册的 slot 条目。
 *
 * 失败隔离:单个包 apply() 抛错不影响后续包;错误信息统一通过 console.error 输出。
 */
import {
  registerAllBuiltinUis,
  getRuntime,
  lastRegisteredPackageCount,
  type UiRuntime,
} from "@openbuddy/ui-runtime/client";

/** 启动桌面端 UI 运行时(注册 22 个内置 ui-* 包到 SlotProvider)。 */
export function bootstrapDesktopRuntime(): () => void {
  const dispose = registerAllBuiltinUis();
  // 触达 getRuntime() 确保 singleton 初始化完成,即使调用方还没用 useUiRuntime。
  void getRuntime();
  return dispose;
}

/** 当前已注册的 ui-* 包数量(用于调试 / 健康检查)。 */
export function desktopBuiltinCount(): number {
  return lastRegisteredPackageCount();
}

/** 暴露 UiRuntime 类型 + getRuntime 给消费方做集成测试。 */
export type { UiRuntime };
export { getRuntime };
