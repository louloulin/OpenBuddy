// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createEngineHandlers } from "@openbuddy/host/handlers";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const secureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (value: string) =>
    Buffer.from(value.split("").reverse().join("")),
  decryptString: (value: Buffer) =>
    value.toString().split("").reverse().join(""),
};
async function fixture(
  options: {
    rateLimitOnce?: boolean;
    highUsageRequest?: number;
    extensions?: ExtensionFactory[];
    holdFirst?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-sdk-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: unknown[] = [];
  let releaseFirst: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const data = JSON.parse(body);
    requests.push({ ...data, _authorization: req.headers.authorization });
    if (options.rateLimitOnce && requests.length === 1) {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "0",
      });
      res.end(
        JSON.stringify({
          error: {
            message: "rate limit fixture",
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
          },
        }),
      );
      return;
    }
    const messages = data.messages as Array<{ role: string; content?: string }>;
    const userContent =
      messages.findLast((m) => m.role === "user")?.content ?? "";
    const prompt =
      typeof userContent === "string"
        ? userContent
        : JSON.stringify(userContent);
    const lastUser = messages.findLastIndex((m) => m.role === "user");
    const toolDone = messages
      .slice(lastUser + 1)
      .some((m) => m.role === "tool");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    chunk({ role: "assistant" });
    if (options.holdFirst && requests.length === 1) {
      chunk({ content: "Held response" });
      releaseFirst = () => {
        chunk({ content: " complete" });
        chunk({}, "stop");
        res.end("data: [DONE]\n\n");
      };
      return;
    }
    if (String(prompt).includes("cancel")) {
      chunk({ content: "Waiting" });
      return; // client abort must close this response
    }
    if (String(prompt).includes("tool") && !toolDone) {
      const toolName = String(prompt).includes("mcp")
        ? "mcp__fixture__ping"
        : String(prompt).includes("write")
          ? "write"
          : "read";
      chunk({
        tool_calls: [
          {
            index: 0,
            id: `fixture-${toolName}`,
            type: "function",
            function: {
              name: toolName,
              arguments: JSON.stringify(
                toolName === "write"
                  ? {
                      path: join(root, "blocked.txt"),
                      content: "must not exist",
                    }
                  : { path: join(root, "hello.txt") },
              ),
            },
          },
        ],
      });
      chunk({}, "tool_calls");
    } else {
      chunk({ content: "Hello " });
      chunk({ content: toolDone ? "tool complete" : "world" });
      chunk({}, "stop");
    }
    if (data.stream_options?.include_usage)
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage: { prompt_tokens: options.highUsageRequest === requests.length ? 24000 : 11, completion_tokens: 3, total_tokens: options.highUsageRequest === requests.length ? 24003 : 14, prompt_tokens_details: { cached_tokens: 2 } } })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address() as { port: number };
  const events: Array<{ name: string; payload: any }> = [];
  const engine = await createEngineHandlers({
    extensionFactories: options.extensions,
    userDataDir: root,
    safeStorage: secureStorage,
    emit: (name, payload) => events.push({ name, payload }),
    shell: {
      openPath: async () => "",
      openExternal: async () => {},
      showItemInFolder: () => {},
    },
  });
  cleanups.push(engine.dispose);
  const call = async (name: string, payload: Record<string, unknown> = {}) =>
    engine.handlers[name]!(payload);
  await call("providers_save_provider", {
    provider: {
      id: "fixture",
      providerKind: "custom",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiBackend: "chat_completions",
      authScheme: "bearer",
      apiKey: "private-test-key",
    },
  });
  await call("providers_save_model", {
    model: { modelId: "fixture", providerId: "fixture", contextWindow: 32000 },
  });
  await call("agent_init", { cwd: root });
  const sid = (await call("agent_new_session", {
    cwd: root,
    modelId: "fixture",
  })) as string;
  await writeFile(join(root, "hello.txt"), "real tool result");
  return {
    root,
    engine,
    call,
    sid,
    events,
    requests,
    get releaseFirst() {
      return releaseFirst;
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

describe("real Pi SDK with local OpenAI protocol fixture", () => {
  it("streams real SDK text, restores persisted session, and never stores or returns plaintext keys", async () => {
    const f = await fixture();
    await f.call("agent_send", { sessionId: f.sid, text: "hello" });
    const deltas = f.events.filter(
      (e) =>
        e.name === "agent://event" && e.payload.event.type === "message_update",
    );
    expect(
      deltas.some(
        (e) => e.payload.event.assistantMessageEvent.type === "text_delta",
      ),
    ).toBe(true);
    expect(
      f.events.some((e) => e.payload.event?.type === "agent_settled"),
    ).toBe(true);
    expect(((await f.call("providers_list")) as any).providers[0].apiKey).toBe(
      "••••",
    );
    expect(
      await f.call("agent_session_usage", { sessionId: f.sid }),
    ).toMatchObject({
      usage: {
        inputTokens: 11,
        outputTokens: 3,
        totalTokens: 14,
        cachedReadTokens: 2,
      },
    });
    await f.call("agent_shutdown");
    f.events.length = 0;
    // Loading returns a snapshot of the history instead of replaying events.
    const snapshot = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(snapshot.messages.some((m: any) => m.role === "assistant")).toBe(true);
    expect(snapshot.messages.some((m: any) => m.role === "user")).toBe(true);
    expect(f.events.some((e) => e.name === "agent://event" && e.payload.event?.type === "message_end")).toBe(false);
    const files = await readdir(join(f.root, "pi"));
    expect(files).not.toContain("auth.json");
    for (const name of files.filter((n) => n.endsWith(".json")))
      expect(await readFile(join(f.root, "pi", name), "utf8")).not.toContain(
        "private-test-key",
      );
    await expect(
      f.call("agent_load_session", {
        sessionId: "/tmp/foreign.jsonl",
        cwd: f.root,
      }),
    ).rejects.toThrow();
  });
  it("retries a real 429 response and settles only after successful recovery", async () => {
    const f = await fixture({ rateLimitOnce: true });
    await f.call("agent_send", { sessionId: f.sid, text: "retry test" });
    expect(f.requests.length).toBeGreaterThanOrEqual(2);
    const events = f.events
      .filter((e) => e.name === "agent://event")
      .map((e) => e.payload.event);
    expect(events.some((e) => e.type === "auto_retry_start")).toBe(true);
    expect(events.some((e) => e.type === "auto_retry_end" && e.success)).toBe(
      true,
    );
    expect(events.filter((e) => e.type === "agent_settled")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "agent_settled",
      aborted: false,
    });
    expect(
      events.some(
        (e) =>
          e.type === "message_end" &&
          e.message?.role === "assistant" &&
          e.message.stopReason === "stop",
      ),
    ).toBe(true);
    expect(f.events.some((e) => e.name === "agent://turn-error")).toBe(false);
  }, 15000);
  it("automatically compacts local history before its final settled event", async () => {
    const f = await fixture({ highUsageRequest: 2 });
    await f.call("agent_send", { sessionId: f.sid, text: "A".repeat(90000) });
    f.events.length = 0;
    await f.call("agent_send", { sessionId: f.sid, text: "B".repeat(90000) });
    const events = f.events
      .filter((e) => e.name === "agent://event")
      .map((e) => e.payload.event);
    expect(
      events.some(
        (e) => e.type === "compaction_start" && e.reason === "threshold",
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "compaction_end" && !e.aborted && e.result),
    ).toBe(true);
    expect(events.filter((e) => e.type === "agent_settled")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "agent_settled",
      aborted: false,
    });
    expect(
      await f.call("agent_session_info", { sessionId: f.sid }),
    ).toMatchObject({ context: { compactionCount: 1 } });
  });
  it("keeps provider identity and real thinking across ambiguous switches, defaults and restart", async () => {
    const f = await fixture();
    const base = ((await f.call("providers_list")) as any).providers[0].baseUrl;
    await f.call("providers_save_provider", {
      provider: {
        id: "second",
        providerKind: "custom",
        baseUrl: base,
        apiKey: "second-private-key",
      },
    });
    await f.call("providers_save_model", {
      model: {
        providerId: "second",
        modelId: "fixture",
        reasoning: true,
        compat: { supportsReasoningEffort: true },
      },
    });
    await expect(
      f.call("agent_set_model", { sessionId: f.sid, modelId: "fixture" }),
    ).rejects.toThrow("ambiguous");
    await expect(
      f.call("agent_new_session", {
        cwd: f.root,
        modelId: "missing",
        providerId: "second",
      }),
    ).rejects.toThrow("model_not_found");
    expect(
      await f.call("agent_get_model_state", { sessionId: f.sid }),
    ).toMatchObject({
      providerId: "fixture",
      modelKey: "model:fixture/fixture",
      availableThinkingLevels: ["off"],
    });
    await expect(
      f.call("agent_set_thinking_level", { sessionId: f.sid, level: "high" }),
    ).rejects.toThrow("unsupported_thinking_level");
    await f.call("providers_save_provider", {
      provider: { id: "no-key", providerKind: "custom", baseUrl: base },
    });
    await f.call("providers_save_model", {
      model: { providerId: "no-key", modelId: "fixture" },
    });
    await expect(
      f.call("agent_set_model", {
        sessionId: f.sid,
        modelId: "fixture",
        providerId: "no-key",
      }),
    ).rejects.toThrow("model_auth_missing");
    expect(
      await f.call("agent_get_model_state", { sessionId: f.sid }),
    ).toMatchObject({ providerId: "fixture" });
    const selected = (await f.call("agent_set_model", {
      sessionId: f.sid,
      providerId: "second",
      modelId: "fixture",
    })) as any;
    expect(selected.availableThinkingLevels).toContain("high");
    await f.call("agent_set_thinking_level", {
      sessionId: f.sid,
      level: "high",
    });
    await f.call("agent_send", { sessionId: f.sid, text: "reasoning request" });
    expect(f.requests.at(-1)).toMatchObject({
      model: "fixture",
      _authorization: "Bearer second-private-key",
      reasoning_effort: "high",
    });
    await f.call("agents_defaults_save", {
      defaults: {
        defaultModel: "fixture",
        defaultProviderId: "second",
        defaultThinkingLevel: "high",
        defaultPermission: "ask",
      },
    });
    expect(await f.call("agents_defaults_get")).toMatchObject({
      defaultModel: "model:second/fixture",
      defaultProviderId: "second",
      defaultThinkingLevel: "high",
    });
    await f.engine.dispose();
    const restarted = await createEngineHandlers({
      userDataDir: f.root,
      safeStorage: secureStorage,
      emit: () => {},
      shell: {
        openPath: async () => "",
        openExternal: async () => {},
        showItemInFolder: () => {},
      },
    });
    cleanups.push(restarted.dispose);
    expect(
      await restarted.handlers.agent_load_session({
        sessionId: f.sid,
        cwd: f.root,
      }),
    ).toMatchObject({
      providerId: "second",
      modelId: "fixture",
      thinkingLevel: "high",
    });
    await restarted.handlers.agent_send({
      sessionId: f.sid,
      text: "after restored reasoning",
    });
    expect(f.requests.at(-1)).toMatchObject({
      _authorization: "Bearer second-private-key",
      reasoning_effort: "high",
    });
    const fresh = await restarted.handlers.agent_new_session({ cwd: f.root });
    expect(
      await restarted.handlers.agent_get_model_state({ sessionId: fresh }),
    ).toMatchObject({ providerId: "second", thinkingLevel: "high" });
    await restarted.handlers.providers_delete_model({
      providerId: "fixture",
      modelId: "fixture",
    });
    expect(
      ((await restarted.handlers.providers_list({})) as any).models.some(
        (m: any) => m.providerId === "second" && m.modelId === "fixture",
      ),
    ).toBe(true);
    await restarted.handlers.providers_delete_model({
      providerId: "second",
      modelId: "fixture",
    });
    expect(await restarted.handlers.agents_defaults_get({})).toMatchObject({
      defaultModel: "model:second/fixture",
      invalidDefault: true,
    });
    await expect(
      restarted.handlers.agent_new_session({ cwd: f.root }),
    ).rejects.toThrow("model_not_found");
    expect(
      await restarted.handlers.agent_get_model_state({ sessionId: fresh }),
    ).toMatchObject({ providerId: "second" });
    await expect(
      restarted.handlers.agent_send({
        sessionId: fresh,
        text: "deleted selection",
      }),
    ).rejects.toThrow("model_not_found");
  });
  it("bridges real SDK extension dialogs, keeps pending input across session switches and cancels it on cancel, delete and shutdown", async () => {
    const answers: unknown[] = [];
    const extension: ExtensionFactory = (pi) => {
      pi.registerCommand("fixture-ui", {
        description: "Ask through host UI",
        handler: async (_args, ctx) => {
          answers.push(await ctx.ui.select("Choice", ["one", "two"]));
          answers.push(await ctx.ui.confirm("Confirm", "Proceed?"));
          answers.push(await ctx.ui.input("Input", "Type here"));
          answers.push(await ctx.ui.editor("Editor", "initial"));
          ctx.ui.notify("Finished");
          ctx.ui.setStatus("fixture", "done");
        },
      });
      pi.registerCommand("fixture-pending", {
        handler: async (_args, ctx) => {
          answers.push(await ctx.ui.input("Pending"));
        },
      });
    };
    const f = await fixture({ extensions: [extension] });
    const turn = f.call("agent_send", {
      sessionId: f.sid,
      text: "/fixture-ui",
    });
    for (const [kind, value] of [
      ["select", "two"],
      ["confirm", true],
      ["input", "answer"],
      ["editor", "edited"],
    ] as const) {
      await until(() =>
        f.events.some(
          (e) => e.name === "agent://ui-request" && e.payload.kind === kind,
        ),
      );
      const p = f.events.find(
        (e) => e.name === "agent://ui-request" && e.payload.kind === kind,
      )!.payload;
      await f.call(
        kind === "input" ? "agent_resolve_question" : "agent_resolve_ui",
        { requestId: p.requestId, sessionId: f.sid, value },
      );
    }
    await turn;
    expect(answers).toEqual(["two", true, "answer", "edited"]);
    expect(
      f.events.some(
        (e) =>
          e.name === "agent://ui-notification" &&
          e.payload.message === "Finished",
      ),
    ).toBe(true);
    for (const mode of ["cancel", "switch-then-delete", "shutdown"]) {
      const sid =
        mode === "cancel"
          ? f.sid
          : await f.call("agent_new_session", {
              cwd: f.root,
              modelId: "fixture",
            });
      f.events.length = 0;
      const pending = f.call("agent_send", {
        sessionId: sid,
        text: "/fixture-pending",
      });
      await until(() => f.events.some((e) => e.name === "agent://ui-request"));
      const p = f.events.find((e) => e.name === "agent://ui-request")!.payload;
      if (mode === "cancel") await f.call("agent_cancel", { sessionId: sid });
      else if (mode === "switch-then-delete") {
        // Opening another task leaves this one running in the pool with its input pending.
        await f.call("agent_new_session", { cwd: f.root, modelId: "fixture" });
        await new Promise((r) => setTimeout(r, 50));
        expect(
          f.events.some((e) => e.name === "agent://ui-dismiss" && e.payload.requestId === p.requestId),
        ).toBe(false);
        expect((await f.call("tasks_list")) as any[]).toEqual(
          expect.arrayContaining([expect.objectContaining({ sessionId: sid })]),
        );
        await f.call("agent_delete_session", { sessionId: sid });
      } else await f.call("agent_shutdown");
      await pending;
      expect(answers.at(-1)).toBeUndefined();
      await expect(
        f.call("agent_resolve_ui", {
          sessionId: sid,
          requestId: p.requestId,
          value: "stale",
        }),
      ).rejects.toThrow();
    }
  });
  it("runs several tasks at once: opening or loading another task never aborts a running one", async () => {
    const f = await fixture({ holdFirst: true });
    const first = f.call("agent_send", { sessionId: f.sid, text: "long task" });
    await until(() => !!f.releaseFirst);
    expect(
      f.events.some((e) => e.name === "agent://session-status" && e.payload.sessionId === f.sid && e.payload.status === "running"),
    ).toBe(true);
    // Open a second task and finish a whole turn there while the first is still streaming.
    const second = (await f.call("agent_new_session", { cwd: f.root, modelId: "fixture" })) as string;
    await f.call("agent_send", { sessionId: second, text: "quick task" });
    expect((await f.call("tasks_list")) as any[]).toEqual([
      expect.objectContaining({ sessionId: f.sid, status: "running" }),
    ]);
    // Re-focusing the running task returns its live snapshot instead of restarting it.
    const live = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(live).toMatchObject({ busy: true, status: "running" });
    f.releaseFirst!();
    await first;
    const done = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(done).toMatchObject({ busy: false });
    expect(JSON.stringify(done.messages)).toContain("Held response complete");
    const other = (await f.call("agent_load_session", { sessionId: second, cwd: f.root })) as any;
    expect(JSON.stringify(other.messages)).toContain("Hello world");
    expect(
      f.events.some((e) => e.name === "agent://session-status" && e.payload.sessionId === f.sid && e.payload.status === "idle"),
    ).toBe(true);
    expect(await f.call("tasks_list")).toEqual([]);
  });
  it("regenerates the last answer and edits from an earlier prompt on the same branch", async () => {
    const f = await fixture();
    await f.call("agent_send", { sessionId: f.sid, text: "first question" });
    await f.call("agent_send", { sessionId: f.sid, text: "second question" });
    const points = (await f.call("rewind_points", { sessionId: f.sid })) as any[];
    expect(points.map((p) => p.preview)).toEqual(["first question", "second question"]);
    const before = f.requests.length;
    f.events.length = 0;
    await f.call("agent_regenerate", { sessionId: f.sid });
    expect(f.requests.length).toBe(before + 1);
    // The renderer rebuilds from session_rewound; the old answer is no longer on the branch.
    expect(f.events.some((e) => e.payload.event?.type === "session_rewound")).toBe(true);
    let snapshot = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(snapshot.messages.filter((m: any) => m.role === "user")).toHaveLength(2);
    expect(snapshot.messages.filter((m: any) => m.role === "assistant")).toHaveLength(2);
    // 从这里编辑: drop the second prompt and return its text for the composer.
    const second = ((await f.call("rewind_points", { sessionId: f.sid })) as any[])[1];
    expect(await f.call("rewind_execute", { sessionId: f.sid, entryId: second.entryId })).toEqual({ editorText: "second question" });
    snapshot = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(snapshot.messages.filter((m: any) => m.role === "user")).toHaveLength(1);
    await expect(
      f.call("rewind_execute", { sessionId: f.sid, entryId: "missing" }),
    ).rejects.toThrow("rewind_point_not_found");
  });
  it("compacts a session on /compact, lists it as a built-in command and refuses while busy", async () => {
    const f = await fixture({ holdFirst: true });
    expect(await f.call("commands_list")).toContainEqual(expect.objectContaining({ name: "compact", source: "builtin" }));
    // Large enough that older history falls outside the recent window kept by compaction.
    const held = f.call("agent_send", { sessionId: f.sid, text: "first question " + "A".repeat(90000) });
    await until(() => !!f.releaseFirst);
    await expect(f.call("agent_compact", { sessionId: f.sid })).rejects.toThrow("忙碌");
    f.releaseFirst!();
    await held;
    await f.call("agent_send", { sessionId: f.sid, text: "second question " + "B".repeat(90000) });
    f.events.length = 0;
    const result = (await f.call("agent_compact", { sessionId: f.sid, instructions: "keep decisions" })) as any;
    expect(result.tokensBefore).toBeGreaterThan(0);
    const types = f.events.filter((e) => e.name === "agent://event").map((e) => e.payload.event.type);
    expect(types).toEqual(expect.arrayContaining(["compaction_start", "compaction_end"]));
    expect(f.events.filter((e) => e.name === "agent://session-status").map((e) => e.payload.status)).toEqual(["running", "idle"]);
    expect(JSON.stringify(f.requests.at(-1))).toContain("keep decisions");
    // A second /compact right after has nothing new to summarise.
    await expect(f.call("agent_compact", { sessionId: f.sid })).rejects.toThrow("Already compacted");
    expect((await f.call("agent_session_info", { sessionId: f.sid })) as any).toMatchObject({ context: { compactionCount: 1 } });
  });
  it("delivers real SDK steering/follow-up queues, clears removed inputs and settles after all queued work", async () => {
    const f = await fixture({ holdFirst: true });
    const turn = f.call("agent_send", {
      sessionId: f.sid,
      text: "initial request",
    });
    await until(() => !!f.releaseFirst);
    await f.call("agent_steer", {
      sessionId: f.sid,
      text: "remove this steering",
    });
    await f.call("agent_follow_up", {
      sessionId: f.sid,
      text: "remove this followup",
    });
    expect(await f.call("agent_get_queue", { sessionId: f.sid })).toMatchObject(
      {
        steering: ["remove this steering"],
        followUp: ["remove this followup"],
      },
    );
    expect(
      await f.call("agent_clear_queue", { sessionId: f.sid }),
    ).toMatchObject({
      steering: ["remove this steering"],
      followUp: ["remove this followup"],
    });
    await f.call("agent_steer", { sessionId: f.sid, text: "real steering" });
    await f.call("agent_follow_up", {
      sessionId: f.sid,
      text: "real followup",
    });
    f.releaseFirst!();
    await turn;
    expect(f.requests.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(f.requests)).toContain("real steering");
    expect(JSON.stringify(f.requests)).toContain("real followup");
    expect(JSON.stringify(f.requests)).not.toContain("remove this");
    expect(await f.call("agent_get_queue", { sessionId: f.sid })).toEqual({
      steering: [],
      followUp: [],
    });
    expect(
      f.events.filter((e) => e.payload.event?.type === "agent_settled"),
    ).toHaveLength(1);
  });
  it("passes real image content only to a vision model and rejects unsupported image prompts before HTTP", async () => {
    const f = await fixture();
    const images = [
      {
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
      },
    ];
    await expect(
      f.call("agent_send", { sessionId: f.sid, text: "look", images }),
    ).rejects.toThrow("model_does_not_support_images");
    expect(f.requests).toHaveLength(0);
    await f.call("providers_save_model", {
      model: {
        providerId: "fixture",
        modelId: "vision",
        input: ["text", "image"],
      },
    });
    await f.call("agent_set_model", {
      sessionId: f.sid,
      providerId: "fixture",
      modelId: "vision",
    });
    await f.call("agent_send", { sessionId: f.sid, text: "look", images });
    expect(JSON.stringify((f.requests[0] as any).messages)).toContain(
      "data:image/png;base64,",
    );
  });
  it("forks persisted history into a new id while preserving the selected provider and thinking level", async () => {
    const f = await fixture();
    await f.call("providers_save_model", {
      model: {
        providerId: "fixture",
        modelId: "reasoning",
        reasoning: true,
        compat: { supportsReasoningEffort: true },
      },
    });
    await f.call("agent_set_model", {
      sessionId: f.sid,
      providerId: "fixture",
      modelId: "reasoning",
    });
    await f.call("agent_set_thinking_level", {
      sessionId: f.sid,
      level: "high",
    });
    await f.call("agent_send", { sessionId: f.sid, text: "parent history" });
    const fork = await f.call("agent_fork_session", { sessionId: f.sid });
    expect(fork).not.toBe(f.sid);
    expect(
      await f.call("agent_get_model_state", { sessionId: fork }),
    ).toMatchObject({
      providerId: "fixture",
      modelId: "reasoning",
      thinkingLevel: "high",
    });
    expect(
      ((await f.call("agent_list_sessions", { cwd: f.root })) as any[]).map(
        (s) => s.sessionId,
      ),
    ).toEqual(expect.arrayContaining([f.sid, fork]));
    await f.call("agent_send", { sessionId: fork, text: "fork continuation" });
    expect(JSON.stringify(f.requests.at(-1))).toContain("parent history");
    await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root });
    expect(
      JSON.stringify(await f.call("agent_session_usage", { sessionId: f.sid })),
    ).toContain("numTurns");
  });
  it("loads only explicitly enabled extension paths and rolls back a failed reload", async () => {
    const f = await fixture();
    const extension = join(f.root, "trusted-extension.mjs");
    await writeFile(
      extension,
      `export default function(pi){ pi.registerCommand('disk-fixture',{description:'Disk extension',handler:async(_args,ctx)=>{const value=await ctx.ui.input('Disk input');ctx.ui.notify(value===undefined?'cancelled':'received');}}); }`,
    );
    await f.call("agent_extensions_add", { path: extension });
    expect(await f.call("commands_list")).not.toContainEqual(
      expect.objectContaining({ name: "disk-fixture" }),
    );
    await f.call("agent_extensions_set_enabled", { enabled: true });
    expect(await f.call("commands_list")).toContainEqual(
      expect.objectContaining({ name: "disk-fixture" }),
    );
    const pending = f.call("agent_send", {
      sessionId: f.sid,
      text: "/disk-fixture",
    });
    await until(() =>
      f.events.some(
        (e) =>
          e.name === "agent://ui-request" && e.payload.title === "Disk input",
      ),
    );
    // A busy session is not interrupted: the change is saved and applied once it settles.
    expect(
      await f.call("agent_extensions_set_enabled", { enabled: false }),
    ).toMatchObject({ enabled: false });
    expect(
      f.events.some((e) => e.name === "agent://ui-dismiss"),
    ).toBe(false);
    await f.call("agent_cancel", { sessionId: f.sid });
    await pending;
    let names: string[] = [];
    const end = Date.now() + 10000;
    do {
      await new Promise((r) => setTimeout(r, 20));
      names = ((await f.call("commands_list").catch(() => [])) as any[]).map((c) => c.name);
    } while (names.includes("disk-fixture") && Date.now() < end);
    expect(names).not.toContain("disk-fixture");
    await f.call("agent_extensions_set_enabled", { enabled: true });
    const bad = join(f.root, "broken-extension.mjs");
    await writeFile(bad, 'throw new Error("broken extension");');
    await expect(f.call("agent_extensions_add", { path: bad })).rejects.toThrow(
      "extension_load_failed",
    );
    expect(
      ((await f.call("agent_extensions_list")) as any).paths,
    ).not.toContain(bad);
    expect(
      await f.call("agent_get_model_state", { sessionId: f.sid }),
    ).toMatchObject({ providerId: "fixture" });
    await f.call("agent_extensions_set_enabled", { enabled: false });
    expect(await f.call("commands_list")).not.toContainEqual(
      expect.objectContaining({ name: "disk-fixture" }),
    );
  });
  it("gates automatic project extensions on explicit enablement and workspace trust", async () => {
    const f = await fixture();
    const dir = join(f.root, ".pi", "extensions");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "project.js"),
      `export default function(pi){pi.registerCommand('project-fixture',{handler:async()=>{}});}`,
    );
    await f.call("agent_extensions_set_enabled", { enabled: true });
    expect(await f.call("commands_list")).not.toContainEqual(
      expect.objectContaining({ name: "project-fixture" }),
    );
    await f.call("folder_trust_respond", { cwd: f.root, trusted: true });
    await f.call("agent_extensions_set_enabled", { enabled: true });
    expect(await f.call("commands_list")).toContainEqual(
      expect.objectContaining({ name: "project-fixture" }),
    );
    await f.call("folder_trust_respond", { cwd: f.root, trusted: false });
    expect(await f.call("commands_list")).not.toContainEqual(
      expect.objectContaining({ name: "project-fixture" }),
    );
    await f.call("agent_extensions_set_enabled", { enabled: false });
    expect(await f.call("commands_list")).not.toContainEqual(
      expect.objectContaining({ name: "project-fixture" }),
    );
  });
  it("replays an untrusted-folder card until it is answered (20261117-mobile.md §2.4 path 3)", async () => {
    const f = await fixture();
    // Opening the session is what emits agent://folder-trust once; the request
    // is kept so a client that was away can rebuild it.
    await f.call("agent_load_session", { sessionId: f.sid });
    const pending = (await f.call("trust_pending", {})) as {
      requests: { cwd: string; sessionId: string }[];
    };
    expect(pending.requests).toHaveLength(1);
    expect(pending.requests[0].sessionId).toBe(f.sid);
    // The engine realpaths the folder, so compare against what it returned.
    const cwd = pending.requests[0].cwd;
    expect(
      ((await f.call("trust_pending", { sessionId: f.sid })) as typeof pending)
        .requests,
    ).toHaveLength(1);
    expect(
      ((await f.call("trust_pending", { sessionId: "other" })) as typeof pending)
        .requests,
    ).toEqual([]);
    await f.call("folder_trust_respond", { cwd, trusted: true });
    expect(
      ((await f.call("trust_pending", {})) as typeof pending).requests,
    ).toEqual([]);
  });
  it("rejects failed extension commands and never reports a synthetic successful completion", async () => {
    const f = await fixture({
      extensions: [
        (pi) => {
          pi.registerCommand("unsupported-ui", {
            handler: async (_args, ctx) => {
              // Terminal-only UI degrades to a no-op; the command itself then fails.
              await ctx.ui.custom(() => {
                throw Error("never");
              });
              throw Error("extension_failed: needs a terminal");
            },
          });
        },
      ],
    });
    f.events.length = 0;
    await expect(
      f.call("agent_send", { sessionId: f.sid, text: "/unsupported-ui" }),
    ).rejects.toThrow("extension_failed");
    // One error path: the rejected send carries the error; the task is marked failed, not completed.
    expect(f.events.some((e) => e.name === "agent://turn-error")).toBe(false);
    expect(
      f.events.some((e) => e.name === "agent://session-status" && e.payload.status === "failed"),
    ).toBe(true);
    expect(
      f.events.some(
        (e) =>
          e.payload.event?.commandHandled && e.payload.event.aborted === false,
      ),
    ).toBe(false);
  });
  it("executes the real read tool only after an explicit matching permission", async () => {
    const f = await fixture();
    const turn = f.call("agent_send", {
      sessionId: f.sid,
      text: "tool please",
    });
    await until(() => f.events.some((e) => e.name === "agent://permission"));
    const request = f.events.find(
      (e) => e.name === "agent://permission",
    )!.payload;
    await f.call("agent_resolve_permission", {
      requestId: request.requestId,
      optionId: "allow",
    });
    await turn;
    const tool = f.events.find(
      (e) => e.payload.event?.type === "tool_execution_end",
    );
    expect(JSON.stringify(tool)).toContain("real tool result");
    expect(f.requests.length).toBe(2);
  });
  it("denies tool calls and releases pending permission on cancellation", async () => {
    const f = await fixture();
    const turn = f.call("agent_send", {
      sessionId: f.sid,
      text: "tool write deny",
    });
    await until(() => f.events.some((e) => e.name === "agent://permission"));
    const request = f.events.find(
      (e) => e.name === "agent://permission",
    )!.payload;
    await f.call("agent_resolve_permission", {
      requestId: request.requestId,
      optionId: "deny",
    });
    await turn;
    await expect(readFile(join(f.root, "blocked.txt"))).rejects.toThrow();
    const denied = f.events.find(
      (e) => e.payload.event?.type === "tool_execution_end",
    )!.payload.event;
    expect(denied.toolCallId).toBe("fixture-write");
    expect(denied.isError).toBe(true);
    const secondRequest = f.requests[1] as any;
    expect(
      secondRequest.messages.some(
        (m: any) =>
          m.role === "tool" &&
          m.tool_call_id === "fixture-write" &&
          m.content.includes("拒绝"),
      ),
    ).toBe(true);
    await f.call("agent_send", {
      sessionId: f.sid,
      text: "hello after denial",
    });
    f.events.length = 0;
    const pending = f.call("agent_send", {
      sessionId: f.sid,
      text: "tool pending",
    });
    await until(() => f.events.some((e) => e.name === "agent://permission"));
    await f.call("agent_cancel", { sessionId: f.sid });
    await pending;
    await expect(
      f.call("agent_resolve_permission", {
        requestId: f.events.find((e) => e.name === "agent://permission")!
          .payload.requestId,
        optionId: "allow",
      }),
    ).rejects.toThrow();
  });
  it("keeps metadata and model selection across a full engine restart", async () => {
    const f = await fixture();
    await f.call("agent_set_session_pinned", {
      sessionId: f.sid,
      pinned: true,
    });
    await f.call("agent_send", { sessionId: f.sid, text: "metadata" });
    await f.call("agent_rename_session", {
      sessionId: f.sid,
      title: "Saved title",
    });
    await f.call("agent_set_session_archived", {
      sessionId: f.sid,
      archived: true,
    });
    await f.engine.dispose();
    const restarted = await createEngineHandlers({
      userDataDir: f.root,
      safeStorage: secureStorage,
      emit: () => {},
      shell: {
        openPath: async () => "",
        openExternal: async () => {},
        showItemInFolder: () => {},
      },
    });
    cleanups.push(restarted.dispose);
    // Archived tasks are hidden from the default list and shown on request.
    expect(
      await restarted.handlers.agent_list_sessions({ cwd: f.root }),
    ).toEqual([]);
    const listed = (await restarted.handlers.agent_list_sessions({
      cwd: f.root,
      includeArchived: true,
    })) as any[];
    expect(listed[0]).toMatchObject({
      sessionId: f.sid,
      title: "Saved title",
      pinned: true,
      archived: true,
      currentModelId: "fixture",
    });
    await restarted.handlers.agent_load_session({
      sessionId: f.sid,
      cwd: f.root,
    });
    expect(
      await restarted.handlers.agent_session_usage({ sessionId: f.sid }),
    ).toMatchObject({ usage: { numTurns: 1 } });
    await restarted.handlers.agent_delete_session({ sessionId: f.sid });
    expect(
      await restarted.handlers.agent_list_sessions({ cwd: f.root, includeArchived: true }),
    ).toEqual([]);
  });
  it("sends with a switched model and restores that model for requests after an engine restart", async () => {
    const f = await fixture();
    await f.call("agent_send", {
      sessionId: f.sid,
      text: "before model switch",
    });
    expect(f.requests.at(-1)).toMatchObject({ model: "fixture" });
    await f.call("providers_save_model", {
      model: {
        modelId: "fixture-second",
        providerId: "fixture",
        contextWindow: 48000,
      },
    });
    await f.call("agent_set_model", {
      sessionId: f.sid,
      modelId: "fixture-second",
    });
    await f.call("agent_send", {
      sessionId: f.sid,
      text: "after model switch",
    });
    expect(f.requests.at(-1)).toMatchObject({ model: "fixture-second" });
    await f.engine.dispose();
    const restarted = await createEngineHandlers({
      userDataDir: f.root,
      safeStorage: secureStorage,
      emit: () => {},
      shell: {
        openPath: async () => "",
        openExternal: async () => {},
        showItemInFolder: () => {},
      },
    });
    cleanups.push(restarted.dispose);
    expect(
      await restarted.handlers.agent_list_sessions({ cwd: f.root }),
    ).toContainEqual(
      expect.objectContaining({
        sessionId: f.sid,
        currentModelId: "fixture-second",
      }),
    );
    await restarted.handlers.agent_load_session({
      sessionId: f.sid,
      cwd: f.root,
    });
    const count = f.requests.length;
    await restarted.handlers.agent_send({
      sessionId: f.sid,
      text: "after engine restart",
    });
    expect(f.requests).toHaveLength(count + 1);
    expect(f.requests.at(-1)).toMatchObject({ model: "fixture-second" });
    expect(
      await restarted.handlers.agent_session_info({ sessionId: f.sid }),
    ).toMatchObject({ model: "fixture-second", context: { total: 48000 } });
  });
  it("reloads real SDK skills and commands without changing an empty session id", async () => {
    const f = await fixture();
    const skill = join(f.root, "local-skill.md");
    await writeFile(
      skill,
      "---\nname: fixture-skill\ndescription: Fixture skill for integration checks\n---\nDo something helpful.\n",
    );
    await f.call("skills_add", { path: skill });
    expect(await f.call("commands_list")).toContainEqual(
      expect.objectContaining({ name: "skill:fixture-skill" }),
    );
    await f.call("skills_toggle", { name: "fixture-skill", enabled: false });
    expect(await f.call("commands_list")).not.toContainEqual(
      expect.objectContaining({ name: "skill:fixture-skill" }),
    );
    expect(await f.call("skills_list", { cwd: f.root })).toContainEqual(
      expect.objectContaining({ name: "fixture-skill", enabled: false }),
    );
    await f.call("agent_send", {
      sessionId: f.sid,
      text: "hello after skills reload",
    });
  });
  it("loads a real stdio MCP server and routes its tool through permissions", async () => {
    const f = await fixture();
    const serverPath = join(f.root, "mcp-server.cjs");
    await writeFile(
      serverPath,
      `const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;
let result={};if(r.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
if(r.method==='tools/list')result={tools:[{name:'ping',description:'Fixture ping',inputSchema:{type:'object',properties:{}}}]};
if(r.method==='tools/call')result={content:[{type:'text',text:'real MCP result'}]};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`,
    );
    await f.call("mcp_upsert", {
      sessionId: f.sid,
      server: {
        name: "fixture",
        transport: "stdio",
        target: process.execPath,
        args: [serverPath],
        env: { FIXTURE_TOKEN: "secret-mcp-token" },
        enabled: true,
      },
    });
    expect(JSON.stringify(await f.call("mcp_config_read"))).not.toContain(
      "secret-mcp-token",
    );
    const turn = f.call("agent_send", {
      sessionId: f.sid,
      text: "tool mcp please",
    });
    await until(() =>
      f.events.some(
        (e) =>
          e.name === "agent://permission" &&
          e.payload.toolKind === "mcp__fixture__ping",
      ),
    );
    const request = f.events.find(
      (e) =>
        e.name === "agent://permission" &&
        e.payload.toolKind === "mcp__fixture__ping",
    )!.payload;
    await f.call("agent_resolve_permission", {
      requestId: request.requestId,
      optionId: "allow",
    });
    await turn;
    expect(
      JSON.stringify(
        f.events.find(
          (e) =>
            e.payload.event?.type === "tool_execution_end" &&
            e.payload.event.toolName === "mcp__fixture__ping",
        ),
      ),
    ).toContain("real MCP result");
    await f.call("mcp_toggle", {
      sessionId: f.sid,
      name: "fixture",
      enabled: false,
    });
    expect(((await f.call("mcp_list")) as any)[0].enabled).toBe(false);
  });
  it("shutdown rejects a waiting write permission and prevents a stale approval in another session", async () => {
    const f = await fixture();
    const turn = f.call("agent_send", {
      sessionId: f.sid,
      text: "tool write pending",
    });
    await until(() => f.events.some((e) => e.name === "agent://permission"));
    const request = f.events.find(
      (e) => e.name === "agent://permission",
    )!.payload;
    await f.call("agent_shutdown");
    await turn;
    await expect(readFile(join(f.root, "blocked.txt"))).rejects.toThrow();
    await f.call("agent_new_session", { cwd: f.root, modelId: "fixture" });
    await expect(
      f.call("agent_resolve_permission", {
        requestId: request.requestId,
        optionId: "allow",
      }),
    ).rejects.toThrow();
  });
  it("aborts an active HTTP stream through the real SDK", async () => {
    const f = await fixture();
    const turn = f.call("agent_send", {
      sessionId: f.sid,
      text: "cancel stream",
    });
    await until(() =>
      f.events.some(
        (e) => e.payload.event?.assistantMessageEvent?.type === "text_delta",
      ),
    );
    await f.call("agent_cancel", { sessionId: f.sid });
    await turn;
    expect(
      f.events.some((e) => e.payload.event?.type === "agent_settled"),
    ).toBe(true);
  });
  it("remembers the system-notification switch (on by default)", async () => {
    const f = await fixture();
    expect(await f.call("notification_prefs_get")).toEqual({ system: true });
    expect(await f.call("notification_prefs_set", { system: false })).toEqual({ system: false });
    expect(await f.call("notification_prefs_get")).toEqual({ system: false });
    await expect(f.call("notification_prefs_set", { system: "no" })).rejects.toThrow();
  });
  it("reports nothing (not an error) for a session that is not loaded yet", async () => {
    const f = await fixture();
    expect(await f.call("agent_session_info", { sessionId: "not-loaded-yet" })).toBeNull();
    expect(await f.call("agent_session_usage", { sessionId: "not-loaded-yet" })).toBeNull();
    expect(await f.call("agent_session_info", { sessionId: f.sid })).toMatchObject({ context: expect.any(Object) });
  });
});
