// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createSettings } from "@openbuddy/services/settings/settings";
import type { PlanItem, TodoDetails } from "@openbuddy/protocol/plan";
import { applyTodo, EMPTY_PLAN, parseTodoParams, planFromBranch, slimPlan } from "../src/builtin/plan-state.js";
import { BUILTIN_EXTENSIONS } from "../src/builtin/index.js";
import { Permissions } from "../src/permissions/permissions.js";
import { PiEngine } from "../src/pi-engine.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const secure = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
const statuses = (items: PlanItem[]) => items.map((i) => `${i.text}:${i.status}`);

describe("ob_todo plan state (pure)", () => {
  it("adds, updates, completes, removes and lists steps; the details always hold the whole plan", () => {
    let state = EMPTY_PLAN;
    const step = (raw: unknown) => {
      const r = applyTodo(state, parseTodoParams(raw));
      state = { items: r.details.items, nextId: r.details.nextId };
      return r;
    };
    const added = step({ action: "add", items: ["收集数据", "  清洗  数据 ", ""], text: "写报告" });
    expect(added.details.changed).toEqual([1, 2, 3]);
    expect(statuses(state.items)).toEqual(["收集数据:pending", "清洗 数据:pending", "写报告:pending"]);
    step({ action: "update", id: "2", status: "in_progress" }); // models send numbers as strings
    step({ action: "complete", id: 1, note: "共 24 行" });
    const removed = step({ action: "remove", id: 3 });
    expect(removed.details.removed?.map((i) => i.text)).toEqual(["写报告"]);
    expect(step({ action: "add", text: "复核" }).details.changed).toEqual([4]); // ids are never reused
    const listed = step({ action: "list" });
    expect(listed.details.changed).toEqual([]);
    expect(listed.text).toContain("完成 1/3");
    expect(listed.text).toContain("✓ #1 收集数据（共 24 行）");
    expect(listed.text).toContain("▶ #2 清洗 数据");
    expect(state.items[0]).toEqual({ id: 1, text: "收集数据", status: "done", note: "共 24 行" });
    step({ action: "update", id: 1, note: "" });
    expect(state.items[0].note).toBeUndefined();
  });

  it("rejects invalid calls without touching the plan", () => {
    const state = applyTodo(EMPTY_PLAN, parseTodoParams({ action: "add", items: ["a"] })).details;
    const plan = { items: state.items, nextId: state.nextId };
    expect(() => applyTodo(plan, parseTodoParams({ action: "complete", id: 9 }))).toThrow("#9");
    expect(() => applyTodo(plan, parseTodoParams({ action: "update", id: 1 }))).toThrow("update");
    expect(() => applyTodo(plan, parseTodoParams({ action: "add", items: [" "] }))).toThrow("add");
    expect(() => applyTodo(plan, parseTodoParams({ action: "remove" }))).toThrow("id");
    expect(() => parseTodoParams({ action: "clear" })).toThrow("未知操作");
    expect(() => applyTodo(plan, parseTodoParams({ action: "add", items: Array.from({ length: 50 }, (_, i) => `s${i}`) }))).toThrow("50");
    expect(plan.items).toEqual([{ id: 1, text: "a", status: "pending" }]);
  });

  it("slims items to id / text / status / note and drops malformed ones", () => {
    expect(slimPlan([{ id: 1, text: "a", status: "done", toolCallId: "x", extra: 1 }, { id: "2", text: "b", status: "done" }, { id: 3, text: "c", status: "weird" }, null])).toEqual([{ id: 1, text: "a", status: "done" }]);
    expect(slimPlan("nope")).toEqual([]);
  });

  it("rebuilds the plan from the current branch of a real SessionManager", () => {
    const sm = SessionManager.inMemory("/tmp");
    const result = (id: string, details: TodoDetails) => {
      sm.appendMessage({ role: "assistant", content: [{ type: "toolCall", id, name: "ob_todo", arguments: {} }], api: "openai-completions", provider: "f", model: "f", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: Date.now() } as never);
      return sm.appendMessage({ role: "toolResult", toolCallId: id, toolName: "ob_todo", content: [{ type: "text", text: "ok" }], details, isError: false, timestamp: Date.now() } as never);
    };
    sm.appendMessage({ role: "user", content: "go", timestamp: Date.now() } as never);
    const first = result("t1", { action: "add", items: [{ id: 1, text: "a", status: "pending" }], nextId: 2, changed: [1] });
    result("t2", { action: "complete", items: [{ id: 1, text: "a", status: "done" }], nextId: 2, changed: [1] });
    // A result of another tool and a failed ob_todo result (no details) do not count.
    sm.appendMessage({ role: "toolResult", toolCallId: "t3", toolName: "read", content: [], details: { items: [] }, isError: false, timestamp: Date.now() } as never);
    sm.appendMessage({ role: "toolResult", toolCallId: "t4", toolName: "ob_todo", content: [], isError: true, timestamp: Date.now() } as never);
    expect(planFromBranch(sm)).toEqual({ items: [{ id: 1, text: "a", status: "done" }], nextId: 2 });
    sm.branch(first);
    expect(planFromBranch(sm).items[0].status).toBe("pending");
    sm.resetLeaf();
    expect(planFromBranch(sm)).toEqual(EMPTY_PLAN);
  });

  it("is a registered built-in and auto-allowed by the permission gate unless a rule denies it", () => {
    expect(BUILTIN_EXTENSIONS.find((b) => b.id === "todo")?.tools).toEqual(["ob_todo"]);
    const root = join(tmpdir(), `ob-todo-perm-${process.pid}-${Date.now()}`);
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const settings = createSettings(root, secure);
    const permissions = new Permissions(settings, () => {});
    expect(settings.config.read().permissionMode).toBe("ask");
    expect(permissions.decide("s", "ob_todo", { action: "add", items: ["x"] })).toBe(true);
    expect(permissions.decide("s", "read", { path: "a" })).toBeUndefined();
    settings.config.write({ ...settings.config.read(), rules: [{ action: "deny", tool: "ob_todo" }] });
    expect(permissions.decide("s", "ob_todo", { action: "list" })).toBe(false);
  });
});

/** OpenAI-compatible fixture: "alpha" plans with ob_todo across tool rounds; a regeneration plans differently. */
async function planFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ob-todo-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: Array<{ tools: string[] }> = [];
  let attempts = 0;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const data = JSON.parse(body);
    requests.push({ tools: (data.tools ?? []).map((t: { function?: { name?: string } }) => t.function?.name) });
    const messages = data.messages as Array<{ role: string }>;
    const rounds = messages.slice(messages.findLastIndex((m) => m.role === "user") + 1).filter((m) => m.role === "assistant").length;
    if (rounds === 0) attempts++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id: "f", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const calls = (...args: object[]) => {
      chunk({ tool_calls: args.map((a, index) => ({ index, id: `c${attempts}-${rounds}-${index}`, type: "function", function: { name: "ob_todo", arguments: JSON.stringify(a) } })) });
      chunk({}, "tool_calls");
    };
    chunk({ role: "assistant" });
    const script = attempts === 1
      ? [() => calls({ action: "add", items: ["A1", "A2", "A3"] }), () => calls({ action: "complete", id: 1 }, { action: "update", id: 2, status: "in_progress" }, { action: "complete", id: 99 })]
      : [() => calls({ action: "add", items: ["B1", "B2"] })];
    if (rounds < script.length) script[rounds]();
    else { chunk({ content: attempts === 1 ? "alpha done" : "beta done" }); chunk({}, "stop"); }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const events: Array<{ name: string; payload: any }> = [];
  const engine = new PiEngine(createSettings(root, secure), (name, payload) => events.push({ name, payload }), async () => {});
  await engine.initialize();
  cleanups.push(() => engine.shutdown());
  await engine.providers.saveProvider({ id: "fixture", providerKind: "custom", baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiBackend: "chat_completions", authScheme: "bearer", apiKey: "k" });
  await engine.providers.saveModel({ modelId: "fixture", providerId: "fixture", contextWindow: 32000 });
  await engine.init(root);
  const sid = await engine.newSession(root, "fixture");
  const plans = () => events.filter((e) => e.name === "agent://plan").map((e) => e.payload);
  return { root, engine, sid, events, requests, plans, lastPlan: () => plans().at(-1)?.items as PlanItem[] };
}

describe("ob_todo in a real Pi session (fixture model)", () => {
  it("emits a slim agent://plan after each result, needs no approval, and follows regenerate and branch switches", async () => {
    const f = await planFixture();
    // A new session announces its (empty) plan.
    expect(f.plans()).toEqual([{ sessionId: f.sid, items: [] }]);
    await f.engine.send(f.sid, "alpha plan");
    expect(f.requests[0].tools).toContain("ob_todo");
    // Default permission mode is "ask", yet nothing asked: ob_todo is session-only.
    expect(f.events.some((e) => e.name === "agent://permission")).toBe(false);
    expect(statuses(f.lastPlan())).toEqual(["A1:done", "A2:in_progress", "A3:pending"]);
    // add, complete, update → three plan events; the failed `complete #99` sent none.
    expect(f.plans().slice(1).map((p) => p.items.length)).toEqual([3, 3, 3]);
    const failed = f.events.find((e) => e.name === "agent://event" && e.payload.event.type === "tool_execution_end" && e.payload.event.isError);
    expect(failed?.payload.event.toolName).toBe("ob_todo");
    // Slim: exactly { sessionId, items }, items exactly { id, text, status[, note] }.
    for (const plan of f.plans()) {
      expect(Object.keys(plan).sort()).toEqual(["items", "sessionId"]);
      for (const item of plan.items) expect(Object.keys(item).every((k) => ["id", "text", "status", "note"].includes(k))).toBe(true);
      expect(JSON.stringify(plan).length).toBeLessThan(400);
    }
    const alphaLeaf = f.engine.slot(f.sid).session.sessionManager.getLeafId()!;

    // 重新生成: the leaf moves before the prompt (plan empty again), then the new answer plans B.
    const before = f.plans().length;
    await f.engine.regenerate(f.sid);
    expect(f.plans().slice(before).map((p) => statuses(p.items))).toContainEqual([]);
    expect(statuses(f.lastPlan())).toEqual(["B1:pending", "B2:pending"]);

    // Switching back to the first branch (what agent_navigate does) restores its plan.
    await f.engine.slot(f.sid).session.navigateTree(alphaLeaf, { summarize: false });
    expect(statuses(f.lastPlan())).toEqual(["A1:done", "A2:in_progress", "A3:pending"]);

    // Focusing the live session again re-announces the plan (a reloaded renderer starts empty).
    f.events.length = 0;
    await f.engine.load(f.sid);
    expect(f.plans()).toHaveLength(1);
    expect(statuses(f.lastPlan())).toEqual(["A1:done", "A2:in_progress", "A3:pending"]);
  });

  it("rebuilds the plan when a session is reopened from disk, and keeps ob_todo in 想一想", async () => {
    const f = await planFixture();
    await f.engine.send(f.sid, "alpha plan");
    await f.engine.close(f.sid);
    f.events.length = 0;
    await f.engine.load(f.sid, f.root);
    expect(statuses(f.lastPlan())).toEqual(["A1:done", "A2:in_progress", "A3:pending"]);
    f.engine.setMode(f.sid, "plan");
    const tools = f.engine.slot(f.sid).session.getActiveToolNames();
    expect(tools).toContain("ob_todo");
    expect(tools).not.toContain("write");
  });
});
