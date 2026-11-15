// @vitest-environment node
/**
 * 20261116-pii W0.4 / W0.5 / W1.5 / W1.6 against the real Pi SDK and a local OpenAI-protocol fixture:
 * persisted agent settings (pi-settings.json → Pi SettingsManager), mode persistence on the
 * conversation tree, favourite-model cycling and session cost.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createEngineHandlers } from "@openbuddy/host/handlers";
import { modelKey } from "@openbuddy/services/providers/providers";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
  decryptString: (value: Buffer) => value.toString().split("").reverse().join(""),
};
const shell = { openPath: async () => "", openExternal: async () => {}, showItemInFolder: () => {} };
type Request = { messages: Array<{ role: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> };

async function fixture(options: { highUsageFrom?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-agent-settings-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: Request[] = [];
  let release: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const data = JSON.parse(body) as Request & { stream_options?: { include_usage?: boolean } };
    requests.push(data);
    const last = data.messages.findLast((m) => m.role === "user");
    const prompt = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id: "fx", object: "chat.completion.chunk", created: 1, model: "fx", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const high = options.highUsageFrom !== undefined && requests.length >= options.highUsageFrom;
    const finish = () => {
      chunk({ content: "done" });
      chunk({}, "stop");
      if (data.stream_options?.include_usage)
        res.write(`data: ${JSON.stringify({ id: "fx", object: "chat.completion.chunk", created: 1, model: "fx", choices: [], usage: { prompt_tokens: high ? 24000 : 11, completion_tokens: 3, total_tokens: high ? 24003 : 14, prompt_tokens_details: { cached_tokens: 2 } } })}\n\n`);
      res.end("data: [DONE]\n\n");
    };
    chunk({ role: "assistant" });
    if (prompt.includes("HOLD")) {
      chunk({ content: "Held " });
      release = finish;
      return;
    }
    finish();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as { port: number }).port;
  const events: Array<{ name: string; payload: any }> = [];
  const start = async () => {
    const engine = await createEngineHandlers({ userDataDir: root, safeStorage, emit: (name, payload) => events.push({ name, payload }), shell });
    cleanups.push(engine.dispose);
    return engine;
  };
  let engine = await start();
  const call = async (name: string, payload: Record<string, unknown> = {}) => engine.handlers[name]!(payload) as Promise<any>;
  await call("providers_save_provider", {
    provider: { id: "fixture", providerKind: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, apiBackend: "chat_completions", authScheme: "bearer", apiKey: "private-test-key" },
  });
  await call("providers_save_model", { model: { modelId: "fixture", providerId: "fixture", contextWindow: 32000 } });
  await call("agent_init", { cwd: root });
  const sid = (await call("agent_new_session", { cwd: root, modelId: "fixture" })) as string;
  return {
    root,
    sid,
    call,
    events,
    requests,
    release: () => {
      const done = release;
      release = undefined;
      done?.();
    },
    held: () => !!release,
    /** Dispose the engine and start a new one on the same profile (an app restart). */
    restart: async () => {
      await engine.dispose();
      engine = await start();
      await call("agent_init", { cwd: root });
    },
  };
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > end) throw Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const toolNames = (request: Request) => (request.tools ?? []).map((t) => t.function?.name).filter(Boolean).sort();
const agentEvents = (events: Array<{ name: string; payload: any }>) => events.filter((e) => e.name === "agent://event").map((e) => e.payload.event);

describe("agent settings persisted in pi-settings.json (pii W0.4)", () => {
  it("reports Pi's defaults, saves a patch, applies it to the open session and keeps it across a restart", async () => {
    const f = await fixture();
    const defaults = await f.call("settings_agent_get");
    expect(defaults).toMatchObject({
      autoCompaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
      autoRetry: { enabled: true, maxRetries: 3 },
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      cacheWarming: "idle",
      favoriteModels: [],
    });
    expect(defaults.builtins).toContainEqual(expect.objectContaining({ id: "mode", enabled: true, label: "模式记忆" }));
    expect(await f.call("agent_session_info", { sessionId: f.sid })).toMatchObject({ autoCompaction: true });
    const favorite = modelKey("fixture", "fixture");
    const saved = await f.call("settings_agent_set", {
      patch: { autoCompaction: { enabled: false, reserveTokens: 8192 }, autoRetry: { maxRetries: 5 }, followUpMode: "all", cacheWarming: "off", favoriteModels: [favorite] },
    });
    expect(saved).toMatchObject({ autoCompaction: { enabled: false, reserveTokens: 8192, keepRecentTokens: 20000 }, autoRetry: { enabled: true, maxRetries: 5 }, followUpMode: "all", cacheWarming: "off", favoriteModels: [favorite] });
    // The live session follows at once (AgentSession setters), no reopen needed.
    expect(await f.call("agent_session_info", { sessionId: f.sid })).toMatchObject({ autoCompaction: false });
    const file = JSON.parse(await readFile(join(f.root, "pi", "pi-settings.json"), "utf8"));
    expect(file).toMatchObject({ version: 1, pi: { compaction: { enabled: false, reserveTokens: 8192 }, retry: { maxRetries: 5 }, followUpMode: "all", cacheWarming: "off", enabledModels: ["fixture/fixture"] } });
    expect(JSON.stringify(file)).not.toContain("private-test-key");

    await f.call("agent_send", { sessionId: f.sid, text: "persist the session file" });
    await f.restart();
    expect(await f.call("settings_agent_get")).toEqual(saved);
    await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root });
    expect(await f.call("agent_session_info", { sessionId: f.sid })).toMatchObject({ autoCompaction: false });
  });

  it("rejects unknown favourites and built-ins with protocol error codes and leaves the file unchanged", async () => {
    const f = await fixture();
    await expect(f.call("settings_agent_set", { patch: { favoriteModels: [modelKey("fixture", "missing")] } })).rejects.toThrow("model_not_found");
    await expect(f.call("settings_agent_set", { patch: { builtins: { nope: false } } })).rejects.toThrow("invalid_payload");
    await expect(f.call("settings_agent_set", { patch: { autoRetry: { maxRetries: 99 } } })).rejects.toThrow("invalid_payload");
    expect((await f.call("settings_agent_get")).favoriteModels).toEqual([]);
  });

  it("does not compact above the threshold while auto-compaction is off, and compacts again once it is back on", async () => {
    const f = await fixture({ highUsageFrom: 2 });
    await f.call("settings_agent_set", { patch: { autoCompaction: { enabled: false } } });
    await f.call("agent_send", { sessionId: f.sid, text: "A".repeat(90000) });
    await f.call("agent_send", { sessionId: f.sid, text: "B".repeat(90000) });
    await f.call("agent_send", { sessionId: f.sid, text: "C".repeat(90000) });
    expect(agentEvents(f.events).some((e) => e.type === "compaction_start")).toBe(false);
    expect(await f.call("agent_session_info", { sessionId: f.sid })).toMatchObject({ context: { compactionCount: 0 } });
    // Back on: the same open session compacts after its next turn.
    await f.call("settings_agent_set", { patch: { autoCompaction: { enabled: true } } });
    f.events.length = 0;
    await f.call("agent_send", { sessionId: f.sid, text: "D".repeat(90000) });
    expect(agentEvents(f.events).some((e) => e.type === "compaction_start" && e.reason === "threshold")).toBe(true);
    expect((await f.call("agent_session_info", { sessionId: f.sid })).context.compactionCount).toBeGreaterThan(0);
  });

  it("delivers queued follow-ups one per turn by default and both in one turn in 合并 (all) mode", async () => {
    const f = await fixture();
    const run = async (tag: string) => {
      const before = f.requests.length;
      const turn = f.call("agent_send", { sessionId: f.sid, text: `HOLD ${tag}` });
      await until(f.held);
      await f.call("agent_follow_up", { sessionId: f.sid, text: `${tag} follow-up one` });
      await f.call("agent_follow_up", { sessionId: f.sid, text: `${tag} follow-up two` });
      f.release();
      await turn;
      return f.requests.slice(before);
    };
    const separate = await run("default");
    expect(separate).toHaveLength(3);
    await f.call("settings_agent_set", { patch: { followUpMode: "all" } });
    const merged = await run("merged");
    expect(merged).toHaveLength(2);
    const users = merged[1].messages.filter((m) => m.role === "user").map((m) => JSON.stringify(m.content));
    expect(users.some((u) => u.includes("merged follow-up one"))).toBe(true);
    expect(users.some((u) => u.includes("merged follow-up two"))).toBe(true);
  });
});

describe("mode persistence as the first built-in (pii W0.5)", () => {
  it("keeps 问一问 across close/reopen, restart, fork and 从这里编辑", async () => {
    const f = await fixture();
    await f.call("agent_send", { sessionId: f.sid, text: "first in craft" });
    expect(toolNames(f.requests.at(-1)!)).toEqual(expect.arrayContaining(["bash", "write"]));
    await f.call("agent_set_mode", { sessionId: f.sid, mode: "ask" });
    expect(f.events.findLast((e) => e.name === "agent://model-state")?.payload).toMatchObject({ sessionId: f.sid, mode: "ask" });
    await f.call("agent_send", { sessionId: f.sid, text: "second in ask" });
    expect(toolNames(f.requests.at(-1)!)).toEqual(["find", "grep", "ls", "ob_todo", "read"]);

    // Close every live session and reopen from disk.
    await f.call("agent_shutdown");
    const snapshot = await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root });
    expect(snapshot.mode).toBe("ask");
    await f.call("agent_send", { sessionId: f.sid, text: "third after reopen" });
    expect(toolNames(f.requests.at(-1)!)).toEqual(["find", "grep", "ls", "ob_todo", "read"]);

    const fork = await f.call("agent_fork_session", { sessionId: f.sid });
    expect(await f.call("agent_get_model_state", { sessionId: fork })).toMatchObject({ mode: "ask" });

    await f.restart();
    await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root });
    expect(await f.call("agent_session_info", { sessionId: f.sid })).toMatchObject({ mode: "ask" });

    // 从这里编辑 on the first prompt goes back to before the switch, but the prompt is sent again with
    // the mode selected now: 问一问 stays (switching versions ‹1/2› restores each branch's own mode,
    // see branch-state.integration.test.ts).
    const points = (await f.call("rewind_points", { sessionId: f.sid })) as Array<{ entryId: string; preview: string }>;
    f.events.length = 0;
    await f.call("rewind_execute", { sessionId: f.sid, entryId: points[0].entryId });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ mode: "ask" });
    expect(f.events.some((e) => e.name === "agent://model-state" && e.payload.mode === "craft")).toBe(false);
    await f.call("agent_send", { sessionId: f.sid, text: "first again" });
    expect(toolNames(f.requests.at(-1)!)).toEqual(["find", "grep", "ls", "ob_todo", "read"]);
  });

  it("keeps the mode in memory only while the built-in is switched off", async () => {
    const f = await fixture();
    await f.call("settings_agent_set", { patch: { builtins: { mode: false } } });
    expect((await f.call("settings_agent_get")).builtins).toContainEqual(expect.objectContaining({ id: "mode", enabled: false }));
    await f.call("agent_set_mode", { sessionId: f.sid, mode: "plan" });
    await f.call("agent_send", { sessionId: f.sid, text: "hello" });
    await f.restart();
    expect((await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })).mode).toBe("craft");
  });
});

describe("favourite models and session cost (pii W1.5 / W1.6)", () => {
  it("cycles the favourites with Pi's cycleModel, explains when nothing moves, and reports thinking support", async () => {
    const f = await fixture();
    await f.call("providers_save_model", { model: { modelId: "alpha", providerId: "fixture", reasoning: true, compat: { supportsReasoningEffort: true } } });
    await f.call("providers_save_model", { model: { modelId: "beta", providerId: "fixture" } });
    expect(await f.call("agent_cycle_model", { sessionId: f.sid })).toMatchObject({ changed: false, reason: "no_favorites", state: { modelId: "fixture" } });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ supportsThinking: false });
    await f.call("settings_agent_set", { patch: { favoriteModels: [modelKey("fixture", "alpha"), modelKey("fixture", "beta")] } });
    const first = await f.call("agent_cycle_model", { sessionId: f.sid });
    expect(first).toMatchObject({ changed: true, state: { modelId: "alpha", supportsThinking: true } });
    expect((await f.call("agent_cycle_model", { sessionId: f.sid })).state.modelId).toBe("beta");
    expect((await f.call("agent_cycle_model", { sessionId: f.sid })).state.modelId).toBe("alpha");
    expect((await f.call("agent_cycle_model", { sessionId: f.sid, direction: "backward" })).state.modelId).toBe("beta");
    expect(f.events.findLast((e) => e.name === "agent://model-state")?.payload).toMatchObject({ modelId: "beta" });
    await f.call("settings_agent_set", { patch: { favoriteModels: [modelKey("fixture", "beta")] } });
    expect(await f.call("agent_cycle_model", { sessionId: f.sid })).toMatchObject({ changed: false, reason: "single_favorite" });
    await expect(f.call("agent_cycle_model", { sessionId: "not-loaded" })).rejects.toThrow("session_not_loaded");
  });

  it("reports the session cost only when the model has price data", async () => {
    const f = await fixture();
    await f.call("agent_send", { sessionId: f.sid, text: "free" });
    expect((await f.call("agent_session_usage", { sessionId: f.sid })).cost).toEqual({ total: 0, priced: false, currency: "USD" });
    await f.call("providers_save_model", { model: { modelId: "priced", providerId: "fixture", cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } } });
    await f.call("agent_set_model", { sessionId: f.sid, providerId: "fixture", modelId: "priced" });
    await f.call("agent_send", { sessionId: f.sid, text: "paid" });
    const { cost } = await f.call("agent_session_usage", { sessionId: f.sid });
    expect(cost.priced).toBe(true);
    expect(cost.total).toBeGreaterThan(0);
  });
});
