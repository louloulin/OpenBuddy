/**
 * Persistence ownership contract for renderer stores.
 *
 * This is intentionally a pure classification module: it does not move
 * data by itself. It prevents P1.5 migrations from treating every
 * localStorage key as durable domain storage.
 */
export type RendererPersistenceOwner = "renderer-cache" | "pi-session" | "sqlite-ipc";

export interface RendererPersistenceClassification {
  key: string;
  owner: RendererPersistenceOwner;
  reason: string;
  migrationRequired: boolean;
}

export const RENDERER_PERSISTENCE_CLASSIFICATIONS: readonly RendererPersistenceClassification[] = [
  {
    key: "openbuddy.projects",
    owner: "sqlite-ipc",
    reason: "Project metadata and plans are durable domain data and may be shared across windows/workspaces.",
    migrationRequired: true,
  },
  {
    key: "openbuddy.projects:<scope>",
    owner: "sqlite-ipc",
    reason: "Scoped project records are durable projections; retain a compatibility import during migration.",
    migrationRequired: true,
  },
  {
    key: "openbuddy.feedback",
    owner: "sqlite-ipc",
    reason: "Feedback is session-linked durable data and should survive renderer profile resets.",
    migrationRequired: true,
  },
  {
    key: "openbuddy.drafts",
    owner: "renderer-cache",
    reason: "Draft text is an ephemeral per-renderer editing cache; debounce and clear on explicit session reset.",
    migrationRequired: false,
  },
  {
    key: "sessions-store",
    owner: "pi-session",
    reason: "Session history and conversation state are authoritative in PI JSONL/session APIs, not renderer storage.",
    migrationRequired: false,
  },
];

export function classifyRendererPersistence(key: string): RendererPersistenceClassification | undefined {
  return RENDERER_PERSISTENCE_CLASSIFICATIONS.find((entry) => entry.key === key);
}

export function assertRendererPersistenceClassification(key: string): RendererPersistenceClassification {
  const classification = classifyRendererPersistence(key);
  if (!classification) throw new Error(`Unclassified renderer persistence key: ${key}`);
  return classification;
}
