// Stage G-1c: openbuddy-automation removed; automation is owned by
// pi-background-tasks + pi-goal (passthrough). This file used to host
// both TaskBootstrapStore and AutomationBootstrapStore; the automation
// half has been deleted. Only the task bootstrap is retained here.
//
// File path intentionally kept as `task-automation-bootstrap.ts` to
// minimize import-site churn — see the storage index for the explicit
// export surface.
import { TaskCatalog, type TaskCatalogEntry } from "../sqlite/task-catalog";
import { redactStorageValue } from "../driver/redact";

export interface TaskBootstrapSnapshot {
  schema: "openbuddy.storage-task-bootstrap.v1";
  sessionId: string;
  tasks: TaskCatalogEntry[];
  capturedAt: string;
}

export function redactTaskSnapshot(snapshot: TaskBootstrapSnapshot): TaskBootstrapSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => ({ ...task, content: String(redactStorageValue(task.content) ?? "") })),
  };
}

export class TaskBootstrapStore {
  private catalog?: TaskCatalog;

  constructor(private readonly options: { databasePath: string; appVersion?: string; now?: () => string }) {}

  private catalogInstance(): TaskCatalog {
    return (this.catalog ??= new TaskCatalog({ databasePath: this.options.databasePath, ...(this.options.appVersion ? { appVersion: this.options.appVersion } : {}) }));
  }

  async snapshot(sessionId: string): Promise<TaskBootstrapSnapshot> {
    const tasks = await this.catalogInstance().list(sessionId);
    const capturedAt = (this.options.now ?? (() => new Date().toISOString()))();
    return redactTaskSnapshot({ schema: "openbuddy.storage-task-bootstrap.v1", sessionId, tasks, capturedAt });
  }

  async close(): Promise<void> {
    const catalog = this.catalog;
    this.catalog = undefined;
    if (!catalog) return;
    await catalog.close();
  }
}
