import { CollaborationContractStore, type CollaborationTaskContract } from "../sqlite/collaboration-state";
import { CollaborationInboxCursorStore, type CollaborationInboxCursor } from "../sqlite/collaboration-state";
import { SyncEventCollection } from "../sqlite/sync-event-collection";
import { redactStorageValue } from "../driver/redact";

export interface CollaborationBootstrapContract {
  taskId: string;
  mode: string;
  redacted: boolean;
}

export interface CollaborationBootstrapCursor {
  principalId: string;
  lastReadEventId?: string;
  acknowledgedEventCount: number;
}

export interface CollaborationBootstrapEvent {
  id: string;
  redacted: boolean;
  payloadKeys: string[];
}

export interface CollaborationBootstrapSnapshot {
  schema: "openbuddy.storage-collaboration-bootstrap.v1";
  contracts: CollaborationBootstrapContract[];
  cursors: CollaborationBootstrapCursor[];
  recentEvents: CollaborationBootstrapEvent[];
  capturedAt: string;
}

export interface CollaborationBootstrapOptions {
  databasePath: string;
  appVersion?: string;
  stream: string;
  recentEventLimit?: number;
  now?: () => string;
}

export function summarizeContract<T extends CollaborationTaskContract>(contract: T): CollaborationBootstrapContract {
  const redacted = redactStorageValue(contract) as Record<string, unknown>;
  return { taskId: String(redacted.taskId ?? contract.taskId), mode: String(redacted.mode ?? contract.mode), redacted: true };
}

export function summarizeCursor(cursor: CollaborationInboxCursor): CollaborationBootstrapCursor {
  return {
    principalId: cursor.principalId,
    ...(cursor.lastReadEventId ? { lastReadEventId: cursor.lastReadEventId } : {}),
    acknowledgedEventCount: cursor.acknowledgedEventIds.length,
  };
}

export function summarizeEvent(value: Record<string, unknown>): CollaborationBootstrapEvent {
  const id = typeof value.id === "string" ? value.id : "unknown";
  const payloadKeys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).filter((key) => key !== "id") : [];
  return { id, redacted: true, payloadKeys };
}

export class CollaborationBootstrapStore {
  private contractStore?: CollaborationContractStore;
  private cursorStore?: CollaborationInboxCursorStore;
  private syncEvents?: SyncEventCollection<{ id: string } & Record<string, unknown>>;

  constructor(private readonly options: CollaborationBootstrapOptions) {}

  private contractInstance(): CollaborationContractStore {
    return (this.contractStore ??= new CollaborationContractStore({ databasePath: this.options.databasePath, ...(this.options.appVersion ? { appVersion: `${this.options.appVersion}-contracts` } : { appVersion: "openbuddy-collaboration-bootstrap-contracts" }) }));
  }

  private cursorInstance(): CollaborationInboxCursorStore {
    return (this.cursorStore ??= new CollaborationInboxCursorStore({ databasePath: this.options.databasePath, ...(this.options.appVersion ? { appVersion: `${this.options.appVersion}-cursors` } : { appVersion: "openbuddy-collaboration-bootstrap-cursors" }) }));
  }

  private syncInstance(): SyncEventCollection<{ id: string } & Record<string, unknown>> {
    return (this.syncEvents ??= new SyncEventCollection<{ id: string } & Record<string, unknown>>({ databasePath: this.options.databasePath, stream: this.options.stream, ...(this.options.appVersion ? { appVersion: `${this.options.appVersion}-sync` } : { appVersion: "openbuddy-collaboration-bootstrap-sync" }) }));
  }

  snapshot(): CollaborationBootstrapSnapshot {
    const contracts = this.contractInstance().list().map(summarizeContract);
    const cursors = this.cursorInstance().list().map(summarizeCursor);
    const limit = this.options.recentEventLimit ?? 16;
    const events = this.syncInstance().list().slice(-limit).map((entry) => summarizeEvent(entry as Record<string, unknown>));
    return {
      schema: "openbuddy.storage-collaboration-bootstrap.v1",
      contracts,
      cursors,
      recentEvents: events,
      capturedAt: (this.options.now ?? (() => new Date().toISOString()))(),
    };
  }

  async close(): Promise<void> {
    const closes: Array<Promise<void> | void> = [];
    if (this.contractStore) closes.push(this.contractStore.close());
    if (this.cursorStore) closes.push(this.cursorStore.close());
    if (this.syncEvents) closes.push(this.syncEvents.close());
    this.contractStore = undefined;
    this.cursorStore = undefined;
    this.syncEvents = undefined;
    await Promise.all(closes);
  }
}
