import { describe, expect, it, vi } from "vitest";
import { markPluginTransactionRolledBack, PluginLifecycleQueue, PluginTransactionRequiredReceiptMissingError } from "./plugin-lifecycle";

describe("PluginLifecycleQueue", () => {
  it("serializes mutations and emits correlated lifecycle events", async () => {
    const events: Array<[string, string, string]> = [];
    const phases: string[] = [];
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const schedule = async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation();
    const queue = new PluginLifecycleQueue(schedule, (type, payload) => {
      events.push([type, payload.transactionId, payload.target]);
      if (type === "plugin/transaction-phase") phases.push(`${payload.phase}:${payload.surface}`);
    });

    const first = queue.enqueue("plugin-reload", "one", async (transaction) => {
      order.push("one:start");
      transaction.phase("prepare", "test");
      await firstReleased;
      order.push("one:end");
      return 1;
    });
    const second = queue.enqueue("plugin-config", "two", async () => {
      order.push("two");
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(["one:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["one:start", "one:end", "two"]);
    expect(events.map(([type]) => type)).toEqual([
      "plugin/transaction-start",
      "plugin/transaction-phase",
      "plugin/transaction-complete",
      "plugin/transaction-start",
      "plugin/transaction-complete",
    ]);
    const byTarget = (target: string) => events.filter(([, , eventTarget]) => eventTarget === target);
    expect(new Set(byTarget("one").map(([, transactionId]) => transactionId)).size).toBe(1);
    expect(new Set(byTarget("two").map(([, transactionId]) => transactionId)).size).toBe(1);
    expect(byTarget("one")[0]?.[1]).not.toBe(byTarget("two")[0]?.[1]);
    expect(phases).toEqual(["prepare:test"]);
  });

  it("emits a failure event and keeps the queue usable", async () => {
    const events: Array<{ type: string; target: string; error?: string }> = [];
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      (type, payload) => events.push({ type, target: payload.target, ...(payload.error ? { error: payload.error } : {}) }),
    );
    const failed = vi.fn(async () => { throw new Error("reload failed"); });
    await expect(queue.enqueue("pi-reload", "broken", failed)).rejects.toThrow("reload failed");
    await expect(queue.enqueue("pi-reload", "recovered", async () => "ok")).resolves.toBe("ok");
    expect(events).toEqual([
      { type: "plugin/transaction-start", target: "broken" },
      { type: "plugin/transaction-failed", target: "broken", error: "Error: reload failed" },
      { type: "plugin/transaction-start", target: "recovered" },
      { type: "plugin/transaction-complete", target: "recovered" },
    ]);
    expect(failed).toHaveBeenCalledOnce();
  });

  it("marks a failed transaction as rolled back when the old state was restored", async () => {
    const events: Array<{ type: string; rolledBack?: boolean }> = [];
    const commits: Array<{ transactionId: string; rolledBack?: boolean }> = [];
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      (type, payload) => events.push({ type, rolledBack: payload.rolledBack }),
      async (payload) => { commits.push({ transactionId: payload.transactionId, rolledBack: payload.rolledBack }); },
    );
    await expect(queue.enqueue("profile-reload", "profile", async () => {
      throw markPluginTransactionRolledBack(new Error("candidate rejected"));
    })).rejects.toThrow("candidate rejected");
    expect(events).toEqual([
      { type: "plugin/transaction-start", rolledBack: undefined },
      { type: "plugin/transaction-failed", rolledBack: true },
    ]);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.rolledBack).toBe(true);
  });

  it("persists one commit marker before publishing completion", async () => {
    const order: string[] = [];
    let committedReceipts: Record<string, { surface: string }> | undefined;
    let commitRan = false;
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      (type) => order.push(type),
      async (payload) => { commitRan = true; committedReceipts = payload.receipts as Record<string, { surface: string }> | undefined; },
    );
    await queue.enqueue("plugin-reload", "one", async (transaction) => {
      transaction.receipt("pi", { loaded: 2 });
      transaction.receipt("mcp");
      return "ok";
    });
    expect(order).toEqual([
      "plugin/transaction-start",
      "plugin/transaction-receipt",
      "plugin/transaction-complete",
    ]);
    expect(commitRan).toBe(true);
    expect(committedReceipts).toEqual({
      pi: expect.objectContaining({ surface: "pi" }),
      mcp: expect.objectContaining({ surface: "mcp" }),
    });
  });

  it("registers the transaction for the duration of the operation then unregisters it", async () => {
    const active: string[] = [];
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      () => undefined,
      undefined,
      {
        register: (transaction) => active.push(transaction.transactionId),
        unregister: (transactionId) => {
          const idx = active.indexOf(transactionId);
          if (idx >= 0) active.splice(idx, 1);
        },
      },
    );
    const transactionId = await new Promise<string>((resolve) => {
      void queue.enqueue("plugin-reload", "with-register", async (transaction) => {
        expect(active).toContain(transaction.transactionId);
        resolve(transaction.transactionId);
        return "ok";
      });
    });
    await Promise.resolve();
    expect(active).not.toContain(transactionId);
  });

  it("requireReceipt throws when required surface never reports a receipt", async () => {
    const events: Array<{ type: string; error?: string; requiredReceipts?: readonly string[] }> = [];
    const commits: Array<{ requiredReceipts?: readonly string[] }> = [];
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      (type, payload) => events.push({ type, error: payload.error, requiredReceipts: payload.requiredReceipts }),
      async (payload) => { commits.push({ requiredReceipts: payload.requiredReceipts }); },
    );
    await expect(queue.enqueue("profile-reload", "renderer-only", async (transaction) => {
      transaction.requireReceipt("renderer");
      transaction.receipt("cordis");
      // missing `renderer`
    })).rejects.toBeInstanceOf(PluginTransactionRequiredReceiptMissingError);
    const failed = events.find((event) => event.type === "plugin/transaction-failed");
    expect(failed?.error).toMatch(/missing required receipts: renderer/);
    // Commit must NOT run when required receipts are missing.
    expect(commits).toEqual([]);
  });

  it("requireReceipt passes once all declared surfaces report a receipt", async () => {
    const events: Array<{ type: string; requiredReceipts?: readonly string[] }> = [];
    const commits: Array<{ requiredReceipts?: readonly string[] }> = [];
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      (type, payload) => events.push({ type, requiredReceipts: payload.requiredReceipts }),
      async (payload) => { commits.push({ requiredReceipts: payload.requiredReceipts }); },
    );
    await expect(queue.enqueue("profile-reload", "with-renderer", async (transaction) => {
      transaction.requireReceipt("renderer");
      transaction.receipt("cordis");
      transaction.receipt("renderer");
    })).resolves.toBeUndefined();
    const complete = events.find((event) => event.type === "plugin/transaction-complete");
    expect(complete).toBeTruthy();
    expect(commits.at(-1)?.requiredReceipts).toEqual(["renderer"]);
  });

  it("awaitSurfaceReceipt resolves when receipt() lands later", async () => {
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      () => undefined,
      undefined,
      { defaultAwaitTimeoutMs: 200 },
    );
    let capturedTransaction: { receipt: (surface: string) => void } | undefined;
    const operationDone = new Promise<void>((resolve, reject) => {
      void queue.enqueue("profile-reload", "await-renderer", async (transaction) => {
        capturedTransaction = transaction;
        try {
          await transaction.awaitSurfaceReceipt("renderer", 200);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    // Give the operation a tick so it can register the waiter.
    await Promise.resolve();
    // Fire the receipt asynchronously, after awaitSurfaceReceipt is set up.
    setTimeout(() => {
      capturedTransaction?.receipt("renderer");
    }, 5);
    await expect(operationDone).resolves.toBeUndefined();
  });

  it("awaitSurfaceReceipt rejects after the timeout when no receipt arrives", async () => {
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      () => undefined,
      undefined,
      { defaultAwaitTimeoutMs: 25 },
    );
    await expect(queue.enqueue("profile-reload", "await-timeout", async (transaction) => {
      try {
        await transaction.awaitSurfaceReceipt("renderer", 25);
        throw new Error("awaitSurfaceReceipt should have timed out");
      } catch (error) {
        expect(String(error)).toMatch(/timed out waiting for receipt on surface "renderer" after 25ms/);
        throw error;
      }
    })).rejects.toThrow(/timed out waiting for receipt on surface "renderer" after 25ms/);
  });

  it("awaitSurfaceReceipt resolves immediately when receipt already landed", async () => {
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      () => undefined,
    );
    await expect(queue.enqueue("profile-reload", "await-immediate", async (transaction) => {
      transaction.receipt("renderer");
      await transaction.awaitSurfaceReceipt("renderer");
    })).resolves.toBeUndefined();
  });

  it("rejects pending awaiters when the operation throws", async () => {
    const queue = new PluginLifecycleQueue(
      async <T>(_kind: string, _target: string, operation: () => Promise<T>) => operation(),
      () => undefined,
    );
    let capturedWaiter: Promise<void> | undefined;
    await expect(queue.enqueue("profile-reload", "await-throw", async (transaction) => {
      capturedWaiter = transaction.awaitSurfaceReceipt("renderer", 5000);
      // Yield so the waiter is registered before the operation throws.
      await Promise.resolve();
      throw new Error("boom");
    })).rejects.toThrow(/boom/);
    // The pending waiter must reject with the same error.
    await expect(capturedWaiter).rejects.toThrow(/boom/);
  });
});
