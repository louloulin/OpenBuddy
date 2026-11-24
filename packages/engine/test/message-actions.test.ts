// @vitest-environment node
// G1-27 消息级操作: 删除该消息（Pi 的 context_edit）/ 继续生成（回答被截断时）。
import { afterEach, describe, expect, it } from "vitest";
import { sdkFixture, type FixtureRequest } from "./helpers/sdk-fixture";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const texts = (messages: any[], role: string) =>
  messages
    .filter((m) => m.role === role)
    .map((m) => (typeof m.content === "string" ? m.content : m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("")));

describe("agent_delete_message (G1-27)", () => {
  it("removes the prompt and its answer from the transcript and from the model's context", async () => {
    let answers = 0;
    const f = await sdkFixture(() => ({ text: `answer ${answers++}` }), cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "first question" });
    await f.call("agent_send", { sessionId: f.sid, text: "second question" });

    const points = (await f.call("rewind_points", { sessionId: f.sid })) as any[];
    expect(points).toHaveLength(2);

    const result = (await f.call("agent_delete_message", { sessionId: f.sid, entryId: points[0].entryId })) as any;
    expect(result.removed).toBe(2); // 提问 + 它的回答

    const live = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(texts(live.messages, "user")).toEqual(["second question"]);
    expect(texts(live.messages, "assistant")).toEqual(["answer 1"]);

    // 模型上下文里也不再有被删掉的那一轮。
    await f.call("agent_send", { sessionId: f.sid, text: "third question" });
    const last = f.requests.at(-1) as FixtureRequest;
    expect(JSON.stringify(last.messages)).not.toContain("first question");
    expect(JSON.stringify(last.messages)).not.toContain("answer 0");
    expect(JSON.stringify(last.messages)).toContain("second question");
  });

  it("refuses an entry that is not in the session", async () => {
    const f = await sdkFixture(() => ({ text: "the answer" }), cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "the question" });
    await expect(f.call("agent_delete_message", { sessionId: f.sid, entryId: "nope" })).rejects.toThrow();
    const live = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(texts(live.messages, "user")).toEqual(["the question"]);
  });
});

describe("agent_clear_context (G1-30)", () => {
  it("empties the conversation but keeps the task, and the next prompt starts over", async () => {
    let answers = 0;
    const f = await sdkFixture(() => ({ text: `answer ${answers++}` }), cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "first question" });
    await f.call("agent_send", { sessionId: f.sid, text: "second question" });

    await f.call("agent_clear_context", { sessionId: f.sid });
    const live = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(texts(live.messages, "user")).toEqual([]);
    expect(texts(live.messages, "assistant")).toEqual([]);

    // 新的一轮从干净的上下文开始：模型看不到之前的问答。
    await f.call("agent_send", { sessionId: f.sid, text: "third question" });
    const last = f.requests.at(-1) as FixtureRequest;
    expect(JSON.stringify(last.messages)).not.toContain("first question");
    expect(JSON.stringify(last.messages)).not.toContain("second question");
    expect(JSON.stringify(last.messages)).toContain("third question");
  });
});

describe("agent_continue (G1-27)", () => {
  it("puts the truncated answer back into the context and continues from there", async () => {
    let index = 0;
    const f = await sdkFixture(() => (index++ === 0 ? { text: "cut off here", finishReason: "length" } : { text: " and the rest" }), cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "write a long text" });

    // Pi 把被截断的回答从上下文里摘掉了：继续之前要放回去。
    await f.call("agent_continue", { sessionId: f.sid });
    const last = f.requests.at(-1) as FixtureRequest;
    expect(JSON.stringify(last.messages)).toContain("cut off here");
    expect(JSON.stringify(last.messages)).toContain("被截断的地方");
  });

  it("refuses when the answer was complete", async () => {
    const g = await sdkFixture(() => ({ text: "done" }), cleanups);
    await g.call("agent_send", { sessionId: g.sid, text: "hello" });
    await expect(g.call("agent_continue", { sessionId: g.sid })).rejects.toThrow();
  });
});
