/**
 * @openbuddy/ui-editor/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-editor-invariant";
export const inject = ["invariants"] as const;

/**
 * 没有运行时不变式:markdown 往返、命令过滤、浮层定位都是纯函数,
 * 已由 src/lib/*.test.ts 与 src/__tests__ 覆盖;组件本身是受控视图,
 * 不持有需要守护的跨包状态。
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
