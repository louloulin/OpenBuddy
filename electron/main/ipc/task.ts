/**
 * IPC surface — task domain.
 *
 * Phase B.1 round 3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Extracted
 * from `./agent.ts`. Owns the `tasks_list` + `task_kill` handlers.
 * Both are thin wrappers over agentHost.listRunningTasks() /
 * agentHost.killTask().
 */
import { ipcMain } from "electron";

import {
  recordValue,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

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