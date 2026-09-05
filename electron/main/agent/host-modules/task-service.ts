/**
 * task-service.ts — Phase R3.0 / Stage G-1d (RED FLAG fix).
 *
 * Wraps `TaskCatalog` (the existing SQLite-backed session-task store) in a
 * Cordis-friendly service that exposes the exact shape the `pi-todo`
 * compat adapter invokes at `electron/main/agent/pi-extensions.ts:756-791`:
 *
 *     list(sessionId)         → entries
 *     add(sessionId, content) → { id }
 *     update(sessionId, id, patch) → { id } | null
 *     remove(sessionId, id)  → void
 *     clear(sessionId)        → void
 *
 * Until this file landed, the adapter's G-1d "real tool" path was a
 * dead code path in production: `ctx.get("task")` returned undefined so
 * `invokeTasksCommand` silently no-op'd every verb. Compatibility-mode
 * tests mocked the service so the unit suite still passed, but real
 * `pi-todo` invocations on a live OpenBuddy installation produced zero
 * side-effects.
 *
 * Mount this service in `openbuddy-core-plugin.ts:apply()` via the
 * `mountTaskService(ctx, taskService)` helper so the existing
 * `ctx.get("task")` lookup at line 89 of that file starts resolving.
 */
import { TaskCatalog, type TaskCatalogEntry } from "@openbuddy/storage";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface TaskServiceEntry {
  id: string;
  content: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  order: number;
}

/**
 * TaskService — Cordis-friendly wrapper over TaskCatalog.
 *
 * Each instance is bound to a single SQLite database (the user's app
 * data folder). The catalog itself is shared across the process — the
 * wrapper just shapes the surface area the rest of the codebase calls.
 */
export class TaskService {
  constructor(private readonly catalog: TaskCatalog) {}

  async list(sessionId: string): Promise<TaskServiceEntry[]> {
    return await this.catalog.list(sessionId);
  }

  async add(sessionId: string, content: string): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const id = `task-${randomUUID()}`;
    const existing = await this.catalog.list(sessionId);
    const entry: TaskCatalogEntry = {
      id,
      content,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      order: existing.length,
    };
    await this.catalog.replace(sessionId, [...existing, entry]);
    return { id };
  }

  async update(
    sessionId: string,
    taskId: string,
    patch: { status?: string },
  ): Promise<{ id: string } | null> {
    const existing = await this.catalog.list(sessionId);
    const idx = existing.findIndex((entry) => entry.id === taskId);
    if (idx === -1) return null;
    const target = existing[idx]!;
    const updated: TaskCatalogEntry = {
      ...target,
      ...(patch.status ? { status: patch.status } : {}),
      updatedAt: new Date().toISOString(),
    };
    const next = [...existing];
    next[idx] = updated;
    await this.catalog.replace(sessionId, next);
    return { id: target.id };
  }

  async remove(sessionId: string, taskId: string): Promise<void> {
    const existing = await this.catalog.list(sessionId);
    const next = existing.filter((entry) => entry.id !== taskId);
    if (next.length !== existing.length) {
      await this.catalog.replace(sessionId, next);
    }
  }

  async clear(sessionId: string): Promise<void> {
    // Spec: "Completed tasks cleared." — keep only pending ones.
    const existing = await this.catalog.list(sessionId);
    const remaining = existing.filter((entry) => entry.status !== "completed");
    if (remaining.length !== existing.length) {
      await this.catalog.replace(sessionId, remaining);
    }
  }
}

/**
 * Build a TaskService for the current user's app-data folder. Mirrors the
 * existing `core-session` SQLite path so the two stores stay in sync.
 */
export function defaultTaskService(): TaskService {
  const dbPath = join(
    process.env.OPENBUDDY_DATA_DIR ?? join(homedir(), ".config", "openbuddy"),
    "sessions.db",
  );
  const catalog = new TaskCatalog({ databasePath: dbPath });
  return new TaskService(catalog);
}