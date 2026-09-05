import { hashRedactedValue, redactStorageValue } from "./redact";

export type StorageReadMode = "read_old" | "read_new" | "shadow" | "new_with_fallback";

export interface StorageEventEnvelope {
  id: string;
  stream: string;
  streamSequence: number;
  type: string;
  occurredAt: string;
  actor: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  idempotencyKey?: string;
}

export interface IdempotentResult {
	found: boolean
	value: unknown
}

export interface StorageTransaction {
	findIdempotentResult(key: string): Promise<IdempotentResult>;
  appendEvent(event: StorageEventEnvelope): Promise<void>;
  saveIdempotentResult(key: string, result: unknown): Promise<void>;
  applyProjection(event: StorageEventEnvelope, result: unknown): Promise<void>;
}

export interface StorageDriver {
  migrate(targetVersion?: number): Promise<MigrationResult> | MigrationResult;
  transaction<T>(callback: (transaction: StorageTransaction) => Promise<T> | T): Promise<T>;
  integrityCheck(): Promise<{ ok: boolean; detail?: string; foreignKeys?: string }>;
  backup(destination: string): Promise<{ path: string; schemaVersion: number }>;
  close(): void;
}

export interface MigrationResult {
  applied: number;
  finalVersion: number;
  history: readonly { version: number; status: "applied" | "failed"; detail?: string }[];
}

export interface StorageCommand<T> {
  id: string;
  stream: string;
  streamSequence: number;
  type: string;
  actor: string;
  idempotencyKey: string;
  payload: unknown;
  apply: (transaction: StorageTransaction, event: StorageEventEnvelope) => Promise<T> | T;
}

export interface StorageGatewayOptions {
  now?: () => Date;
  notifyCommitted?: (event: StorageEventEnvelope) => void;
}

export function createStorageEvent(
  command: Pick<StorageCommand<unknown>, "id" | "stream" | "streamSequence" | "type" | "actor" | "idempotencyKey" | "payload">,
  occurredAt: Date,
): StorageEventEnvelope {
  const redacted = redactStorageValue(command.payload);
  const payload = redacted && typeof redacted === "object" && !Array.isArray(redacted)
    ? redacted as Record<string, unknown>
    : { value: redacted };
  return {
    id: command.id,
    stream: command.stream,
    streamSequence: command.streamSequence,
    type: command.type,
    occurredAt: occurredAt.toISOString(),
    actor: command.actor,
    payload,
    payloadHash: hashRedactedValue(command.payload),
    idempotencyKey: command.idempotencyKey,
  };
}

export class StorageGateway {
  private readonly now: () => Date;
  private readonly notifyCommitted?: (event: StorageEventEnvelope) => void;

  constructor(private readonly driver: StorageDriver, options: StorageGatewayOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
    this.notifyCommitted = options.notifyCommitted;
  }

  async execute<T>(command: StorageCommand<T>): Promise<T> {
    const event = createStorageEvent(command, this.now());
    let committed = false;
    const result = await this.driver.transaction(async (transaction) => {
      const existing = await transaction.findIdempotentResult(command.idempotencyKey);
      if (existing.found) return existing.value as T;
      const result = await command.apply(transaction, event);
      await transaction.appendEvent(event);
      await transaction.saveIdempotentResult(command.idempotencyKey, result);
      await transaction.applyProjection(event, result);
      committed = true;
      return result;
    });
    if (committed) this.notifyCommitted?.(event);
    return result;
  }
}
