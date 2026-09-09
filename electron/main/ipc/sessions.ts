/**
 * IPC surface — sessions domain.
 *
 * Phase B.1 round 5 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * 8 `sessions:*` mutation + listing handlers + the workspace content
 * search bridge. All non-prompt session operations live here; the
 * prompt-side (`agent:prompt`, `agent:abort`, `agent:compact` …)
 * lives in `./prompt-cycle.ts`.
 *
 * Why split these out from workspace:
 *   A workspace is a folder in the Sidebar; a session is a chat bound
 *   to that workspace. Conceptually the session is the higher-level
 *   identity (it's the thing the renderer routes to), so all session
 *   CRUD is grouped here, while workspace tree CRUD stays in
 *   `./workspace.ts`.
 *
 * The `agent:workspace-search` handler lives here (not in workspace)
 * because its result feeds the Composer's @-mention picker, which is
 * a session-scoped UI. Workspace list/create/delete stays in
 * `./workspace.ts`.
 */
import { ipcMain } from "electron";

import { generateTraceId } from "@openbuddy/logging-shared";

import {
  hostDispatched,
  hostFailed,
  hostReceived,
} from "../agent/agent-host-log";
import {
  absolutePath,
  optionalFiniteInteger,
  optionalString,
  recordValue,
  requiredBoolean,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerSessionsIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, casdoorAuth, ensureAgentHost } = deps;

  ipcMain.handle("sessions:list", async (_e, cwd: string) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    await ensureAgentHost();
    return agentHost.listSessions(absolutePath(cwd, "cwd"));
  });
  ipcMain.handle("sessions:list-workspaces", async () => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    await ensureAgentHost();
    return agentHost.listWorkspaces();
  });
  ipcMain.handle("sessions:rename", async (_e, args: unknown) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "sessions:rename payload");
    await agentHost.renameSession(requiredString(input.sessionId, "sessionId"), requiredString(input.title, "title"));
    return { ok: true };
  });
  ipcMain.handle("sessions:delete", async (_e, args: unknown) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "session delete payload");
    return agentHost.deleteSession(requiredString(input.sessionId, "sessionId"), input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"));
  });
  ipcMain.handle("sessions:set-pinned", async (_e, args: { id: string; pinned: boolean }) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "session pin payload");
    return agentHost.setSessionPinned(requiredString(input.id, "session id"), requiredBoolean(input.pinned, "pinned"));
  });
  ipcMain.handle("sessions:set-archived", async (_e, args: { id: string; archived: boolean }) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "session archive payload");
    return agentHost.setSessionArchived(requiredString(input.id, "session id"), requiredBoolean(input.archived, "archived"));
  });
  // R2.5 — bulk archive/unarchive for the Sidebar's 恢复全部 / 归档全部 actions.
  ipcMain.handle("sessions:set-all-archived", async (_e, args: { archived: boolean }) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "bulk archive payload");
    return agentHost.setAllArchived(requiredBoolean(input.archived, "archived"));
  });
  ipcMain.handle("sessions:set-expert", async (_e, args: { id: string; expertId?: string; expertName?: string; avatarLocal?: string }) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "session expert payload");
    const id = requiredString(input.id, "session id");
    const binding = input.expertId && input.expertName
      ? {
          expertId: requiredString(input.expertId, "expert id"),
          expertName: requiredString(input.expertName, "expert name"),
          avatarLocal: optionalString(input.avatarLocal, "avatarLocal"),
        }
      : null;
    return agentHost.setSessionExpert(id, binding);
  });

  // R1 - workspace search for the @-mention picker in the Composer.
  // Lives here (not in workspace.ts) because the picker is session-scoped.
  ipcMain.handle("agent:workspace-search", async (_e, input: { query: string; cwd: string; limit?: number; kinds?: Array<"file" | "folder" | "symbol">; traceId?: string }) => {
    const payload = recordValue(input, "agent:workspace-search payload");
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    const cwd = absolutePath(payload.cwd, "cwd");
    hostReceived("agent:workspace-search", traceId);
    try {
      const { workspaceSearch } = await import("../agent/workspace-search");
      const kinds = Array.isArray(payload.kinds)
        ? (payload.kinds.filter((k): k is "file" | "folder" | "symbol" => k === "file" || k === "folder" || k === "symbol"))
        : undefined;
      const result = await workspaceSearch(requiredString(payload.query, "query"), {
        cwd,
        limit: optionalFiniteInteger(payload.limit, "limit", 30, 1, 100),
        kinds,
      });
      hostDispatched("agent:workspace-search", traceId);
      return { hits: result.hits, duration_ms: result.duration_ms, source: result.source };
    } catch (err) {
      hostFailed("agent:workspace-search", traceId, err);
      throw err;
    }
  });
}
