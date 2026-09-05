import { describe, it, expect, beforeEach } from "vitest";
import {
  usePermissionStore,
  selectPermissionForSession,
  selectPermissionHead,
} from "../permission-store";
import type { PermissionRequest } from "@openbuddy/shared-types";

const resetStore = () => usePermissionStore.setState({ queues: {} });

function makePerm(requestId: string, sessionId: string): PermissionRequest {
  return {
    requestId,
    sessionId,
    toolCallId: `tc-${requestId}`,
    tool: "Bash",
    title: `Run: echo ${requestId}`,
    input: { command: `echo ${requestId}` },
    kind: "terminal",
  } as unknown as PermissionRequest;
}

describe("permission-store", () => {
  beforeEach(resetStore);

  it("request 入队到对应 sessionId", () => {
    usePermissionStore.getState().request(makePerm("r1", "s1"));
    expect(usePermissionStore.getState().queues["s1"]).toHaveLength(1);
    expect(usePermissionStore.getState().queues["s1"][0].requestId).toBe("r1");
  });

  it("同会话多个 request 按顺序排列", () => {
    const s = usePermissionStore.getState();
    s.request(makePerm("r1", "s1"));
    s.request(makePerm("r2", "s1"));
    s.request(makePerm("r3", "s1"));
    expect(usePermissionStore.getState().queues["s1"].map((q) => q.requestId)).toEqual(["r1", "r2", "r3"]);
  });

  it("不同会话隔离", () => {
    const s = usePermissionStore.getState();
    s.request(makePerm("r1", "s1"));
    s.request(makePerm("r2", "s2"));
    expect(usePermissionStore.getState().queues["s1"]).toHaveLength(1);
    expect(usePermissionStore.getState().queues["s2"]).toHaveLength(1);
  });

  it("sessionId 为空时兜底到 __global", () => {
    usePermissionStore.getState().request(makePerm("r1", ""));
    expect(usePermissionStore.getState().queues["__global"]).toHaveLength(1);
  });

  it("dismiss 指定 sessionId 只移除该会话中的", () => {
    const s = usePermissionStore.getState();
    s.request(makePerm("r1", "s1"));
    s.request(makePerm("r2", "s1"));
    s.request(makePerm("r3", "s2"));
    s.dismiss("r1", "s1");
    expect(usePermissionStore.getState().queues["s1"].map((q) => q.requestId)).toEqual(["r2"]);
    expect(usePermissionStore.getState().queues["s2"]).toHaveLength(1);
  });

  it("dismiss 不指定 sessionId 则从所有队列中移除", () => {
    const s = usePermissionStore.getState();
    s.request(makePerm("r1", "s1"));
    s.request(makePerm("r1", "s2")); // 同 requestId 在不同会话
    s.dismiss("r1");
    expect(usePermissionStore.getState().queues["s1"]).toHaveLength(0);
    expect(usePermissionStore.getState().queues["s2"]).toHaveLength(0);
  });

  it("dismiss 不存在的 requestId 无副作用", () => {
    usePermissionStore.getState().request(makePerm("r1", "s1"));
    usePermissionStore.getState().dismiss("nope", "s1");
    expect(usePermissionStore.getState().queues["s1"]).toHaveLength(1);
  });

  it("dismiss 不存在的 sessionId 无副作用", () => {
    usePermissionStore.getState().request(makePerm("r1", "s1"));
    usePermissionStore.getState().dismiss("r1", "no-such-session");
    expect(usePermissionStore.getState().queues["s1"]).toHaveLength(1);
  });
});

describe("selectPermissionForSession", () => {
  beforeEach(resetStore);

  it("返回指定会话的第一个 pending", () => {
    const s = usePermissionStore.getState();
    s.request(makePerm("r1", "s1"));
    s.request(makePerm("r2", "s1"));
    const selector = selectPermissionForSession("s1");
    expect(selector(usePermissionStore.getState())?.requestId).toBe("r1");
  });

  it("会话无 pending 返回 null", () => {
    expect(selectPermissionForSession("s1")(usePermissionStore.getState())).toBeNull();
  });

  it("sessionId 为 null 返回 null", () => {
    usePermissionStore.getState().request(makePerm("r1", "s1"));
    expect(selectPermissionForSession(null)(usePermissionStore.getState())).toBeNull();
  });
});

describe("selectPermissionHead", () => {
  beforeEach(resetStore);

  it("返回第一个非空队列的头部", () => {
    const s = usePermissionStore.getState();
    s.request(makePerm("r1", "s1"));
    s.request(makePerm("r2", "s2"));
    expect(selectPermissionHead(usePermissionStore.getState())?.requestId).toBe("r1");
  });

  it("所有队列为空返回 null", () => {
    expect(selectPermissionHead(usePermissionStore.getState())).toBeNull();
  });
});

describe("permission-store LRU + TTL bound", () => {
  beforeEach(resetStore);

  it("drops requests older than TTL on push", () => {
    const s = usePermissionStore.getState();
    const old = makePerm("old", "s1") as PermissionRequest & { issuedAt: number };
    old.issuedAt = Date.now() - 10 * 60_000; // 10 min > default 5 min
    usePermissionStore.setState({ queues: { s1: [old] } });
    s.request(makePerm("new", "s1"));
    const queue = usePermissionStore.getState().queues.s1!;
    expect(queue.map((q) => q.requestId)).toEqual(["new"]);
  });

  it("evicts oldest entry when the per-session cap is exceeded", () => {
    // QUEUE_CAP is read once at module init from
    // VITE_OPENBUDDY_PERMISSION_QUEUE_CAP / window.__OPENBUDDY_PERMISSION_QUEUE_CAP.
    // The default is 8; pushing 10 requests should keep only the 8 newest.
    const store = usePermissionStore.getState();
    for (let i = 0; i < 10; i += 1) store.request(makePerm(`r${i}`, "s1"));
    const queue = usePermissionStore.getState().queues.s1!;
    expect(queue.length).toBe(8);
    expect(queue[0].requestId).toBe("r2");
    expect(queue[queue.length - 1].requestId).toBe("r9");
  });

  it("prune() drops expired entries across every session", () => {
    const a = makePerm("a", "s1") as PermissionRequest & { issuedAt: number };
    a.issuedAt = Date.now() - 10 * 60_000;
    const b = makePerm("b", "s1") as PermissionRequest & { issuedAt: number };
    b.issuedAt = Date.now() - 100; // fresh
    const c = makePerm("c", "s2") as PermissionRequest & { issuedAt: number };
    c.issuedAt = Date.now() - 10 * 60_000;
    usePermissionStore.setState({ queues: { s1: [a, b], s2: [c] } });
    usePermissionStore.getState().prune();
    const after = usePermissionStore.getState().queues;
    expect(after.s1?.map((q) => q.requestId)).toEqual(["b"]);
    // s2 had only the expired entry, so its key should disappear entirely.
    expect(after.s2).toBeUndefined();
  });
});
