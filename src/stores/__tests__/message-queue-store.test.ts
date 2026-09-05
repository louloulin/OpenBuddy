import { describe, it, expect, beforeEach } from "vitest";
import {
  useMessageQueueStore,
  hasActiveItems,
} from "../message-queue-store";

const resetStore = () => useMessageQueueStore.setState({ queues: {} });

describe("message-queue-store — 入队与读取", () => {
  beforeEach(resetStore);

  it("enqueue 追加到末尾并返回 id", () => {
    const id = useMessageQueueStore.getState().enqueue("s1", "first");
    expect(typeof id).toBe("string");
    const q = useMessageQueueStore.getState().getQueue("s1");
    expect(q).toHaveLength(1);
    expect(q[0].text).toBe("first");
    expect(q[0].paused).toBe(false);
  });

  it("多条按顺序排列", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    s.enqueue("s1", "c");
    expect(s.getQueue("s1").map((i) => i.text)).toEqual(["a", "b", "c"]);
  });

  it("不同会话隔离", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.enqueue("s2", "b");
    expect(s.getQueue("s1").map((i) => i.text)).toEqual(["a"]);
    expect(s.getQueue("s2").map((i) => i.text)).toEqual(["b"]);
  });

  it("空会话返回空数组", () => {
    expect(useMessageQueueStore.getState().getQueue("nope")).toEqual([]);
  });
});

describe("message-queue-store — 编辑/删除/重排", () => {
  beforeEach(resetStore);

  it("update 修改文本", () => {
    const s = useMessageQueueStore.getState();
    const id = s.enqueue("s1", "old");
    s.update("s1", id, "new");
    expect(store().getQueue("s1")[0].text).toBe("new");
  });

  it("update 不存在的 id 无副作用(内容不变)", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.update("s1", "nope", "x");
    // 内容不变(用值断言,不依赖引用相等)。
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["a"]);
  });

  it("remove 删除指定项", () => {
    const s = useMessageQueueStore.getState();
    const id = s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    s.remove("s1", id);
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["b"]);
  });

  it("remove 最后一条后会话键被清理", () => {
    const s = useMessageQueueStore.getState();
    const id = s.enqueue("s1", "a");
    s.remove("s1", id);
    expect(store().queues["s1"]).toBeUndefined();
  });

  it("reorder 把首条移到末尾", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    s.enqueue("s1", "c");
    s.reorder("s1", 0, 2);
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["b", "c", "a"]);
  });

  it("reorder 越界 to 被 clamp", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    s.reorder("s1", 0, 99);
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["b", "a"]);
  });

  it("reorder 相同位置无副作用(顺序不变)", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    s.reorder("s1", 1, 1);
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["a", "b"]);
  });

  it("reorder 非法 from 无副作用", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.reorder("s1", 5, 0);
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["a"]);
  });
});

describe("message-queue-store — 暂停/恢复", () => {
  beforeEach(resetStore);

  it("setPaused 切换 paused/active", () => {
    const s = useMessageQueueStore.getState();
    const id = s.enqueue("s1", "a");
    s.setPaused("s1", id, true);
    expect(store().getQueue("s1")[0].paused).toBe(true);
    s.setPaused("s1", id, false);
    expect(store().getQueue("s1")[0].paused).toBe(false);
  });

  it("setPaused 不存在的 id 无副作用(状态不变)", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.setPaused("s1", "nope", true);
    expect(store().getQueue("s1")[0].paused).toBe(false);
  });
});

describe("message-queue-store — shiftNext", () => {
  beforeEach(resetStore);

  it("取第一条 active 并从队列移除", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    const item = s.shiftNext("s1");
    expect(item?.text).toBe("a");
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["b"]);
  });

  it("跳过 paused 项取下一条 active", () => {
    const s = useMessageQueueStore.getState();
    const id1 = s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    s.setPaused("s1", id1, true);
    const item = s.shiftNext("s1");
    expect(item?.text).toBe("b");
    // paused 项保留
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["a"]);
  });

  it("无 active 项返回 null", () => {
    const s = useMessageQueueStore.getState();
    const id = s.enqueue("s1", "a");
    s.setPaused("s1", id, true);
    expect(s.shiftNext("s1")).toBeNull();
    expect(store().getQueue("s1")).toHaveLength(1);
  });

  it("空队列返回 null", () => {
    expect(useMessageQueueStore.getState().shiftNext("s1")).toBeNull();
  });

  it("取走最后一条 active 后会话键被清理", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.shiftNext("s1");
    expect(store().queues["s1"]).toBeUndefined();
  });
});

describe("message-queue-store — clear", () => {
  beforeEach(resetStore);

  it("clear 清空整个会话队列", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    s.clear("s1");
    expect(store().getQueue("s1")).toEqual([]);
    expect(store().queues["s1"]).toBeUndefined();
  });

  it("clear 不存在的会话无副作用(s1 队列仍在)", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.clear("nope");
    expect(store().getQueue("s1").map((i) => i.text)).toEqual(["a"]);
  });
});

describe("hasActiveItems", () => {
  it("存在 active 项返回 true", () => {
    expect(hasActiveItems([{ id: "1", text: "a", paused: false, createdAt: 1 }])).toBe(true);
  });

  it("全部 paused 项返回 false", () => {
    expect(hasActiveItems([{ id: "1", text: "a", paused: true, createdAt: 1 }])).toBe(false);
  });

  it("空数组返回 false", () => {
    expect(hasActiveItems([])).toBe(false);
  });
});

/** 便捷:重新读取最新 store 快照(避免测试里持过期引用)。 */
function store() {
  return useMessageQueueStore.getState();
}
