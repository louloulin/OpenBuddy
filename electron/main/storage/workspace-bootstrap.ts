import { homedir } from "node:os";
import { join } from "node:path";
import {
  WorkspaceBootstrapStore,
  storageMetricsRegistry,
  TaskBootstrapStore,
  CollaborationBootstrapStore,
  type WorkspaceBootstrapSnapshot,
  type TaskBootstrapSnapshot,
  type CollaborationBootstrapSnapshot,
} from "@openbuddy/storage";

function agentHome(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent");
}

function databasePath(): string {
  return join(agentHome(), "openbuddy.sqlite");
}

let cached: WorkspaceBootstrapStore | undefined;

export function workspaceBootstrapStore(): WorkspaceBootstrapStore {
  return (cached ??= new WorkspaceBootstrapStore({ databasePath: databasePath() }));
}

export async function resetWorkspaceBootstrapStore(): Promise<void> {
  if (!cached) return;
  const previous = cached;
  cached = undefined;
  await previous.close();
}

export async function loadWorkspaceBootstrap(): Promise<WorkspaceBootstrapSnapshot> {
  return workspaceBootstrapStore().snapshot();
}

export function recentStorageMetrics(limit = 8) {
  return storageMetricsRegistry().recentHistory(limit);
}

let taskStore: TaskBootstrapStore | undefined;
// Stage G-1c: automation bootstrap removed; automation is owned by
// pi-background-tasks + pi-goal (passthrough).

export function taskBootstrapStore(): TaskBootstrapStore {
  return (taskStore ??= new TaskBootstrapStore({ databasePath: databasePath() }));
}

export async function loadTaskBootstrap(sessionId: string): Promise<TaskBootstrapSnapshot> {
  return taskBootstrapStore().snapshot(sessionId);
}

export async function resetTaskBootstrapStore(): Promise<void> {
  if (taskStore) {
    await taskStore.close();
    taskStore = undefined;
  }
}

let collabStore: CollaborationBootstrapStore | undefined;

export function collaborationBootstrapStore(): CollaborationBootstrapStore {
  return (collabStore ??= new CollaborationBootstrapStore({
    databasePath: databasePath(),
    stream: "collaboration:renderer-bootstrap",
  }));
}

export function loadCollaborationBootstrap(): CollaborationBootstrapSnapshot {
  return collaborationBootstrapStore().snapshot();
}

export async function resetCollaborationBootstrapStore(): Promise<void> {
  if (collabStore) {
    await collabStore.close();
    collabStore = undefined;
  }
}
