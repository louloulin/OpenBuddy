// @vitest-environment node
// G1-31 快速问答: the answer runs in a throwaway session; the task keeps its context.
import { afterEach, describe, expect, it } from "vitest";
import { sdkFixture, until, type FixtureRequest } from "./helpers/sdk-fixture";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("agent_quick_answer (G1-31)", () => {
  it("answers in its own session without touching the task's context or its session list", async () => {
    const f = await sdkFixture((request) => ({
      text: request.messages.some((m) => JSON.stringify(m.content).includes("quick"))
        ? "the quick answer"
        : "the task answer",
    }), cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "task question" });
    const before = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    const sessionsBefore = (await f.call("agent_list_sessions", { cwd: f.root })) as any[];

    const quick = (await f.call("agent_quick_answer", {
      prompt: "quick question",
      context: "the quoted fragment",
      cwd: f.root,
    })) as any;
    expect(typeof quick.sessionId).toBe("string");
    expect(quick.sessionId).not.toBe(f.sid);

    // The answer reaches the model in its own request.
    await until(() => f.requests.length >= 2);
    const request = f.requests.at(-1) as FixtureRequest;
    expect(JSON.stringify(request.messages)).toContain("the quoted fragment");
    expect(JSON.stringify(request.messages)).toContain("quick question");

    // 主对话的上下文一点没变。
    const after = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(JSON.stringify(after.messages)).toBe(JSON.stringify(before.messages));

    // 一次性会话不落盘，也不会出现在任务列表里。
    const sessionsAfter = (await f.call("agent_list_sessions", { cwd: f.root })) as any[];
    expect(sessionsAfter.length).toBe(sessionsBefore.length);
    expect(sessionsAfter.some((item) => item.id === quick.sessionId)).toBe(false);
  });

  it("runs without tools, so a quick question never touches the workspace", async () => {
    const f = await sdkFixture(() => ({ text: "answered" }), cleanups);
    await f.call("agent_quick_answer", { prompt: "what is 2+2", cwd: f.root });
    await until(() => f.requests.length >= 1);
    const request = f.requests.at(-1) as FixtureRequest;
    expect(request.tools).toBeUndefined();
  });
});
