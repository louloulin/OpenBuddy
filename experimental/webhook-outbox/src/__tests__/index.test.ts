import { describe, expect, it, vi } from "vitest";
import { InMemoryOutboxStore, WebhookOutbox, type DeliveryFn } from "../index";

describe("WebhookOutbox", () => {
  it("enqueue persists and flush delivers pending events", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new WebhookOutbox(store);
    const deliver = vi.fn(async () => true) as DeliveryFn;

    await outbox.enqueue({
      topic: "tenant.member.added",
      tenantId: "casdoor/enterprise",
      payload: { subject: "alice" },
    });

    const r = await outbox.flush(deliver);
    expect(r.sent).toBe(1);
    expect(r.acked).toBe(1);
    expect(r.failed).toBe(0);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      topic: "tenant.member.added",
      tenantId: "casdoor/enterprise",
      payload: { subject: "alice" },
      attempt: 1,
    });
  });

  it("skips events with future nextAttemptAt", async () => {
    const store = new InMemoryOutboxStore();
    const future = new Date(Date.now() + 60_000);
    const outbox = new WebhookOutbox(store);
    const deliver = vi.fn(async () => true) as DeliveryFn;

    await outbox.enqueue({
      topic: "t1",
      tenantId: "t",
      payload: {},
      deliverAt: future,
    });
    const r = await outbox.flush(deliver);
    expect(r.sent).toBe(0);
    expect(deliver).toHaveBeenCalledTimes(0);
  });

  it("retries failed deliveries with exponential backoff", async () => {
    const store = new InMemoryOutboxStore();
    let attempts = 0;
    let nowMs = 1_700_000_000_000;
    const outbox = new WebhookOutbox(store, {
      baseBackoffSeconds: 1,
      maxBackoffSeconds: 60,
      now: () => new Date(nowMs),
    });
    const deliver: DeliveryFn = async () => {
      attempts++;
      if (attempts < 3) return false;
      return true;
    };

    await outbox.enqueue({ topic: "t2", tenantId: "t", payload: {} });
    let r = await outbox.flush(deliver);
    expect(r.failed).toBe(1);
    expect(r.acked).toBe(0);

    // 推进时间让 backoff 过期
    nowMs += 5000;
    r = await outbox.flush(deliver);
    expect(r.failed).toBe(1);

    nowMs += 5000;
    r = await outbox.flush(deliver);
    expect(r.acked).toBe(1);
    expect(attempts).toBe(3);
  });

  it("marks event as dead after maxAttempts", async () => {
    const store = new InMemoryOutboxStore();
    let nowMs = 1_700_000_000_000;
    const outbox = new WebhookOutbox(store, {
      maxAttempts: 3,
      baseBackoffSeconds: 1,
      now: () => new Date(nowMs),
    });
    const deliver: DeliveryFn = async () => false;

    await outbox.enqueue({ topic: "t3", tenantId: "t", payload: {} });

    for (let i = 0; i < 3; i++) {
      nowMs += 5000;
      await outbox.flush(deliver);
    }
    const dead = await outbox.listDead();
    expect(dead).toHaveLength(1);
    expect(dead[0]!.attempts).toBe(3);
    expect(dead[0]!.lastError).toBe("deliver returned false");
  });

  it("treats thrown errors as failure", async () => {
    const store = new InMemoryOutboxStore();
    let nowMs = 1_700_000_000_000;
    const outbox = new WebhookOutbox(store, {
      maxAttempts: 2,
      baseBackoffSeconds: 1, // 关键：缩短 backoff 让测试快速通过
      now: () => new Date(nowMs),
    });
    const deliver: DeliveryFn = async () => {
      throw new Error("network down");
    };
    await outbox.enqueue({ topic: "t4", tenantId: "t", payload: {} });

    // 第 1 次：失败但仍 pending
    let r = await outbox.flush(deliver);
    expect(r.failed).toBe(1);
    expect(r.dead).toBe(0);

    // 第 2 次：达到 maxAttempts，标记为 dead
    nowMs += 5000;
    r = await outbox.flush(deliver);
    expect(r.failed).toBe(1);
    expect(r.dead).toBe(1);
  });

  it("revive moves dead back to pending with attempts=0", async () => {
    const store = new InMemoryOutboxStore();
    let nowMs = 1_700_000_000_000;
    const outbox = new WebhookOutbox(store, { maxAttempts: 1, now: () => new Date(nowMs) });
    await outbox.enqueue({ id: "evt-revive", topic: "t5", tenantId: "t", payload: {} });

    await outbox.flush(async () => false);

    const revived = await outbox.revive("evt-revive");
    expect(revived?.status).toBe("pending");
    expect(revived?.attempts).toBe(0);
  });

  it("respects batchSize", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new WebhookOutbox(store, { batchSize: 3 });
    const deliver = vi.fn(async () => true) as DeliveryFn;

    for (let i = 0; i < 10; i++) {
      await outbox.enqueue({ topic: `t-${i}`, tenantId: "t", payload: {} });
    }
    const r1 = await outbox.flush(deliver);
    expect(r1.sent).toBe(3);
    const r2 = await outbox.flush(deliver);
    expect(r2.sent).toBe(3);
    const r3 = await outbox.flush(deliver);
    expect(r3.sent).toBe(3);
    const r4 = await outbox.flush(deliver);
    expect(r4.sent).toBe(1);
  });

  it("supports custom idGenerator and now", async () => {
    const store = new InMemoryOutboxStore();
    let nowMs = 1_700_000_000_000;
    let counter = 0;
    const outbox = new WebhookOutbox(store, {
      now: () => new Date(nowMs),
      idGenerator: () => `evt_${++counter}`,
    });
    const event = await outbox.enqueue({ topic: "t6", tenantId: "t", payload: {} });
    expect(event.id).toBe("evt_1");
    expect(event.createdAt).toBe("2023-11-14T22:13:20.000Z");
  });
});
