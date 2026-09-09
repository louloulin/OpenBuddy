/**
 * IPC surface — workspace tree domain.
 *
 * Phase B.1 round 5 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * 7 `workspace:*` CRUD handlers. All workspace-error normalization
 * (using `throwWorkspaceIpcError`) is encapsulated here so the agent
 * host facade can throw rich domain errors that surface as typed IPC
 * error responses with stable codes.
 *
 * Why workspace is separate from sessions:
 *   A workspace is a folder identity in the Sidebar; a session is a
 *   chat bound to that workspace. They share the `team.workspace`
 *   capability but their CRUD operations differ — workspace is
 *   reorder/insert, sessions is list/rename/archive. The split keeps
 *   the per-handler code paths auditable.
 *
 * The expert-binding mutators (`sessions:set-expert`) live in
 * `./sessions.ts` because they mutate session-level metadata, not
 * workspace tree.
 */
import { ipcMain } from "electron";

import {
  absolutePath,
  recordValue,
  requiredBoolean,
  requiredString,
  throwWorkspaceIpcError,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerWorkspaceIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("workspace:list", async () => {
    await ensureAgentHost();
    return {
      items: await agentHost.listWorkspaces(),
      archivedSessionIds: [...(agentHost.getContext()?.get("workspaceRegistry") as { archivedSessionIds?: readonly string[] } | undefined)?.archivedSessionIds ?? []],
    };
  });
  ipcMain.handle("workspace:create", async (_e, args: unknown) => {
    try {
      await ensureAgentHost();
      const input = recordValue(args, "workspace create payload");
      return await agentHost.createWorkspace(absolutePath(input.path, "path"), input.title === undefined ? undefined : requiredString(input.title, "title"));
    } catch (error) {
      throwWorkspaceIpcError(error);
    }
  });
  ipcMain.handle("workspace:rename", async (_e, args: unknown) => {
    try {
      await ensureAgentHost();
      const input = recordValue(args, "workspace rename payload");
      return { workspace: await agentHost.renameWorkspace(requiredString(input.workspaceId, "workspaceId"), requiredString(input.title, "title")) };
    } catch (error) {
      throwWorkspaceIpcError(error);
    }
  });
  ipcMain.handle("workspace:delete", async (_e, args: unknown) => {
    try {
      await ensureAgentHost();
      const input = recordValue(args, "workspace delete payload");
      return { deleted: await agentHost.deleteWorkspace(requiredString(input.workspaceId, "workspaceId")) };
    } catch (error) {
      throwWorkspaceIpcError(error);
    }
  });
  ipcMain.handle("workspace:insert-before", async (_e, args: unknown) => {
    try {
      await ensureAgentHost();
      const input = recordValue(args, "workspace reorder payload");
      return {
        workspaceIds: await agentHost.insertWorkspaceBefore(
          requiredString(input.workspaceId, "workspaceId"),
          input.beforeWorkspaceId === undefined ? undefined : requiredString(input.beforeWorkspaceId, "beforeWorkspaceId"),
        ),
      };
    } catch (error) {
      throwWorkspaceIpcError(error);
    }
  });
  ipcMain.handle("workspace:insert-session-before", async (_e, args: unknown) => {
    const input = recordValue(args, "workspace session reorder payload");
    try {
      await ensureAgentHost();
      return {
        workspace: await agentHost.insertWorkspaceSessionBefore(
          requiredString(input.workspaceId, "workspaceId"),
          requiredString(input.sessionId, "sessionId"),
          input.beforeSessionId === undefined ? undefined : requiredString(input.beforeSessionId, "beforeSessionId"),
        ),
      };
    } catch (error) {
      throwWorkspaceIpcError(error, {
        workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : "",
        sessionId: typeof input.sessionId === "string" ? input.sessionId : "",
        ...(typeof input.beforeSessionId === "string" ? { beforeSessionId: input.beforeSessionId } : {}),
      });
    }
  });
  ipcMain.handle("workspace:archive-session", async (_e, args: unknown) => {
    try {
      await ensureAgentHost();
      const input = recordValue(args, "workspace archive payload");
      return {
        archivedSessionIds: await agentHost.archiveWorkspaceSession(
          requiredString(input.sessionId, "sessionId"),
          input.archived === undefined ? true : requiredBoolean(input.archived, "archived"),
        ),
      };
    } catch (error) {
      throwWorkspaceIpcError(error);
    }
  });
}
