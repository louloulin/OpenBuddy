/**
 * MVP-9 — message-queue-store durability regression tests.
 *
 * Pins the persistence shape that the new `rendererStorageWrite/Remove`
 * helpers + `hydrateMessageQueue` rely on. The mock IPC layer captures
 * every write/remove so we can assert:
 *   - enqueue triggers exactly one write with the full session queue
 *   - clear / remove-to-empty triggers a remove (not an empty write)
 *   - the namespace + key strategy is `message-queue.v1/{sessionId}`
 *   - the wire shape matches QueueItem[] verbatim (id/text/paused/createdAt)
 *   - existing in-memory semantics are unchanged (reorder / shiftNext / etc.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: Array<{ namespace: string; key: string; value: unknown }> = [];
const removes: Array<{ namespace: string; key: string }> = [];
const storeEntries: Record<string, unknown> = {};

vi.mock("@/lib/agent/pi-client", () => ({
  rendererStorageRead: vi.fn(async (namespace: string, key: string) => {
    const composite = `${namespace}/${key}`;
    const value = storeEntries[composite];
    if (value === undefined) return { ok: true };
    return { ok: true, value, version: 1 };
  }),
  rendererStorageList: vi.fn(async (namespace: string) => {
    const values = Object.entries(storeEntries)
      .filter(([k]) => k.startsWith(`${namespace}/`))
      .map(([k, v]) => ({ key: k.slice(namespace.length + 1), value: v, version: 1 }));
    return { ok: true, values };
  }),
  rendererStorageWrite: vi.fn(
    async (namespace: string, key: string, value: unknown) => {
      storeEntries[`${namespace}/${key}`] = value;
      writes.push({ namespace, key, value });
      return { ok: true, value, version: 1 };
    },
  ),
  rendererStorageRemove: vi.fn(async (namespace: string, key: string) => {
    delete storeEntries[`${namespace}/${key}`];
    removes.push({ namespace, key });
    return { ok: true, removed: true };
  }),
}));

const { useMessageQueueStore, hasActiveItems, MESSAGE_QUEUE_NAMESPACE, hydrateMessageQueue } =
  await import("../message-queue-store");

const resetStore = () => {
  useMessageQueueStore.setState({ queues: {} });
  writes.length = 0;
  removes.length = 0;
  Object.keys(storeEntries).forEach((k) => delete storeEntries[k]);
};

beforeEach(resetStore);
afterEach(resetStore);

describe("MVP-9 — durable queue persistence shape", () => {
  it("uses message-queue.v1 as namespace", () => {
    expect(MESSAGE_QUEUE_NAMESPACE).toBe("message-queue.v1");
  });

  it("enqueue writes the full session queue to <ns>/<sessionId>", async () => {
    const id = useMessageQueueStore.getState().enqueue("sess-a", "hello");
    expect(typeof id).toBe("string");
    // Wait a microtask so fire-and-forget promise resolves.
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      namespace: "message-queue.v1",
      key: "sess-a",
      value: [{ id, text: "hello", paused: false, createdAt: expect.any(Number) }],
    });
    expect(removes).toHaveLength(0);
  });

  it("appending a second item writes the combined array (not a per-item delta)", async () => {
    useMessageQueueStore.getState().enqueue("sess-b", "first");
    useMessageQueueStore.getState().enqueue("sess-b", "second");
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toHaveLength(2);
    const last = writes[1]!.value as Array<{ text: string }>;
    expect(last.map((i) => i.text)).toEqual(["first", "second"]);
  });

  it("removing the last item switches to a remove() (not an empty-array write)", async () => {
    useMessageQueueStore.getState().enqueue("sess-c", "only");
    await new Promise((r) => setTimeout(r, 0));
    const id = useMessageQueueStore.getState().getQueue("sess-c")[0]!.id;
    writes.length = 0;
    useMessageQueueStore.getState().remove("sess-c", id);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toHaveLength(0);
    expect(removes).toHaveLength(1);
    expect(removes[0]).toEqual({ namespace: "message-queue.v1", key: "sess-c" });
  });

  it("clear() also triggers remove() (clearing an empty queue is a no-op)", async () => {
    useMessageQueueStore.getState().enqueue("sess-d", "x");
    useMessageQueueStore.getState().enqueue("sess-d", "y");
    await new Promise((r) => setTimeout(r, 0));
    writes.length = 0;
    useMessageQueueStore.getState().clear("sess-d");
    await new Promise((r) => setTimeout(r, 0));
    expect(removes).toHaveLength(1);
    expect(removes[0]).toEqual({ namespace: "message-queue.v1", key: "sess-d" });
  });

  it("shiftNext persists the post-shift queue", async () => {
    useMessageQueueStore.getState().enqueue("sess-e", "first");
    useMessageQueueStore.getState().enqueue("sess-e", "second");
    await new Promise((r) => setTimeout(r, 0));
    writes.length = 0;
    const taken = useMessageQueueStore.getState().shiftNext("sess-e");
    expect(taken?.text).toBe("first");
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toHaveLength(1);
    const queue = writes[0]!.value as Array<{ text: string }>;
    expect(queue.map((i) => i.text)).toEqual(["second"]);
  });

  it("hydrateMessageQueue restores every persisted session", async () => {
    // Seed the mock storage as if another renderer wrote before us.
    storeEntries["message-queue.v1/prev-1"] = [
      { id: "x1", text: "from-disk-1", paused: false, createdAt: 1 },
      { id: "x2", text: "from-disk-2", paused: true, createdAt: 2 },
    ];
    storeEntries["message-queue.v1/prev-2"] = [
      { id: "y1", text: "from-disk-3", paused: false, createdAt: 3 },
    ];
    const count = await hydrateMessageQueue();
    // hydrate schedules a setState via setTimeout(0); flush it.
    await new Promise((r) => setTimeout(r, 10));
    expect(count).toBeGreaterThanOrEqual(1);
    const queues = useMessageQueueStore.getState().queues;
    expect(queues["prev-1"]?.map((i) => i.text)).toEqual(["from-disk-1", "from-disk-2"]);
    expect(queues["prev-2"]?.map((i) => i.text)).toEqual(["from-disk-3"]);
  });
});

describe("MVP-9 — in-memory semantics unchanged", () => {
  it("reorder / setPaused still mutate and trigger writes", async () => {
    const a = useMessageQueueStore.getState().enqueue("s", "a");
    const b = useMessageQueueStore.getState().enqueue("s", "b");
    const c = useMessageQueueStore.getState().enqueue("s", "c");
    // reorder(0, 2): remove index 0 then insert at index 2.
    // [a, b, c] -> [b, c] -> [b, c, a].
    useMessageQueueStore.getState().reorder("s", 0, 2);
    expect(useMessageQueueStore.getState().getQueue("s").map((i) => i.id)).toEqual([b, c, a]);
    useMessageQueueStore.getState().setPaused("s", b, true);
    expect(hasActiveItems(useMessageQueueStore.getState().getQueue("s"))).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes.length).toBeGreaterThanOrEqual(4); // 3 enqueue + 1 reorder + 1 setPaused
  });

  it("different sessions persist under distinct keys", async () => {
    useMessageQueueStore.getState().enqueue("alpha", "1");
    useMessageQueueStore.getState().enqueue("beta", "2");
    await new Promise((r) => setTimeout(r, 0));
    const keys = writes.map((w) => w.key).sort();
    expect(keys).toEqual(["alpha", "beta"]);
  });
});
