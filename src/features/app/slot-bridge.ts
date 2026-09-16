/**
 * src/features/app/slot-bridge.ts
 *
 * Phase K.3 —— 微内核接线层（app 侧）。
 *
 * 微内核（`@openbuddy/ui-runtime`）把「谁提供这块 UI」登记在 SlotCore 里。
 * 本模块是 app 侧的**取用面**：给每个结构性位置一个名字（slot），先问内核要
 * 实现，内核里没有才回落到直接 import。
 *
 * 为什么保留 fallback：
 *   - 内核尚未注册（首屏 race / 插件加载失败）时 UI 不能变空白；
 *   - 第三方插件可以用更高 priority 注册同名 slot 整体替换某块 UI，
 *     而内置实现仍然存在于内核中作为底座。
 *
 * 这是「功能开关」式的渐进接线：任何一处出问题都可以单独退回直接 import，
 * 不影响其余部分的插件化收益。
 */

import { useSlotComponents, useSlotEntries, useSlotPayloads } from "@openbuddy/ui-runtime/client";
import type { SlotEntry } from "@openbuddy/ui-runtime/client";

/**
 * 从内核取一个 slot 的首个实现。
 *
 * @param name      slot 名，例如 "sidebar" / "conversation"
 * @param fallback  内核里没有该 slot 时使用的内置组件
 * @returns         应渲染的组件（内核实现优先，否则 fallback）
 */
export function useSlotComponent<T>(
  name: string,
  fallback: T,
): T {
  // 必须走 kind-aware 的 useSlotComponents：single slot 在内核里保留全部登记项
  // （这样插件卸载后内置实现能自动回来），只有 entries() 这一层才会收敛出赢家。
  // 直接读原始 entries 会让插件覆盖「看起来注册成功了但界面没变」。
  const components = useSlotComponents(name);
  const component = components[0];
  if (typeof component === "function") return component as unknown as T;
  return fallback;
}

/**
 * 读取一个 slot 的全部 entry，用于「插件追加」型位置（如 shell.overlay、
 * composer.toolbar.action）。返回原始 entry，调用方自己决定怎么渲染。
 */
export function useSlotList(name: string): readonly SlotEntry[] {
  return useSlotEntries(name);
}

/**
 * 读取一个 slot 里插件贡献的**数据型** payload(`{ id, label, onExecute }` 这类)。
 *
 * 与 useSlotList 的区别:那个拿的是 entry(含组件/元信息),这个只拿数据。
 * 用于「宿主提供 UI、插件只提供数据」的位置 —— 例如 ⌘K 面板里的插件命令。
 */
export function useSlotPayloadValues<T>(name: string): readonly T[] {
  return useSlotPayloads<T>(name);
}

/**
 * 判断某个 slot 当前是否由「非内置」的注册者提供 —— 用于调试面板 /
 * 插件面板显示「这块 UI 已被插件接管」。
 */
export function slotProviderOf(entries: readonly SlotEntry[]): string | undefined {
  return entries[0]?.registrant;
}
