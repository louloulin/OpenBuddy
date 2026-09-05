/**
 * @openbuddy/webhook-outbox · 持久化 webhook 重试队列
 *
 * 问题：Casdoor → Gateway webhook 幂等但不持久化重试队列；SIEM/审计/支付回调
 *       一旦网络抖动就丢消息。生产必须 Outbox + 指数回退。
 *
 * 设计（transactional outbox pattern）：
 *   1. 业务事件写入 `outbox` 表（同事务内）
 *   2. 后台 worker 拉取 `pending` 记录，按 `nextAttemptAt` 升序发送
 *   3. 成功 → `status=acked`；失败 → `attempts++` + 指数回退（jitter）
 *   4. 超过 `maxAttempts` → `status=dead`（人工介入）
 *
 * 实现：纯函数 + 接口注入
 *   - InMemoryOutboxStore：测试用 / 单实例开发用
 *   - PersistentOutboxStore：Postgres / MySQL 实现（生产）
 *
 * 典型用法（Resource Gateway）：
 * ```ts
 * const outbox = new WebhookOutbox(store, { maxAttempts: 5 });
 * await outbox.enqueue({
 *   topic: "tenant.member.revoked",
 *   tenantId: "casdoor/enterprise",
 *   payload: { subject: "alice", revokedBy: "admin" },
 *   deliver: async (event) => fetch("http://localhost:8787/internal/...", {
 *     method: "POST", body: JSON.stringify(event),
 *   }),
 * });
 * // 后台：每分钟 worker 拉一批
 * setInterval(() => outbox.flush(), 60_000);
 * ```
 */

export type OutboxStatus = "pending" | "acked" | "dead";

export interface OutboxEvent {
  /** 内部唯一 ID（与外部事件 ID 同源时优先使用）。 */
  id: string;
  /** 业务主题（点号分隔）。 */
  topic: string;
  /** 多租户隔离。 */
  tenantId: string;
  /** 事件载荷。 */
  payload: Record<string, unknown>;
  /** 已尝试次数。 */
  attempts: number;
  /** 状态。 */
  status: OutboxStatus;
  /** ISO 时间戳。 */
  createdAt: string;
  /** 下次可尝试时间。 */
  nextAttemptAt: string;
  /** 最后一次错误（仅 failed 状态）。 */
  lastError?: string;
  /** 发送方标识（用于审计）。 */
  source?: string;
}

/**
 * 持久化存储接口。生产实现：Postgres / MySQL。
 * 测试实现：内存 Map。
 */
export interface OutboxStore {
  insert(event: OutboxEvent): Promise<void>;
  update(event: OutboxEvent): Promise<void>;
  loadDue(now: string, limit: number): Promise<OutboxEvent[]>;
  loadDead(limit: number): Promise<OutboxEvent[]>;
  loadById(id: string): Promise<OutboxEvent | null>;
}

export interface DeliveryContext {
  topic: string;
  tenantId: string;
  payload: Record<string, unknown>;
  attempt: number;
}

/**
 * 发送回调。实现方负责实际 HTTP / gRPC / NATS / Kafka 调用。
 * 返回 truthy 视为成功；返回 falsy 或抛错视为失败。
 */
export type DeliveryFn = (ctx: DeliveryContext) => Promise<boolean>;

export interface OutboxConfig {
  /** 单次 flush 最大拉取数。 */
  batchSize?: number;
  /** 失败最大尝试次数（默认 8）。 */
  maxAttempts?: number;
  /** 基础回退秒数（默认 30）。 */
  baseBackoffSeconds?: number;
  /** 回退上限秒数（默认 3600 = 1h）。 */
  maxBackoffSeconds?: number;
  /** Jitter 比例 0~1（默认 0.2）。 */
  jitterRatio?: number;
  /** 当前时间（测试可注入）。 */
  now?: () => Date;
  /** ID 生成器（测试可注入）。 */
  idGenerator?: () => string;
  /** Logger（可选）。 */
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}

export const DEFAULT_OUTBOX_CONFIG: Required<Omit<OutboxConfig, "logger" | "idGenerator" | "now">> = {
  batchSize: 50,
  maxAttempts: 8,
  baseBackoffSeconds: 30,
  maxBackoffSeconds: 3600,
  jitterRatio: 0.2,
};

export class WebhookOutbox {
  private readonly config: Required<Omit<OutboxConfig, "logger" | "idGenerator" | "now">>;
  private readonly nowFn: () => Date;
  private readonly idGen: () => string;
  private readonly logger: ((message: string, meta?: Record<string, unknown>) => void) | undefined;

  constructor(private readonly store: OutboxStore, config: OutboxConfig = {}) {
    this.config = { ...DEFAULT_OUTBOX_CONFIG, ...config };
    this.nowFn = config.now ?? (() => new Date());
    this.idGen = config.idGenerator ?? (() => crypto.randomUUID());
    this.logger = config.logger;
  }

  /** 把事件写入 outbox（持久化）。 */
  async enqueue(input: {
    id?: string;
    topic: string;
    tenantId: string;
    payload: Record<string, unknown>;
    source?: string;
    deliverAt?: Date;
  }): Promise<OutboxEvent> {
    const now = this.nowFn();
    const event: OutboxEvent = {
      id: input.id ?? this.idGen(),
      topic: input.topic,
      tenantId: input.tenantId,
      payload: input.payload,
      attempts: 0,
      status: "pending",
      createdAt: now.toISOString(),
      nextAttemptAt: (input.deliverAt ?? now).toISOString(),
      ...(input.source ? { source: input.source } : {}),
    };
    await this.store.insert(event);
    this.logger?.("outbox.enqueue", { id: event.id, topic: event.topic });
    return event;
  }

  /** 拉一批待发事件，逐条调用 deliver。 */
  async flush(deliver: DeliveryFn): Promise<{ sent: number; acked: number; failed: number; dead: number }> {
    const now = this.nowFn();
    const due = await this.store.loadDue(now.toISOString(), this.config.batchSize);
    let acked = 0;
    let failed = 0;
    let dead = 0;

    for (const event of due) {
      try {
        const ok = await deliver({
          topic: event.topic,
          tenantId: event.tenantId,
          payload: event.payload,
          attempt: event.attempts + 1,
        });
        if (ok) {
          const updated: OutboxEvent = { ...event, status: "acked", attempts: event.attempts + 1 };
          await this.store.update(updated);
          acked++;
          this.logger?.("outbox.acked", { id: event.id, topic: event.topic });
        } else {
          const updated = this.bumpFailure(event, "deliver returned false");
          await this.store.update(updated);
          failed++;
          if (updated.status === "dead") dead++;
        }
      } catch (err) {
        const updated = this.bumpFailure(event, err instanceof Error ? err.message : String(err));
        await this.store.update(updated);
        failed++;
        if (updated.status === "dead") dead++;
        this.logger?.("outbox.deliver.error", { id: event.id, error: updated.lastError });
      }
    }
    return { sent: due.length, acked, failed, dead };
  }

  /** 列出 dead 事件（人工介入）。 */
  async listDead(limit = 100): Promise<OutboxEvent[]> {
    return this.store.loadDead(limit);
  }

  /** 重置 dead 事件（人工 retry）。 */
  async revive(id: string): Promise<OutboxEvent | null> {
    const event = await this.store.loadById(id);
    if (!event || event.status !== "dead") return event;
    const updated: OutboxEvent = {
      ...event,
      status: "pending",
      attempts: 0,
      nextAttemptAt: this.nowFn().toISOString(),
    };
    await this.store.update(updated);
    return updated;
  }

  private bumpFailure(event: OutboxEvent, errorMessage: string): OutboxEvent {
    const attempts = event.attempts + 1;
    const status: OutboxStatus = attempts >= this.config.maxAttempts ? "dead" : "pending";
    const nextAttemptAt = this.computeNextAttempt(attempts);
    return {
      ...event,
      attempts,
      status,
      lastError: errorMessage.slice(0, 500),
      nextAttemptAt: nextAttemptAt.toISOString(),
    };
  }

  /** 指数回退 + jitter。attempts=1 → baseBackoffSeconds。 */
  private computeNextAttempt(attempts: number): Date {
    const exp = Math.min(
      this.config.baseBackoffSeconds * 2 ** Math.max(0, attempts - 1),
      this.config.maxBackoffSeconds,
    );
    const jitter = exp * this.config.jitterRatio * (Math.random() * 2 - 1);
    const delay = Math.max(1, exp + jitter);
    return new Date(this.nowFn().getTime() + delay * 1000);
  }
}

/** In-memory 实现（单实例 dev / 测试用）。 */
export class InMemoryOutboxStore implements OutboxStore {
  private readonly events = new Map<string, OutboxEvent>();

  async insert(event: OutboxEvent): Promise<void> {
    if (this.events.has(event.id)) {
      throw new Error(`Outbox event ${event.id} 已存在`);
    }
    this.events.set(event.id, event);
  }
  async update(event: OutboxEvent): Promise<void> {
    this.events.set(event.id, event);
  }
  async loadDue(now: string, limit: number): Promise<OutboxEvent[]> {
    const ts = new Date(now).getTime();
    return Array.from(this.events.values())
      .filter((e) => e.status === "pending" && new Date(e.nextAttemptAt).getTime() <= ts)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, limit);
  }
  async loadDead(limit: number): Promise<OutboxEvent[]> {
    return Array.from(this.events.values())
      .filter((e) => e.status === "dead")
      .slice(0, limit);
  }
  async loadById(id: string): Promise<OutboxEvent | null> {
    return this.events.get(id) ?? null;
  }
}
