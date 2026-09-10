/**
 * IPC surface — workbench task lifecycle (plan3.0.md §6 Phase 2.1).
 *
 * Thin handlers over the live `TaskLifecycleService` registered by the
 * openbuddy-core plugin. Each handler resolves the service lazily so the
 * plugin can mount after the IPC registrar runs. Channels:
 *
 *   - `worktask:get`        `{ taskId }` → `TaskLifecycleState | null`
 *   - `worktask:create`     `{ taskId?, sessionId, workspaceId?, generation?, status?, reason? }` → state
 *   - `worktask:transition` `{ taskId, event, reason? }` → state
 *   - `worktask:recover`    `{ taskId, currentGeneration }` → `TaskRecoveryOutcome`
 *   - `worktask:events`     `{ taskId }` → `TaskLifecycleEventRecord[]`
 *
 * Errors from the service (closed, invalid transition, …) are forwarded
 * verbatim — they are actionable diagnostics, not IPC contract violations.
 */
import { ipcMain } from "electron";
import {
  taskStatuses,
  type TaskLifecycleEvent,
} from "@openbuddy/plugin-host";
import { getTaskLifecycleService, type CreateTaskInput } from "../agent/host-modules/task-lifecycle-service";
import {
  enumValue,
  optionalString,
  recordValue,
  requiredString,
} from "./validation";

const lifecycleEvents: readonly TaskLifecycleEvent[] = [
  "queue", "start", "approval_required", "approve", "complete", "fail",
  "retry", "cancel", "pause", "resume",
];

function parseGeneration(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function registerWorktaskIpc(): void {
  ipcMain.handle("worktask:get", async (_e, args: unknown) => {
    const payload = recordValue(args, "worktask:get payload");
    const taskId = requiredString(payload.taskId, "taskId");
    return await getTaskLifecycleService().getTask(taskId);
  });

  ipcMain.handle("worktask:create", async (_e, args: unknown) => {
    const payload = recordValue(args, "worktask:create payload");
    const input: CreateTaskInput = {
      sessionId: requiredString(payload.sessionId, "sessionId"),
      ...(payload.taskId !== undefined ? { taskId: requiredString(payload.taskId, "taskId") } : {}),
      ...(payload.workspaceId !== undefined
        ? { workspaceId: requiredString(payload.workspaceId, "workspaceId") }
        : {}),
      ...(payload.status !== undefined
        ? { status: enumValue(payload.status, "status", taskStatuses) }
        : {}),
      ...(parseGeneration(payload.generation, "generation") !== undefined
        ? { generation: parseGeneration(payload.generation, "generation") as number }
        : {}),
    };
    return await getTaskLifecycleService().createTask(input);
  });

  ipcMain.handle("worktask:transition", async (_e, args: unknown) => {
    const payload = recordValue(args, "worktask:transition payload");
    const taskId = requiredString(payload.taskId, "taskId");
    const event = enumValue(payload.event, "event", lifecycleEvents);
    const reason = optionalString(payload.reason, "reason");
    return await getTaskLifecycleService().transitionTask(taskId, event, reason ? { reason } : undefined);
  });

  ipcMain.handle("worktask:recover", async (_e, args: unknown) => {
    const payload = recordValue(args, "worktask:recover payload");
    const taskId = requiredString(payload.taskId, "taskId");
    const currentGeneration = parseGeneration(payload.currentGeneration, "currentGeneration");
    if (currentGeneration === undefined) throw new Error("currentGeneration is required");
    return await getTaskLifecycleService().recoverTask(taskId, currentGeneration);
  });

  ipcMain.handle("worktask:events", async (_e, args: unknown) => {
    const payload = recordValue(args, "worktask:events payload");
    const taskId = requiredString(payload.taskId, "taskId");
    return await getTaskLifecycleService().listEvents(taskId);
  });
}