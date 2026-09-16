/**
 * @openbuddy/ui-onboarding/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-onboarding-invariant";
export const inject = ["invariants"] as const;

/**
 * 没有运行时不变式:向导状态机(`lib/onboarding-reducer`)与漫游定位
 * (`tour/tour-steps`)都是纯函数,已由同目录测试穷举;组件是受控视图,
 * 不做任何持久化以外的副作用(持久化也由注入的 storage 承担)。
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
