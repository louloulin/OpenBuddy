/**
 * src/lib/navigation/placeholder-routes.ts
 *
 * 占位页路由标签 —— 跨视图的「我点的是哪个面板」标识。
 *
 * 唯一来源。`AppShell` 据此隐藏某些全局 overlay(比如专家页不要显示
 * 「运行中任务」浮层,任务删除是专家域之外的事),`PlaceholderPage`
 * 据此把 label 路由到对应的内置组件 —— 改一处,两处同步。
 */

/** 专家·技能·连接器(WorkBuddy 的「智能体」入口)。 */
export const EXPERTS_ROUTE_LABEL = "专家·技能·连接器" as const;

/** 占位页路由白名单,目前只暴露一个;之后会按需扩张。 */
export const PLACEHOLDER_ROUTE_LABELS = [EXPERTS_ROUTE_LABEL] as const;
export type PlaceholderRouteLabel = (typeof PLACEHOLDER_ROUTE_LABELS)[number];

export function isPlaceholderRouteLabel(value: unknown): value is PlaceholderRouteLabel {
  return typeof value === "string"
    && (PLACEHOLDER_ROUTE_LABELS as readonly string[]).includes(value);
}
