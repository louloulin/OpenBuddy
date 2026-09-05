import type { CasdoorCapability, CasdoorTenantPermission } from "@openbuddy/auth-casdoor";

export type WorkbenchResource =
  | "agent"
  | "model"
  | "skill"
  | "mcp"
  | "memory"
  | "automation"
  | "team"
  | "session"
  | "task"
  | "plan"
  | "subagent"
  | "project"
  | "knowledge_base"
  | "storage_connection"
  | "casdoor_management";

export type WorkbenchAction = "read" | "write" | "execute" | "delete" | "admin";

export type WorkbenchAccessRequirement =
  | { capability: CasdoorCapability }
  | { permission: CasdoorTenantPermission }
  | { resource: WorkbenchResource; action: WorkbenchAction };

const RESOURCE_REQUIREMENTS: Record<WorkbenchResource, { read: WorkbenchAccessRequirement; write: WorkbenchAccessRequirement }> = {
  agent: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  model: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  skill: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  mcp: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  memory: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  automation: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  team: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  session: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  task: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  plan: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  subagent: { read: { capability: "team.workspace" }, write: { capability: "team.workspace" } },
  project: { read: { capability: "protected.resources" }, write: { capability: "protected.resources" } },
  knowledge_base: { read: { capability: "protected.resources" }, write: { capability: "protected.resources" } },
  storage_connection: { read: { capability: "cloud.sync" }, write: { capability: "cloud.sync" } },
  casdoor_management: { read: { permission: "tenant.settings.read" }, write: { permission: "tenant.settings.write" } },
};

export function workbenchRequirement(resource: WorkbenchResource, action: WorkbenchAction): WorkbenchAccessRequirement {
  if (action === "read") return RESOURCE_REQUIREMENTS[resource].read;
  return RESOURCE_REQUIREMENTS[resource].write;
}

export function workbenchResourceForChannel(channel: string): WorkbenchResource | undefined {
  if (/^agents_|^agent:providers/.test(channel)) return "agent";
  if (channel === "agent:current-model") return "model";
  if (/^skills:|^skills_/.test(channel)) return "skill";
  if (/^mcp[:_]/.test(channel)) return "mcp";
  if (/^memory[:_]/.test(channel)) return "memory";
  if (/^automations:/.test(channel)) return "automation";
  if (/^teams:/.test(channel)) return "team";
  if (/^sessions:|^session_|^agent:(dispose|load-session|session-info|session-usage|new-session|prompt|abort|resolve-permission|resolve-question)/.test(channel)) return "session";
  if (/^tasks:|^tasks_|^task_/.test(channel)) return "task";
  if (/^plan-mode:|^toggle_plan_mode/.test(channel)) return "plan";
  // Stage G-1b: openbuddy-plan is removed. The regex above will no
  // longer match any live IPC channel — plan-mode is owned by
  // pi-plan-mode (passthrough) and managed via pi's native RPC. We
  // retain the mapping rule for log/audit consistency; if a stray
  // caller still emits these channels it should be re-routed through
  // the pi-side RPC instead.
  if (/^subagents:/.test(channel)) return "subagent";
  return undefined;
}

export function isWorkbenchWriteAction(action: WorkbenchAction): boolean {
  return action !== "read";
}

export const __enterpriseWorkbenchTestables = { RESOURCE_REQUIREMENTS };
