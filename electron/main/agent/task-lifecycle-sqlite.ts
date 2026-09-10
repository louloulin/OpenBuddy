import { closeStorage, openStorage, SettingsStore, type OpenStorageResult } from "@openbuddy/storage";
import type { TaskLifecyclePersistence, TaskLifecycleState } from "@openbuddy/plugin-host";

export const TASK_LIFECYCLE_NAMESPACE = "openbuddy.task-lifecycle.v1";

/** Adapter over the canonical OpenBuddy SQLite settings store. No database is
 * created here: the caller supplies the existing profile database path. */
export class SqliteTaskLifecyclePersistence implements TaskLifecyclePersistence {
  private storage: Promise<OpenStorageResult> | undefined;

  constructor(private readonly databasePath: string) {}

  private async store(): Promise<SettingsStore> {
    if (!this.storage) this.storage = openStorage({ filePath: this.databasePath, appVersion: "openbuddy-task-lifecycle" });
    const opened = await this.storage;
    return new SettingsStore({ driver: opened.driver });
  }

  async read(taskId: string): Promise<TaskLifecycleState | null> {
    const stored = (await this.store()).getStrict(TASK_LIFECYCLE_NAMESPACE, taskId);
    return stored?.value as TaskLifecycleState | null ?? null;
  }

  async write(state: TaskLifecycleState): Promise<void> {
    await (await this.store()).setAsync(TASK_LIFECYCLE_NAMESPACE, state.taskId, state, 1);
  }

  async list(): Promise<TaskLifecycleState[]> {
    const entries = (await this.store()).list(TASK_LIFECYCLE_NAMESPACE);
    const out: TaskLifecycleState[] = [];
    for (const entry of entries) {
      const value = entry.value;
      if (value && typeof value === "object" && "taskId" in value && "status" in value) {
        out.push({ ...(value as TaskLifecycleState) });
      }
    }
    return out;
  }

  async close(): Promise<void> {
    await closeStorage(this.storage);
    this.storage = undefined;
  }
}
