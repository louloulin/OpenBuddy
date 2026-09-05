// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableOperationStore, type DurableOperation } from "../../../packages/runtime/openbuddy-storage/src/sqlite/coordination";
import { SqliteDriver } from "../../../packages/runtime/openbuddy-storage/src/sqlite/driver";
import { openStorage, closeStorage } from "../../../packages/runtime/openbuddy-storage/src/sqlite/open-storage";

let tempDir = "";
const drivers: SqliteDriver[] = [];

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "agent-durable-ops-"));
});

afterAll(async () => {
  for (const d of drivers) d.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function createStore(): Promise<{ store: DurableOperationStore; dbPath: string }> {
  const dbPath = join(tempDir, `durable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sqlite`);
  const opened = await openStorage({ filePath: dbPath, appVersion: "openbuddy-durable-ops" });
  drivers.push(opened.driver);
  const store = new DurableOperationStore(opened.driver, () => new Date().toISOString());
  return { store, dbPath };
}

describe("DurableOperationStore 真实端到端生命周期 (无 mock)", () => {
  it("begin → claim → complete 完整成功路径", async () => {
    const { store } = await createStore();
    const begin = await store.begin("op-success-1", "idem-success-1", "agent.prompt", { prompt: "hello" });
    expect(begin.status).toBe("pending");
    expect(begin.attempt).toBe(0);

    const claimed = await store.claim("op-success-1", 1);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempt).toBe(1);
    expect(claimed?.fencingToken).toBe(1);

    const completed = await store.complete("op-success-1", { output: "world" }, 1);
    expect(completed?.status).toBe("succeeded");
    expect(completed?.result).toEqual({ output: "world" });

    // 验证 get 也读到正确状态
    const fetched = store.get("op-success-1");
    expect(fetched?.status).toBe("succeeded");
    expect(fetched?.result).toEqual({ output: "world" });
  });

  it("begin → claim → fail 失败路径保留 error 信息", async () => {
    const { store } = await createStore();
    await store.begin("op-fail-1", "idem-fail-1", "agent.prompt", { prompt: "broken" });
    await store.claim("op-fail-1", 2);
    const failed = await store.fail("op-fail-1", "工具执行超时", 2);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("工具执行超时");
    const fetched = store.get("op-fail-1");
    expect(fetched?.status).toBe("failed");
    expect(fetched?.error).toBe("工具执行超时");
  });

  it("begin 同 idempotencyKey 重复调用返回首次创建的 operation (幂等)", async () => {
    const { store } = await createStore();
    const first = await store.begin("op-idem-1", "shared-key-1", "agent.prompt", { data: 1 });
    const second = await store.begin("op-idem-1", "shared-key-1", "agent.prompt", { data: 2 });
    const third = await store.begin("op-idem-2", "shared-key-1", "agent.prompt", { data: 3 });
    expect(second.operationId).toBe(first.operationId);
    expect(third.operationId).toBe(first.operationId);
    // 重复调用不应改变 input
    const fetched = store.get(first.operationId);
    expect(fetched?.input).toEqual({ data: 1 });
  });

  it("begin 同 operationId 不同 idempotencyKey 也幂等返回首次", async () => {
    const { store } = await createStore();
    const first = await store.begin("op-same-id", "key-a", "agent.prompt", { data: "a" });
    const second = await store.begin("op-same-id", "key-b", "agent.prompt", { data: "b" });
    expect(second.operationId).toBe(first.operationId);
    expect(second.input).toEqual({ data: "a" });
  });

  it("claim 在 pending 状态可成功,在 succeeded 状态失败", async () => {
    const { store } = await createStore();
    await store.begin("op-claim-once", "idem-c1", "agent.prompt", {});
    const first = await store.claim("op-claim-once", 5);
    expect(first?.status).toBe("running");
    const second = await store.claim("op-claim-once", 5);
    expect(second).toBeUndefined(); // running 状态不能再 claim
    await store.complete("op-claim-once", { ok: true }, 5);
    const third = await store.claim("op-claim-once", 5);
    expect(third).toBeUndefined(); // succeeded 状态不能再 claim
  });

  it("fencing token: 错误的 token 完成操作时返回 undefined", async () => {
    const { store } = await createStore();
    await store.begin("op-fence", "idem-fence", "agent.prompt", {});
    await store.claim("op-fence", 100);
    // 错误的 fencing token
    const wrong = await store.complete("op-fence", { hacked: true }, 999);
    expect(wrong).toBeUndefined();
    // 状态保持 running
    const fetched = store.get("op-fence");
    expect(fetched?.status).toBe("running");
    // 正确的 token 完成
    const right = await store.complete("op-fence", { legit: true }, 100);
    expect(right?.status).toBe("succeeded");
    expect(right?.result).toEqual({ legit: true });
  });

  it("失败后可重新 claim (从 failed → running) 模拟重试", async () => {
    const { store } = await createStore();
    await store.begin("op-retry", "idem-retry", "agent.prompt", {});
    await store.claim("op-retry", 1);
    const firstAttempt = await store.fail("op-retry", "首次失败", 1);
    expect(firstAttempt?.status).toBe("failed");
    // 重新 claim
    const retry = await store.claim("op-retry", 2);
    expect(retry?.status).toBe("running");
    expect(retry?.attempt).toBe(2);
    expect(retry?.error).toBeUndefined(); // 重新 claim 时 error 被清除 (SQL 写 NULL, decode 用 spread 省略字段)
    const success = await store.complete("op-retry", { recovered: true }, 2);
    expect(success?.status).toBe("succeeded");
  });

  it("关闭并重新打开 SQLite 后 pending 操作仍然存在 (崩溃恢复)", async () => {
    const dbPath = join(tempDir, `crash-recovery-${Date.now()}.sqlite`);
    // 第一次会话: 仅 begin (模拟崩溃发生在 claim 之前)
    {
      const opened = await openStorage({ filePath: dbPath, appVersion: "openbuddy-crash-recovery" });
      const store = new DurableOperationStore(opened.driver, () => new Date().toISOString());
      await store.begin("op-crash-1", "idem-crash-1", "agent.prompt", { prompt: "long-running" });
      await closeStorage(Promise.resolve(opened));
    }
    // 模拟崩溃: 第一次 SqliteDriver 不再使用,但文件保留
    // 第二次会话: 重新打开,验证 pending 状态保持,并可被新 worker claim
    {
      const opened2 = await openStorage({ filePath: dbPath, appVersion: "openbuddy-crash-recovery" });
      const store2 = new DurableOperationStore(opened2.driver, () => new Date().toISOString());
      const fetched = store2.get("op-crash-1");
      expect(fetched).toBeDefined();
      expect(fetched?.status).toBe("pending");
      expect(fetched?.attempt).toBe(0);
      expect(fetched?.fencingToken).toBeUndefined();
      // 新 worker 用新 fencing token claim pending 操作
      const reclaimed = await store2.claim("op-crash-1", 99);
      expect(reclaimed?.status).toBe("running");
      expect(reclaimed?.attempt).toBe(1);
      expect(reclaimed?.fencingToken).toBe(99);
      const finished = await store2.complete("op-crash-1", { recovered: true }, 99);
      expect(finished?.status).toBe("succeeded");
      await closeStorage(Promise.resolve(opened2));
    }
  });

  it("关闭并重新打开 SQLite 后 running 操作可被错误 token 拒绝但正确 token 完成", async () => {
    // 验证: 已 running 的 op 重启后,错误 fencing token 完成被拒绝,正确 token 完成被允许
    const dbPath = join(tempDir, `crash-recovery-running-${Date.now()}.sqlite`);
    {
      const opened = await openStorage({ filePath: dbPath, appVersion: "openbuddy-crash-recovery-2" });
      const store = new DurableOperationStore(opened.driver, () => new Date().toISOString());
      await store.begin("op-crash-2", "idem-crash-2", "agent.prompt", { prompt: "mid-flight" });
      await store.claim("op-crash-2", 1);
      await closeStorage(Promise.resolve(opened));
    }
    {
      const opened2 = await openStorage({ filePath: dbPath, appVersion: "openbuddy-crash-recovery-2" });
      const store2 = new DurableOperationStore(opened2.driver, () => new Date().toISOString());
      const fetched = store2.get("op-crash-2");
      expect(fetched?.status).toBe("running");
      expect(fetched?.fencingToken).toBe(1);
      // 错误 token 完成: 被拒绝
      const wrongToken = await store2.complete("op-crash-2", { stolen: true }, 999);
      expect(wrongToken).toBeUndefined();
      // 正确 token 完成: 成功
      const rightToken = await store2.complete("op-crash-2", { recovered: true }, 1);
      expect(rightToken?.status).toBe("succeeded");
      expect(rightToken?.result).toEqual({ recovered: true });
      await closeStorage(Promise.resolve(opened2));
    }
  });

  it("get 不存在的 operation 返回 undefined", async () => {
    const { store } = await createStore();
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("complete 不存在的 operation 返回 undefined", async () => {
    const { store } = await createStore();
    const result = await store.complete("nonexistent", { ok: true });
    expect(result).toBeUndefined();
  });

  it("begin 同 operation_id 多次: 仅首次 INSERT, 后续返回相同记录", async () => {
    const { store } = await createStore();
    const all: DurableOperation[] = [];
    for (let i = 0; i < 5; i += 1) {
      const op = await store.begin("op-dup-id", "idem-dup", "agent.prompt", { attempt: i });
      all.push(op);
    }
    const operationIds = new Set(all.map((op) => op.operationId));
    expect(operationIds.size).toBe(1);
    // input 应保持首次 (attempt: 0)
    expect(all[0]?.input).toEqual({ attempt: 0 });
    expect(all[4]?.input).toEqual({ attempt: 0 });
  });
});
