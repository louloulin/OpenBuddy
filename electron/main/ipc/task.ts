/**
 * IPC surface — task domain.
 *
 * Two distinct concepts share this file, and they are NOT interchangeable:
 *
 *  - `tasks_list` / `task_kill` (snake_case) — the running agent jobs owned by
 *    the agent host (`listRunningTasks` / `killTask`). Extracted from
 *    `./agent.ts` in Phase B.1 round 3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md.
 *  - `tasks:add|list|update|delete|clear-completed` (colon) — the per-session
 *    todo list backed by `TaskCatalog` (`session_tasks` table). These used to
 *    be `async () => null` stubs in `./misc.ts`, which made the email
 *    "adopt action items" flow and the unified-search task scope report
 *    success while writing nothing. They now go through the same
 *    `TaskService` the `/tasks` slash command uses, so both surfaces read and
 *    write one store.
 */
import { ipcMain } from "electron";

import { wrapIpcHandler } from "./_wrap";
import {
  optionalString,
  recordValue,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";
import { defaultTaskService, type TaskService } from "../agent/host-modules/task-service";

export function registerTaskIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("tasks_list", async () => {
    await ensureAgentHost();
    return agentHost.listRunningTasks();
  });
  ipcMain.handle("task_kill", async (_e, args: { taskId: string }) => {
    await ensureAgentHost();
    return agentHost.killTask(requiredString(recordValue(args, "task kill payload").taskId, "task id"));
  });
}

/** Lazily built so module load never opens SQLite (tests import this file). */
let todoService: TaskService | null = null;
function sessionTasks(): TaskService {
  return (todoService ??= defaultTaskService());
}

/** Reset hook for tests — the catalog is unopened until first use. */
export function __resetTodoServiceForTests(): void {
  todoService = null;
}

export function registerSessionTaskIpc(): void {
  wrapIpcHandler("tasks:list", async (_e, args: unknown) => {
    const input = recordValue(args, "tasks:list payload");
    return sessionTasks().list(requiredString(input.sessionId, "sessionId"));
  });

  wrapIpcHandler("tasks:add", async (_e, args: unknown) => {
    const input = recordValue(args, "tasks:add payload");
    const sessionId = requiredString(input.sessionId, "sessionId");
    const title = requiredString(input.title ?? input.content, "title");
    return sessionTasks().add(sessionId, title);
  });

  wrapIpcHandler("tasks:update", async (_e, args: unknown) => {
    const input = recordValue(args, "tasks:update payload");
    const sessionId = requiredString(input.sessionId, "sessionId");
    const id = requiredString(input.id, "id");
    const patch = recordValue(input.patch ?? {}, "tasks:update patch");
    const status = optionalString(patch.status, "status");
    return sessionTasks().update(sessionId, id, status ? { status } : {});
  });

  wrapIpcHandler("tasks:delete", async (_e, args: unknown) => {
    const input = recordValue(args, "tasks:delete payload");
    const sessionId = requiredString(input.sessionId, "sessionId");
    const id = requiredString(input.id, "id");
    await sessionTasks().remove(sessionId, id);
    return { ok: true };
  });

  wrapIpcHandler("tasks:clear-completed", async (_e, args: unknown) => {
    const input = recordValue(args, "tasks:clear-completed payload");
    await sessionTasks().clear(requiredString(input.sessionId, "sessionId"));
    return { ok: true };
  });
}