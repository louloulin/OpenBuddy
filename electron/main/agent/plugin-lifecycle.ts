export type PluginTransactionKind =
  | "profile-reload"
  | "pi-reload"
  | "plugin-enable"
  | "plugin-config"
  | "plugin-reset"
  | "plugin-reload";

export type PluginTransactionPhase =
  | "prepare"
  | "cordis"
  | "artifacts"
  | "pi"
  | "mcp"
  | "renderer"
  | "rollback"
  | "commit";

export type PluginTransactionEvent = {
  transactionId: string;
  kind: PluginTransactionKind;
  target: string;
  phase?: PluginTransactionPhase;
  surface?: string;
  error?: string;
  rolledBack?: boolean;
  receipts?: Record<string, PluginTransactionReceipt>;
  requiredReceipts?: string[];
};

export type PluginTransactionReceipt = {
  surface: string;
  preparedAt: string;
  details?: Record<string, unknown>;
};

export type PluginTransactionContext = {
  transactionId: string;
  kind: PluginTransactionKind;
  target: string;
  phase: (phase: PluginTransactionPhase, surface?: string) => void;
  receipt: (surface: string, details?: Record<string, unknown>) => void;
  /**
   * 声明提交前必须有 `surface` 的 receipt。重复声明同一 surface 不会重复报错。
   * 该声明只在本事务内生效,不进入历史事件。
   */
  requireReceipt: (surface: string) => void;
  /**
   * 等待指定 surface 的 receipt 出现。
   * - 若 receipt 已经存在,立即 resolve;
   * - 否则挂起直到 `receipt()` 被调用,或 `timeoutMs` 触发 reject(默认 5s);
   * - 同一 surface 多次调用都会等到各自的 receipt 写入,适合多个 awaiter。
   */
  awaitSurfaceReceipt: (surface: string, timeoutMs?: number) => Promise<void>;
  /** 当前事务已声明需要 receipt 的 surface 列表(只读快照)。 */
  readonly requiredReceipts: readonly string[];
};

export function markPluginTransactionRolledBack(error: unknown): Error & { rolledBack: true } {
  const result = error instanceof Error ? error : new Error(String(error));
  Object.assign(result, { rolledBack: true as const });
  return result as Error & { rolledBack: true };
}

export class PluginTransactionRequiredReceiptMissingError extends Error {
  readonly transactionId: string;
  readonly missingSurfaces: readonly string[];
  constructor(transactionId: string, missingSurfaces: readonly string[]) {
    super(`plugin transaction ${transactionId} missing required receipts: ${missingSurfaces.join(", ")}`);
    this.name = "PluginTransactionRequiredReceiptMissingError";
    this.transactionId = transactionId;
    this.missingSurfaces = missingSurfaces;
  }
}

/**
 * `Schedule` receives the transaction kind and target alongside the operation
 * so the host can route each transaction into the matching lifecycle queue
 * (`init` / `dispose` / `preset` / `profile` / `reload`). Callers that don't
 * need kind-aware scheduling can pass a one-arg adapter that ignores the
 * metadata.
 */
type Schedule = <T>(
  kind: PluginTransactionKind,
  target: string,
  operation: () => Promise<T>,
) => Promise<T>;
type Emit = (
  type:
    | "plugin/transaction-start"
    | "plugin/transaction-phase"
    | "plugin/transaction-receipt"
    | "plugin/transaction-complete"
    | "plugin/transaction-failed",
  payload: PluginTransactionEvent,
) => void;
type Commit = (payload: PluginTransactionEvent) => Promise<void>;
type Register = (transaction: PluginTransactionContext) => void;
type Unregister = (transactionId: string) => void;

interface PluginLifecycleQueueOptions {
  register?: Register;
  unregister?: Unregister;
  /** 默认 receipt 等待超时,默认 5000ms。 */
  defaultAwaitTimeoutMs?: number;
}

/** Serializes plugin mutations with the host lifecycle and exposes one wire shape. */
export class PluginLifecycleQueue {
  private tail: Promise<void> = Promise.resolve();
  private sequence = 0;
  private readonly register?: Register;
  private readonly unregister?: Unregister;
  private readonly defaultAwaitTimeoutMs: number;

  constructor(
    private readonly schedule: Schedule,
    private readonly emit: Emit,
    private readonly commit?: Commit,
    options: PluginLifecycleQueueOptions = {},
  ) {
    this.register = options.register;
    this.unregister = options.unregister;
    this.defaultAwaitTimeoutMs = options.defaultAwaitTimeoutMs ?? 5000;
  }

  enqueue<T>(kind: PluginTransactionKind, target: string, operation: (transaction: PluginTransactionContext) => Promise<T>): Promise<T> {
    const run = this.tail.then(
      () => this.execute(kind, target, operation),
      () => this.execute(kind, target, operation),
    );
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private execute<T>(kind: PluginTransactionKind, target: string, operation: (transaction: PluginTransactionContext) => Promise<T>): Promise<T> {
    return this.schedule(kind, target, async () => {
      const metadata = {
        transactionId: `plugin-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`,
        kind,
        target,
      } satisfies PluginTransactionEvent;
      this.emit("plugin/transaction-start", metadata);
      const receipts: Record<string, PluginTransactionReceipt> = {};
      const requiredSurfaces = new Set<string>();
      const waiters = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>>();
      const emitReceipts = () => {
        this.emit("plugin/transaction-receipt", { ...metadata, receipts: { ...receipts } });
      };
      const resolveWaiters = (surface: string) => {
        const pending = waiters.get(surface);
        if (!pending) return;
        waiters.delete(surface);
        for (const entry of pending) {
          clearTimeout(entry.timer);
          entry.resolve();
        }
      };
      const rejectAllWaiters = (error: Error) => {
        for (const [, pending] of waiters) {
          for (const entry of pending) {
            clearTimeout(entry.timer);
            entry.reject(error);
          }
        }
        waiters.clear();
      };
      const transaction: PluginTransactionContext = {
        ...metadata,
        phase: (phase, surface) => this.emit("plugin/transaction-phase", { ...metadata, phase, ...(surface ? { surface } : {}) }),
        receipt: (surface, details) => {
          if (!surface.trim()) throw new Error("plugin transaction receipt surface is required");
          const alreadyPresent = Boolean(receipts[surface]);
          const receipt: PluginTransactionReceipt = {
            surface,
            preparedAt: new Date().toISOString(),
            ...(details ? { details } : {}),
          };
          receipts[surface] = receipt;
          if (!alreadyPresent) {
            // notify waiters immediately so they unblock; the consolidated
            // `plugin/transaction-receipt` event is emitted once on commit.
            resolveWaiters(surface);
          }
        },
        requireReceipt: (surface) => {
          if (!surface.trim()) throw new Error("plugin transaction requireReceipt surface is required");
          requiredSurfaces.add(surface);
        },
        awaitSurfaceReceipt: async (surface, timeoutMs) => {
          if (!surface.trim()) throw new Error("plugin transaction awaitSurfaceReceipt surface is required");
          if (receipts[surface]) return;
          const budget = typeof timeoutMs === "number" && timeoutMs >= 0 ? timeoutMs : this.defaultAwaitTimeoutMs;
          return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              const pending = waiters.get(surface);
              if (pending) {
                pending.splice(pending.findIndex((entry) => entry.timer === timer), 1);
                if (pending.length === 0) waiters.delete(surface);
              }
              reject(new Error(`plugin transaction ${metadata.transactionId} timed out waiting for receipt on surface "${surface}" after ${budget}ms`));
            }, budget);
            const entry = { resolve, reject: reject as (error: Error) => void, timer };
            const existing = waiters.get(surface);
            if (existing) existing.push(entry);
            else waiters.set(surface, [entry]);
          });
        },
        get requiredReceipts() {
          return Array.from(requiredSurfaces);
        },
      };
      try {
        this.register?.(transaction);
        const result = await operation(transaction);
        const missing = Array.from(requiredSurfaces).filter((surface) => !receipts[surface]);
        if (missing.length > 0) {
          rejectAllWaiters(new PluginTransactionRequiredReceiptMissingError(metadata.transactionId, missing));
          throw new PluginTransactionRequiredReceiptMissingError(metadata.transactionId, missing);
        }
        rejectAllWaiters(new Error(`plugin transaction ${metadata.transactionId} completed before receipt waiters could resolve`));
        if (this.commit) {
          await this.commit({
            ...metadata,
            receipts: { ...receipts },
            ...(requiredSurfaces.size > 0 ? { requiredReceipts: Array.from(requiredSurfaces) } : {}),
          });
        }
        // Emit one consolidated receipt event so consumers can observe the final
        // surface receipts alongside the commit/complete pair.
        if (Object.keys(receipts).length > 0) {
          emitReceipts();
        }
        this.emit("plugin/transaction-complete", metadata);
        return result;
      } catch (error) {
        const rolledBack = error && typeof error === "object" && (error as { rolledBack?: unknown }).rolledBack === true;
        rejectAllWaiters(error instanceof Error ? error : new Error(String(error)));
        if (rolledBack && this.commit) {
          await this.commit({
            ...metadata,
            rolledBack: true,
            receipts: { ...receipts },
            ...(requiredSurfaces.size > 0 ? { requiredReceipts: Array.from(requiredSurfaces) } : {}),
          });
        }
        this.emit("plugin/transaction-failed", {
          ...metadata,
          error: String(error),
          ...(rolledBack ? { rolledBack: true } : {}),
        });
        throw error;
      } finally {
        this.unregister?.(metadata.transactionId);
      }
    });
  }
}
