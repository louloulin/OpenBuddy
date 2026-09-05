import { describe, it, expect, beforeEach } from "vitest";
import {
  useQuestionStore,
  selectQuestionForSession,
  type QuestionRequest,
} from "../question-store";

const resetStore = () => useQuestionStore.setState({ queues: {} });

function makeQuestion(requestId: string, sessionId: string): QuestionRequest {
  return {
    requestId,
    sessionId,
    toolCallId: `tc-${requestId}`,
    title: `Question ${requestId}`,
    questions: [
      { id: "q1", question: "选择方案", options: ["A", "B", "C"] },
    ],
  };
}

describe("question-store", () => {
  beforeEach(resetStore);

  it("request 入队到对应 sessionId", () => {
    useQuestionStore.getState().request(makeQuestion("r1", "s1"));
    expect(useQuestionStore.getState().queues["s1"]).toHaveLength(1);
    expect(useQuestionStore.getState().queues["s1"][0].requestId).toBe("r1");
  });

  it("同会话多个 question 按顺序排列", () => {
    const s = useQuestionStore.getState();
    s.request(makeQuestion("r1", "s1"));
    s.request(makeQuestion("r2", "s1"));
    expect(useQuestionStore.getState().queues["s1"].map((q) => q.requestId)).toEqual(["r1", "r2"]);
  });

  it("不同会话隔离", () => {
    const s = useQuestionStore.getState();
    s.request(makeQuestion("r1", "s1"));
    s.request(makeQuestion("r2", "s2"));
    expect(useQuestionStore.getState().queues["s1"]).toHaveLength(1);
    expect(useQuestionStore.getState().queues["s2"]).toHaveLength(1);
  });

  it("sessionId 为空时兜底到 __global", () => {
    useQuestionStore.getState().request(makeQuestion("r1", ""));
    expect(useQuestionStore.getState().queues["__global"]).toHaveLength(1);
  });

  it("dismiss 指定 sessionId 只移除该会话中的", () => {
    const s = useQuestionStore.getState();
    s.request(makeQuestion("r1", "s1"));
    s.request(makeQuestion("r2", "s1"));
    s.request(makeQuestion("r3", "s2"));
    s.dismiss("r1", "s1");
    expect(useQuestionStore.getState().queues["s1"].map((q) => q.requestId)).toEqual(["r2"]);
    expect(useQuestionStore.getState().queues["s2"]).toHaveLength(1);
  });

  it("dismiss 不指定 sessionId 则从所有队列中移除", () => {
    const s = useQuestionStore.getState();
    s.request(makeQuestion("r1", "s1"));
    s.request(makeQuestion("r1", "s2"));
    s.dismiss("r1");
    expect(useQuestionStore.getState().queues["s1"]).toHaveLength(0);
    expect(useQuestionStore.getState().queues["s2"]).toHaveLength(0);
  });

  it("dismiss 不存在的 requestId 无副作用", () => {
    useQuestionStore.getState().request(makeQuestion("r1", "s1"));
    useQuestionStore.getState().dismiss("nope", "s1");
    expect(useQuestionStore.getState().queues["s1"]).toHaveLength(1);
  });

  it("dismiss 不存在的 sessionId 无副作用", () => {
    useQuestionStore.getState().request(makeQuestion("r1", "s1"));
    useQuestionStore.getState().dismiss("r1", "no-such");
    expect(useQuestionStore.getState().queues["s1"]).toHaveLength(1);
  });
});

describe("selectQuestionForSession", () => {
  beforeEach(resetStore);

  it("返回指定会话的第一个 pending question", () => {
    const s = useQuestionStore.getState();
    s.request(makeQuestion("r1", "s1"));
    s.request(makeQuestion("r2", "s1"));
    const selector = selectQuestionForSession("s1");
    expect(selector(useQuestionStore.getState())?.requestId).toBe("r1");
  });

  it("会话无 pending 返回 null", () => {
    expect(selectQuestionForSession("s1")(useQuestionStore.getState())).toBeNull();
  });

  it("sessionId 为 null 返回 null", () => {
    useQuestionStore.getState().request(makeQuestion("r1", "s1"));
    expect(selectQuestionForSession(null)(useQuestionStore.getState())).toBeNull();
  });
});

describe("question-store LRU + TTL bound", () => {
  beforeEach(resetStore);

  it("stamps issuedAt on incoming requests so TTL eviction can run", () => {
    useQuestionStore.getState().request(makeQuestion("r1", "s1"));
    const queue = useQuestionStore.getState().queues.s1!;
    expect(typeof queue[0].issuedAt).toBe("number");
    expect(queue[0].issuedAt).toBeLessThanOrEqual(Date.now());
  });

  it("drops requests older than TTL on push", () => {
    const old = makeQuestion("old", "s1");
    (old as { issuedAt?: number }).issuedAt = Date.now() - 10 * 60_000;
    useQuestionStore.setState({ queues: { s1: [old] } });
    useQuestionStore.getState().request(makeQuestion("new", "s1"));
    const queue = useQuestionStore.getState().queues.s1!;
    expect(queue.map((q) => q.requestId)).toEqual(["new"]);
  });

  it("evicts oldest entry when the per-session cap is exceeded", () => {
    const store = useQuestionStore.getState();
    for (let i = 0; i < 10; i += 1) store.request(makeQuestion(`r${i}`, "s1"));
    const queue = useQuestionStore.getState().queues.s1!;
    expect(queue.length).toBe(8);
    expect(queue[0].requestId).toBe("r2");
    expect(queue[queue.length - 1].requestId).toBe("r9");
  });

  it("prune() drops expired entries across every session", () => {
    const a = makeQuestion("a", "s1");
    (a as { issuedAt?: number }).issuedAt = Date.now() - 10 * 60_000;
    const b = makeQuestion("b", "s1");
    (b as { issuedAt?: number }).issuedAt = Date.now() - 100;
    const c = makeQuestion("c", "s2");
    (c as { issuedAt?: number }).issuedAt = Date.now() - 10 * 60_000;
    useQuestionStore.setState({ queues: { s1: [a, b], s2: [c] } });
    useQuestionStore.getState().prune();
    const after = useQuestionStore.getState().queues;
    expect(after.s1?.map((q) => q.requestId)).toEqual(["b"]);
    expect(after.s2).toBeUndefined();
  });
});
