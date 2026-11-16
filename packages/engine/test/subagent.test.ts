// @vitest-environment node
// pii W3.4: ob_subagent runs real child sessions in the pool, reports them with agent://subagent,
// keeps them out of the sidebar, and stops them when the parent is stopped.
import { afterEach, describe, expect, it } from "vitest";
import { sdkFixture, until, type FixtureRequest } from "./helpers/sdk-fixture.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const lastUser = (request: FixtureRequest) => {
  const last = [...request.messages].reverse().find((m) => m.role === "user");
  const content = last?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
};
const hasToolResult = (request: FixtureRequest) => request.messages.some((m) => m.role === "tool");

/** Parent asks for ob_subagent once; the child answers; the parent then reports. */
const reply = (request: FixtureRequest) => {
  const text = lastUser(request);
  if (text.includes("子任务")) return { text: `子代理答案：${text.slice(0, 40)}` };
  if (hasToolResult(request)) return { text: "已汇总子代理结果" };
  return {
    toolCalls: [{
      id: "sub-1",
      name: "ob_subagent",
      arguments: { mode: "parallel", tasks: ["子任务 A：统计", "子任务 B：核对"] },
    }],
  };
};

describe("子代理 ob_subagent (pii W3.4)", () => {
  it("runs parallel children, reports each on agent://subagent and returns their answers", async () => {
    const f = await sdkFixture(reply, cleanups);
    const turn = f.call("agent_send", { sessionId: f.sid, text: "派两个子代理并行跑" });
    // The tool is gated like any other: allow this one call.
    await until(() => f.events.some((e) => e.name === "agent://permission" && e.payload.toolKind === "ob_subagent"));
    const request = f.events.find((e) => e.name === "agent://permission" && e.payload.toolKind === "ob_subagent")!.payload;
    await f.call("agent_resolve_permission", { requestId: request.requestId, optionId: "allow" });
    await turn;

    const started = f.events.filter((e) => e.name === "agent://subagent" && e.payload.status === "started");
    const finished = f.events.filter((e) => e.name === "agent://subagent" && e.payload.status === "done");
    expect(started).toHaveLength(2);
    expect(finished).toHaveLength(2);
    for (const event of finished) {
      expect(event.payload).toMatchObject({ parentId: f.sid, status: "done" });
      expect(String(event.payload.summary)).toContain("子代理答案");
      // The children are gone from the pool once they answered.
      expect(typeof event.payload.childId).toBe("string");
    }
    // The parent got the children's answers back as its tool result.
    expect(JSON.stringify(f.requests.at(-1))).toContain("子代理答案");

    // In-memory children never appear in the session list (the sidebar reads files).
    const sessions = (await f.call("agent_list_sessions", { cwd: f.root })) as Array<{ sessionId: string }>;
    const childIds = started.map((e) => e.payload.childId);
    expect(sessions.map((s) => s.sessionId)).not.toEqual(expect.arrayContaining(childIds));
    expect(sessions.map((s) => s.sessionId)).toContain(f.sid);
  });

  it("reports a child failure without failing the parent turn", async () => {
    const f = await sdkFixture((request) => {
      const text = lastUser(request);
      if (text.includes("坏子任务")) return { text: "" };
      if (hasToolResult(request)) return { text: "父会话继续" };
      return { toolCalls: [{ id: "sub-2", name: "ob_subagent", arguments: { task: "坏子任务" } }] };
    }, cleanups);
    const turn = f.call("agent_send", { sessionId: f.sid, text: "派一个子代理" });
    await until(() => f.events.some((e) => e.name === "agent://permission" && e.payload.toolKind === "ob_subagent"));
    const request = f.events.find((e) => e.name === "agent://permission" && e.payload.toolKind === "ob_subagent")!.payload;
    await f.call("agent_resolve_permission", { requestId: request.requestId, optionId: "allow" });
    await turn;
    expect(f.events).toContainEqual(expect.objectContaining({
      name: "agent://subagent",
      payload: expect.objectContaining({ parentId: f.sid, status: "failed" }),
    }));
    // The parent still settled normally and answered.
    expect(f.events.some((e) => e.name === "agent://turn-error")).toBe(false);
    expect(JSON.stringify(f.events)).toContain("父会话继续");
  });
});
