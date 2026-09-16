/**
 * 极小的 class 名拼接工具 —— 只服务本包内部的 CSS Module 组合。
 *
 * 不用 clsx / classnames 之类依赖:本包是「表现层子包」,依赖越少越好,
 * 而且 `css: false` 的 vitest 环境下 CSS Module 映射为空对象,必须对
 * `undefined` 值安全(否则 className 里会出现字面量 "undefined")。
 */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}
