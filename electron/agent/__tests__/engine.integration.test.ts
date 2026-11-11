// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createEngineHandlers } from "../../ipc/handlers/agent.js";

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
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-sdk-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const data = JSON.parse(body);
    requests.push(data);
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
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14, prompt_tokens_details: { cached_tokens: 2 } } })}\n\n`,
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
  return { root, engine, call, sid, events, requests };
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
    await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root });
    expect(
      f.events.some((e) => e.payload.event?.message?.role === "assistant"),
    ).toBe(true);
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
    const listed = (await restarted.handlers.agent_list_sessions({
      cwd: f.root,
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
      await restarted.handlers.agent_list_sessions({ cwd: f.root }),
    ).toEqual([]);
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
    expect(await f.call("commands_list")).toEqual([]);
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
});
