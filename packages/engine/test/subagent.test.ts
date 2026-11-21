// @vitest-environment node
// pii W3.4: ob_subagent runs real child sessions in the pool, reports them with agent://subagent,
// keeps them out of the sidebar, and stops them when the parent is stopped.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    // Running children are not listed as background tasks either (they belong to the parent turn).
    expect(await f.call("tasks_list")).toEqual([]);
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

  it("binds a different expert per step and carries team/role metadata (B2a)", async () => {
    const f = await sdkFixture((request) => {
      const text = lastUser(request);
      if (text.includes("调研任务")) return { text: "调研答案：市场规模 12 亿" };
      if (text.includes("审阅任务")) return { text: "审阅答案：结论需补充风险" };
      if (hasToolResult(request)) return { text: "团队汇总完成" };
      return {
        toolCalls: [{
          id: "sub-team",
          name: "ob_subagent",
          arguments: {
            mode: "chain",
            team: "投研团队",
            steps: [
              { task: "调研任务：查资料", agent: "alpha", role: "调研" },
              { task: "审阅任务：看结论", agent: "beta", role: "审阅" },
            ],
          },
        }],
      };
    }, cleanups);

    // Real expert Markdown files: the child binds model / thinking / tools / persona through
    // the same setSessionExpert path a user-bound session uses.
    mkdirSync(join(f.root, "pi", "agents"), { recursive: true });
    writeFileSync(join(f.root, "pi", "agents", "alpha.md"), '---\nname: "调研员"\ndescription: "查资料"\ntools: ["read"]\n---\n\n你是调研员。\n');
    writeFileSync(join(f.root, "pi", "agents", "beta.md"), '---\nname: "审阅员"\ndescription: "审结论"\ntools: ["read"]\n---\n\n你是审阅员。\n');

    const turn = f.call("agent_send", { sessionId: f.sid, text: "派团队按投研流程做一遍" });
    await until(() => f.events.some((e) => e.name === "agent://permission" && e.payload.toolKind === "ob_subagent"));
    const request = f.events.find((e) => e.name === "agent://permission" && e.payload.toolKind === "ob_subagent")!.payload;
    await f.call("agent_resolve_permission", { requestId: request.requestId, optionId: "allow" });
    await turn;

    const started = f.events.filter((e) => e.name === "agent://subagent" && e.payload.status === "started");
    expect(started).toHaveLength(2);
    expect(started[0]!.payload).toMatchObject({ agent: "调研员", role: "调研", team: "投研团队", index: 0 });
    expect(started[1]!.payload).toMatchObject({ agent: "审阅员", role: "审阅", team: "投研团队", index: 1 });
    const finished = f.events.filter((e) => e.name === "agent://subagent" && e.payload.status === "done");
    expect(finished).toHaveLength(2);
    expect(JSON.stringify(f.requests.at(-1))).toContain("调研答案");
    expect(JSON.stringify(f.requests.at(-1))).toContain("审阅答案");

    // The child was really bound to the expert: persona text reaches the model and `tools` is
    // narrowed to the expert's allowlist (read), not the parent's full set.
    const child = f.requests.find((entry) => JSON.stringify(entry.messages).includes("调研任务"));
    expect(child).toBeTruthy();
    expect(JSON.stringify(child)).toContain("调研员");
    const toolNames = ((child as { tools?: Array<{ function?: { name?: string } }> }).tools ?? [])
      .map((tool) => tool.function?.name)
      .filter((name): name is string => !!name);
    if (toolNames.length) expect(toolNames).not.toContain("bash");
  });

  it("resolves built-in expert ids for team steps", async () => {
    const f = await sdkFixture((request) => {
      const text = lastUser(request);
      if (text.includes("子任务")) return { text: "子代理答案：内置专家" };
      if (hasToolResult(request)) return { text: "内置专家完成" };
      return {
        toolCalls: [{
          id: "sub-builtin",
          name: "ob_subagent",
          arguments: { mode: "single", steps: [{ task: "子任务：调研一下", agent: "deep-researcher", role: "调研" }] },
        }],
      };
    }, cleanups);

    const turn = f.call("agent_send", { sessionId: f.sid, text: "让内置专家调研" });
    await until(() => f.events.some((e) => e.name === "agent://permission" && e.payload.toolKind === "ob_subagent"));
    const request = f.events.find((e) => e.name === "agent://permission" && e.payload.toolKind === "ob_subagent")!.payload;
    await f.call("agent_resolve_permission", { requestId: request.requestId, optionId: "allow" });
    await turn;

    expect(f.events).toContainEqual(expect.objectContaining({
      name: "agent://subagent",
      payload: expect.objectContaining({ status: "started", agent: "深度调研员", role: "调研" }),
    }));
  });
});
