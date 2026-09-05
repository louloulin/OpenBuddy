import { readFile, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import {
  closeStorage,
  openStorage,
  type OpenStorageResult,
  EventStore,
} from "@openbuddy/storage";

const AUDIT_FILE = "casdoor-audit.jsonl";
const MAX_EVENTS = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const AUDIT_STREAM = "casdoor:audit";
const AUDIT_APP_VERSION = "openbuddy-casdoor-audit";
const MAX_PAYLOAD_BYTES = 32 * 1024;
const IMPORTER_CONSUMER = "casdoor-audit-importer";

export type CasdoorAuditOutcome = "allow" | "deny" | "success" | "failure";

export interface CasdoorAuditEvent {
  id: string;
  at: string;
  event: string;
  outcome: CasdoorAuditOutcome;
  subject?: string;
  tenantId?: string;
  resource?: string;
  action?: string;
  reason?: string;
  code?: string;
  provider?: string;
  target?: string;
}

function auditPath(): string {
  return join(app.getPath("userData"), AUDIT_FILE);
}

function storagePath(): string {
  return join(app.getPath("userData"), "openbuddy.sqlite");
}

function retentionLimit(): number {
  const configured = Number.parseInt(process.env.OPENBUDDY_CASDOOR_AUDIT_MAX_EVENTS ?? "", 10);
  return Number.isInteger(configured) && configured >= 50 && configured <= 10_000 ? configured : MAX_EVENTS;
}

function trimPersistedAudit(content: string, maxEvents = retentionLimit(), maxBytes = MAX_FILE_BYTES): string {
  const lines = content.split("\n").filter(Boolean).slice(-maxEvents);
  let retained: string[] = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = `${lines[index]}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (retained.length > 0 && bytes + lineBytes > maxBytes) break;
    retained.unshift(line);
    bytes += lineBytes;
  }
  return retained.join("");
}

function sanitize(value: string | undefined, maxLength = 200): string | undefined {
  if (!value) return undefined;
  return value.replace(/[\r\n\t]/g, " ").slice(0, maxLength);
}

function sanitizeSensitive(value: string | undefined, maxLength = 200): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[redacted]");
  return sanitize(normalized, maxLength);
}

function sanitizeEvent(event: Omit<CasdoorAuditEvent, "id" | "at">): Omit<CasdoorAuditEvent, "id" | "at"> {
  return {
    event: sanitize(event.event, 80) ?? "unknown",
    outcome: event.outcome,
    ...(sanitize(event.subject, 160) ? { subject: sanitize(event.subject, 160) } : {}),
    ...(sanitize(event.tenantId, 160) ? { tenantId: sanitize(event.tenantId, 160) } : {}),
    ...(sanitize(event.resource, 200) ? { resource: sanitize(event.resource, 200) } : {}),
    ...(sanitize(event.action, 80) ? { action: sanitize(event.action, 80) } : {}),
    ...(sanitizeSensitive(event.reason, 240) ? { reason: sanitizeSensitive(event.reason, 240) } : {}),
    ...(sanitize(event.code, 80) ? { code: sanitize(event.code, 80) } : {}),
    ...(sanitize(event.provider, 80) ? { provider: sanitize(event.provider, 80) } : {}),
    ...(sanitize(event.target, 200) ? { target: sanitize(event.target, 200) } : {}),
  };
}

function payloadHashFor(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

interface AuditStorage {
  store: EventStore;
  close: () => Promise<void>;
}

const storagePromises = new Map<string, Promise<AuditStorage>>();

async function openAuditStorage(): Promise<AuditStorage> {
  const path = storagePath();
  const existing = storagePromises.get(path);
  if (existing) return existing;
  const created = (async () => {
    const openedPromise = openStorage({ filePath: path, appVersion: AUDIT_APP_VERSION });
    const opened = await openedPromise;
    return { store: new EventStore(opened.driver), close: () => closeStorage(openedPromise) };
  })();
  storagePromises.set(path, created);
  return created;
}

let legacyImportPromise: Promise<void> | null = null;
async function importLegacyIfPresent(store: EventStore): Promise<void> {
  if (legacyImportPromise) return legacyImportPromise;
  legacyImportPromise = (async () => {
    const path = auditPath();
    let content: string;
    try { content = await readFile(path, "utf8"); } catch { return; }
    const lines = content.split("\n").filter(Boolean);
    let lastSeq = 0;
    try { lastSeq = store.cursor(IMPORTER_CONSUMER, AUDIT_STREAM)?.lastSeq ?? 0; } catch { /* fresh */ }
    let imported = 0;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Partial<CasdoorAuditEvent>;
        if (!parsed || typeof parsed.id !== "string" || typeof parsed.at !== "string") continue;
        const event = parsed as CasdoorAuditEvent;
        lastSeq += 1;
        const payload = { ...event };
        const envelope = {
          id: event.id,
          stream: AUDIT_STREAM,
          streamSequence: lastSeq,
          type: `casdoor.audit.${event.outcome}`,
          occurredAt: event.at,
          actor: event.subject ?? "system",
          payload,
          payloadHash: payloadHashFor(payload),
          idempotencyKey: event.id,
        };
        store.append(envelope);
        imported += 1;
        if (imported >= retentionLimit()) break;
      } catch { /* skip malformed */ }
    }
    if (imported > 0) {
      store.setCursor(IMPORTER_CONSUMER, AUDIT_STREAM, lastSeq);
      await rm(path, { force: true }).catch(() => undefined);
    }
  })();
  return legacyImportPromise;
}

export class CasdoorAuditService {
  private readonly memory: CasdoorAuditEvent[] = [];
  private persistQueue: Promise<void> = Promise.resolve();
  private importOnce = importLegacyIfPresent;

  async record(event: Omit<CasdoorAuditEvent, "id" | "at">): Promise<void> {
    const entry: CasdoorAuditEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...sanitizeEvent(event),
    };
    this.memory.push(entry);
    const limit = retentionLimit();
    if (this.memory.length > limit) this.memory.splice(0, this.memory.length - limit);

    let payload: Record<string, unknown>;
    try {
      const raw = JSON.stringify(entry);
      if (raw.length > MAX_PAYLOAD_BYTES) {
        const truncated: CasdoorAuditEvent = { ...entry, reason: (entry.reason ?? "").slice(0, 256) + " [truncated]" };
        payload = { ...truncated } as Record<string, unknown>;
      } else {
        payload = { ...entry } as Record<string, unknown>;
      }
    } catch {
      payload = { id: entry.id, at: entry.at, event: entry.event, outcome: entry.outcome } as Record<string, unknown>;
    }

    const queueNext = this.persistQueue.then(async () => {
      try {
        const { store } = await openAuditStorage();
        await this.importOnce(store);
        const cursor = store.cursor(IMPORTER_CONSUMER, AUDIT_STREAM);
        const lastSeq = cursor?.lastSeq ?? 0;
        const envelope = {
          id: entry.id,
          stream: AUDIT_STREAM,
          streamSequence: lastSeq + 1,
          type: `casdoor.audit.${entry.outcome}`,
          occurredAt: entry.at,
          actor: entry.subject ?? "system",
          payload,
          payloadHash: payloadHashFor(payload),
          idempotencyKey: entry.id,
        };
        store.append(envelope);
        store.setCursor(IMPORTER_CONSUMER, AUDIT_STREAM, envelope.streamSequence);
      } catch {
        // Audit failure must not break login or authorization.
      }
    });
    this.persistQueue = queueNext.catch(() => undefined);
    await queueNext;
  }

  async list(tenantId?: string): Promise<CasdoorAuditEvent[]> {
    const unique = new Map<string, CasdoorAuditEvent>();
    for (const event of this.memory) unique.set(event.id, event);
    try {
      const { store } = await openAuditStorage();
      await this.importOnce(store);
      const rows = store.replay(AUDIT_STREAM, 0, retentionLimit());
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.payload_json) as CasdoorAuditEvent;
          if (parsed && typeof parsed.id === "string" && typeof parsed.at === "string") {
            unique.set(parsed.id, parsed);
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* storage unavailable — fall through */ }
    return [...unique.values()]
      .filter((event) => !tenantId || event.tenantId === tenantId)
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, retentionLimit());
  }

  async close(): Promise<void> {
    const storage = storagePromises.get(storagePath());
    storagePromises.clear();
    if (storage) {
      const handle = await storage.catch(() => undefined);
      if (handle) await handle.close().catch(() => undefined);
    }
  }
}

export const __casdoorAuditTestables = { sanitizeEvent, trimPersistedAudit };

export const casdoorAudit = new CasdoorAuditService();
