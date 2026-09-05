export type AssistantWorkspaceSection =
  | "inbox"
  | "calendar"
  | "tasks"
  | "workflows"
  | "rooms"
  | "buddies"
  | "network"
  | "capabilities"
  | "evidence"
  | "recovery";

export const ASSISTANT_TAB_SECTIONS: readonly AssistantWorkspaceSection[] = [
  "inbox",
  "calendar",
  "tasks",
  "workflows",
  "rooms",
  "buddies",
  "network",
  "capabilities",
  "evidence",
  "recovery",
];

export const ASSISTANT_TAB_ROUTE_BY_SECTION: Record<AssistantWorkspaceSection, string> = {
  inbox: "助理·收件箱",
  calendar: "助理·日程",
  tasks: "助理·跨项目任务",
  workflows: "助理·工作流",
  rooms: "助理·Rooms",
  buddies: "助理·助理与 Buddy",
  network: "助理·开放网络",
  capabilities: "助理·能力与策略",
  evidence: "助理·证据与审计",
  recovery: "助理·副作用恢复",
};

export const ASSISTANT_TAB_LABEL_BY_SECTION: Record<AssistantWorkspaceSection, string> = {
  inbox: "收件箱",
  calendar: "日程",
  tasks: "跨项目任务",
  workflows: "工作流",
  rooms: "Rooms",
  buddies: "助理与 Buddy",
  network: "开放网络",
  capabilities: "能力与策略",
  evidence: "证据与审计",
  recovery: "副作用恢复",
};

const ASSISTANT_SECTION_BY_ROUTE: Record<string, AssistantWorkspaceSection> = {
  ...Object.fromEntries(
    Object.entries(ASSISTANT_TAB_ROUTE_BY_SECTION).map(([section, route]) => [route, section]),
  ) as Record<string, AssistantWorkspaceSection>,
  "助理·任务协作": "tasks",
};

export function assistantWorkspaceSectionFromRoute(route: string): AssistantWorkspaceSection | undefined {
  return ASSISTANT_SECTION_BY_ROUTE[route];
}

export function assistantRouteForSection(section: AssistantWorkspaceSection): string {
  return ASSISTANT_TAB_ROUTE_BY_SECTION[section];
}
