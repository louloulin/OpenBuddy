import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Context } from "@openbuddy/cordis";
import { HarnessPluginLoader } from "@openbuddy/plugin-host";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDeepSeekModule } from "./deepseek-compat";
import { DeepSeekAgentService, type DeepSeekPiToolHooks, type DeepSeekToolDecision, type DeepSeekToolExecution } from "./deepseek-runtime";

type PiAgentSource = {
  sessionId: string;
  cwd: string;
  messages: unknown[];
  isStreaming: boolean;
  prompt: (text: string) => Promise<void>;
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  inject: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  waitForIdle: () => Promise<void>;
  setModel: (provider: string, model: string) => Promise<void>;
  setToolAgent: (agent: unknown) => void;
  setToolHooks: (hooks?: DeepSeekPiToolHooks) => void;
  readonly modelId: string;
  subscribe: (listener: (event: unknown) => void) => () => void;
  getEntries: () => readonly unknown[];
  appendCustomEntry: (customType: string, data?: unknown) => string;
  dispose: () => Promise<void>;
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createPiHarness() {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-deepseek-pi-agentloop-"));
  roots.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  const faux = fauxProvider({
    provider: "openbuddy-faux",
    models: [
      { id: "agentloop-smoke", name: "AgentLoop Smoke", maxTokens: 128 },
      { id: "agentloop-routed", name: "AgentLoop Routed", maxTokens: 128 },
    ],
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const toolCalls: string[] = [];
  const tools = new Map<string, ToolDefinition>();
  const entryReaders = new Map<string, () => readonly unknown[]>();
  const sessionManagers = new Map<string, SessionManager>();
  const createSource = async (sessionManager: SessionManager): Promise<PiAgentSource> => {
    const hookState: { agent?: unknown; hooks?: DeepSeekPiToolHooks } = {};
    const toolList = [...tools.values()].map((tool) => ({
      ...tool,
      async execute(toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: Parameters<ToolDefinition["execute"]>[3], extensionContext: Parameters<ToolDefinition["execute"]>[4]): Promise<Awaited<ReturnType<ToolDefinition["execute"]>>> {
        const hooks = hookState.hooks;
        if (!hooks) return tool.execute(toolCallId, params as never, signal, onUpdate, extensionContext);
        const execution: DeepSeekToolExecution = { agent: hookState.agent, toolCallId, toolName: tool.name, args: params, signal };
        const decision: DeepSeekToolDecision = await hooks.preExecute?.(execution) ?? { kind: "allow" };
        let result: unknown;
        if (decision.kind === "reject") {
          result = { content: [{ type: "text" as const, text: `Error: ${decision.message ?? "tool call rejected"}` }], details: { code: "D2_TOOL_REJECTED" }, isError: true } as Awaited<ReturnType<ToolDefinition["execute"]>>;
        } else {
          result = await (hooks.execute ? hooks.execute(execution, () => tool.execute(toolCallId, params as never, signal, onUpdate, extensionContext)) : tool.execute(toolCallId, params as never, signal, onUpdate, extensionContext));
        }
        const postResult = hooks.postExecute ? await hooks.postExecute(execution, result) : result;
        await hooks.result?.(Object.freeze({ ...execution }), freezeSnapshot(postResult));
        return postResult as Awaited<ReturnType<ToolDefinition["execute"]>>;
      },
    }));
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true });
    await resourceLoader.reload();
    const created = await createAgentSession({
      cwd,
      agentDir,
      model: faux.getModel("agentloop-smoke"),
      modelRuntime,
      sessionManager,
      noTools: "all",
      tools: toolList.map((tool) => tool.name),
      customTools: toolList,
      resourceLoader,
    });
    const session = created.session;
    sessionManagers.set(session.sessionId, session.sessionManager);
    entryReaders.set(session.sessionId, () => session.sessionManager.getEntries());
    return {
      sessionId: session.sessionId,
      cwd,
      get modelId() { return `${session.model?.provider ?? faux.provider}/${session.model?.id ?? "agentloop-smoke"}`; },
      get messages() { return session.state.messages as unknown[]; },
      get isStreaming() { return session.isStreaming; },
      prompt: (text) => session.prompt(text),
      steer: (text) => session.steer(text),
      followUp: (text) => session.followUp(text),
      inject: async (text) => { await session.sendCustomMessage({ customType: "smoke/inject", content: text, display: false }); },
      abort: () => session.abort(),
      waitForIdle: () => session.waitForIdle(),
      setModel: async (provider, model) => {
        const next = modelRuntime.getModel(provider, model);
        if (!next) throw new Error(`missing smoke model: ${provider}/${model}`);
        await session.setModel(next);
      },
      setToolAgent: (agent) => { hookState.agent = agent; },
      setToolHooks: (hooks) => { hookState.hooks = hooks; },
      subscribe: (listener) => session.subscribe(listener as never),
      getEntries: () => session.sessionManager.getEntries(),
      appendCustomEntry: (customType, data) => session.sessionManager.appendCustomEntry(customType, data),
      async dispose() {
        await session.abort().catch(() => undefined);
        await session.waitForIdle().catch(() => undefined);
        session.dispose();
      },
    };
  };
  const listSessions = async () => {
    const persisted = await SessionManager.listAll(agentDir);
    const known = new Map(persisted.map((entry) => [entry.id, entry]));
    for (const manager of sessionManagers.values()) {
      if (!known.has(manager.getSessionId())) {
        known.set(manager.getSessionId(), {
          id: manager.getSessionId(),
          path: manager.getSessionFile(),
        } as Awaited<ReturnType<typeof SessionManager.listAll>>[number]);
      }
    }
    return [...known.values()];
  };
  const host = {
    listAllSessions: async () => listSessions(),
    createAgent: async ({ sessionId, parentSession, signal }: { sessionId: string; parentSession?: string; signal?: AbortSignal }) => {
      signal?.throwIfAborted();
      const manager = SessionManager.create(cwd, agentDir, { id: sessionId, ...(parentSession ? { parentSession } : {}) });
      return createSource(manager);
    },
    resumeAgent: async ({ sessionId, signal }: { sessionId: string; signal?: AbortSignal }) => {
      signal?.throwIfAborted();
      const info = (await listSessions()).find((entry) => entry.id === sessionId);
      if (!info) throw new Error(`missing smoke session: ${sessionId}`);
      return createSource(SessionManager.open(info.path, agentDir, cwd));
    },
  };
  const context = new Context();
  context.provide("agentHost", host);
  context.provide("modelRuntime", modelRuntime);
  context.provide("sessionPersistence", {
    prepare: async (sessionId: string, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (!(await listSessions()).some((entry) => entry.id === sessionId)) throw new Error(`missing smoke session: ${sessionId}`);
      return { dispose: () => undefined };
    },
  });
  const loader = new HarnessPluginLoader({
    context,
    importer: async (specifier) => resolveDeepSeekModule(specifier),
  });
  await loader.load([
    { id: "llm", name: "@deepseek-ai/dsh-llm" },
    { id: "session", name: "@deepseek-ai/dsh-session" },
    { id: "agent", name: "@deepseek-ai/dsh-agent" },
    { id: "agent-loop", name: "@deepseek-ai/dsh-agent-loop" },
  ]);
  return {
    context,
    loader,
    agentDir,
    faux,
    tools,
    toolCalls,
    getEntries: (sessionId: string) => entryReaders.get(sessionId)?.() ?? [],
    appendEntry: (sessionId: string, customType: string, data: unknown) => sessionManagers.get(sessionId)?.appendCustomEntry(customType, data),
    agents: context.get("agents") as DeepSeekAgentService,
  };
}

function textFromMessages(messages: readonly unknown[]): string {
  return JSON.stringify(messages);
}

function freezeSnapshot(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const freeze = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) return candidate;
    seen.add(candidate);
    for (const nested of Object.values(candidate as Record<string, unknown>)) freeze(nested);
    return Object.freeze(candidate);
  };
  return freeze(value);
}

describe("DeepSeek AgentLoop on the real Pi AgentSession", () => {
  it("executes prompt and custom tool calls through one Pi session", async () => {
    const harness = await createPiHarness();
    harness.tools.set("smoke_tool", {
      name: "smoke_tool",
      label: "Smoke Tool",
      description: "Records a deterministic smoke tool call.",
      parameters: Type.Object({ value: Type.String() }),
      execute: async (_toolCallId, params) => {
        const input = params as { value: string };
        harness.toolCalls.push(input.value);
        return { content: [{ type: "text", text: `tool:${input.value}` }], details: { value: input.value } };
      },
    });
    harness.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("smoke_tool", { value: "from-pi" })),
      fauxAssistantMessage("Pi completed the tool turn."),
    ]);
    const events: string[] = [];
    const structured: string[] = [];
    const toolLifecycle: string[] = [];
    harness.context.on("agent/session-start", ({ source }: { source: string }) => events.push(`start:${source}`));
    harness.context.on("session/event", (_session: unknown, event: { type: string }) => events.push(event.type));
    harness.context.on("agent/status", ({ agent, status }: { agent: { id: string }; status: string }) => structured.push(`status:${agent.id}:${status}`));
    harness.context.on("turn/start", ({ turn }: { turn: number }) => structured.push(`turn:${turn}`));
    harness.context.on("step/start", ({ turn, step }: { turn: number; step: number }) => structured.push(`step:${turn}:${step}`));
    harness.context.on("agent/pre-step", ({ turn, step }: { turn: number; step: number }) => structured.push(`pre:${turn}:${step}`));
    harness.context.on("agent/end", ({ turn, step }: { turn: number; step: number }) => structured.push(`end:${turn}:${step}`));
    harness.context.on("tool/start", ({ toolName }: { toolName: string }) => toolLifecycle.push(`start:${toolName}`));
    harness.context.on("tool/end", ({ toolName, isError }: { toolName: string; isError: boolean }) => toolLifecycle.push(`end:${toolName}:${isError}`));
    const handle = await harness.agents.create({ sessionId: "pi-execution", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await handle.agent.prompt("run the smoke tool");
    await handle.agent.whenIdle();
    expect(harness.toolCalls).toEqual(["from-pi"]);
    expect(textFromMessages(handle.agent.messages)).toContain("Pi completed the tool turn.");
    expect(events[0]).toBe("start:startup");
    expect(events).toContain("agent_start");
    expect(events).toContain("tool_execution_start");
    expect(events).toContain("tool_execution_end");
    expect(toolLifecycle).toEqual(["start:smoke_tool", "end:smoke_tool:false"]);
    expect(structured).toEqual(["status:pi-execution:running", "turn:1", "pre:1:1", "step:1:1", "step:1:2", "pre:1:2", "status:pi-execution:idle", "end:1:2"]);
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("persists setup transactions and repairs an incomplete setup on resume", async () => {
    const harness = await createPiHarness();
    const first = await harness.agents.create({
      sessionId: "pi-setup-transaction",
      setup: async () => () => undefined,
      agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" },
    });
    const setupEntries = () => harness.getEntries("pi-setup-transaction").filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as { type?: string; customType?: string };
      return value.type === "custom" && value.customType === "deepseek/agent-setup";
    }) as Array<{ data?: { operation?: string; revision?: number } }>;
    expect(setupEntries().map((entry) => entry.data?.operation)).toEqual(["begin", "commit"]);
    expect(setupEntries()[0]?.data?.revision).toBe(setupEntries()[1]?.data?.revision);
    harness.faux.setResponses([fauxAssistantMessage("setup transaction persisted")]);
    await first.agent.prompt("persist setup transaction");
    await first.agent.whenIdle();
    harness.appendEntry("pi-setup-transaction", "deepseek/agent-setup", { version: 1, operation: "begin", lifecycleSource: "startup", revision: 99 });
    expect(setupEntries().map((entry) => entry.data?.operation)).toEqual(["begin", "commit", "begin"]);
    await first.dispose();

    const resumed = await harness.agents.resume({
      resumeSessionId: "pi-setup-transaction",
      setup: async () => undefined,
      agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" },
    });
    const persistedInfo = (await SessionManager.listAll(harness.agentDir)).find((entry) => entry.id === "pi-setup-transaction");
    if (!persistedInfo) throw new Error("setup transaction session was not persisted");
    const persistedEntries = SessionManager.open(persistedInfo.path, harness.agentDir).getEntries().filter((entry) => {
      return entry.type === "custom" && entry.customType === "deepseek/agent-setup";
    }) as Array<{ data?: { operation?: string; reason?: string } }>;
    expect(persistedEntries.slice(-4).map((entry) => entry.data?.operation)).toEqual(["begin", "rollback", "begin", "commit"]);
    expect(persistedEntries.slice(-3)[0]?.data?.reason).toBe("recovered-incomplete-setup");
    await resumed.dispose();
    await harness.loader.dispose();
  });

  it("lets a scoped DeepSeek tools/pre-execute hook reject a Pi tool call", async () => {
    const harness = await createPiHarness();
    const stages: string[] = [];
    let observedResult: unknown;
    let observedExecutionFrozen = false;
    let observedResultFrozen = false;
    harness.tools.set("blocked_tool", {
      name: "blocked_tool",
      label: "Blocked Tool",
      description: "Should be blocked by the Harness hook.",
      parameters: Type.Object({ value: Type.String() }),
      execute: async () => {
        harness.toolCalls.push("executed");
        return { content: [{ type: "text", text: "must not execute" }], details: {} };
      },
    });
    harness.context.on("tools/pre-execute", () => ({ kind: "reject", message: "blocked by plugin policy" }));
    harness.context.on("tools/post-execute", async (_execution: unknown, result: unknown, next: () => Promise<unknown>) => {
      stages.push("post");
      return next();
    });
    harness.context.on("tools/result", (execution: unknown, result: unknown) => {
      stages.push("result");
      observedResult = result;
      observedExecutionFrozen = Object.isFrozen(execution);
      observedResultFrozen = Object.isFrozen(result);
    });
    harness.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("blocked_tool", { value: "nope" })),
      fauxAssistantMessage("tool was blocked"),
    ]);
    const handle = await harness.agents.create({ sessionId: "pi-tool-pre-execute-reject", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await handle.agent.prompt("try the blocked tool");
    await handle.agent.whenIdle();
    expect(harness.toolCalls).toEqual([]);
    expect(textFromMessages(handle.agent.messages)).toContain("tool was blocked");
    expect(textFromMessages(handle.agent.messages)).toContain("blocked by plugin policy");
    expect(stages).toEqual(["post", "result"]);
    expect(observedResult).toMatchObject({ isError: true });
    expect(observedExecutionFrozen).toBe(true);
    expect(observedResultFrozen).toBe(true);
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("runs DeepSeek tool execute and post-execute hooks around the Pi tool", async () => {
    const harness = await createPiHarness();
    const phases: string[] = [];
    harness.tools.set("wrapped_tool", {
      name: "wrapped_tool",
      label: "Wrapped Tool",
      description: "Verifies the DeepSeek tool around hooks.",
      parameters: Type.Object({ value: Type.String() }),
      execute: async (_toolCallId, params) => {
        const input = params as { value: string };
        harness.toolCalls.push(input.value);
        return { content: [{ type: "text" as const, text: `body:${input.value}` }], details: { source: "body" } };
      },
    });
    harness.context.on("tools/execute", async (execution: { toolName: string }, next: () => Promise<unknown>) => {
      phases.push(`before:${execution.toolName}`);
      const result = await next();
      phases.push("after");
      return result;
    });
    harness.context.on("tools/post-execute", async (execution: { toolName: string }, _result: unknown, next: () => Promise<unknown>) => {
      phases.push(`post:${execution.toolName}`);
      const value = await next();
      return { ...(value as Record<string, unknown>), details: { source: "post", tool: execution.toolName } };
    });
    harness.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("wrapped_tool", { value: "around" })),
      fauxAssistantMessage("wrapped tool completed"),
    ]);
    const handle = await harness.agents.create({ sessionId: "pi-tool-around", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await handle.agent.prompt("run the wrapped tool");
    await handle.agent.whenIdle();
    expect(harness.toolCalls).toEqual(["around"]);
    expect(phases).toEqual(["before:wrapped_tool", "after", "post:wrapped_tool"]);
    expect(textFromMessages(handle.agent.messages)).toContain("wrapped tool completed");
    expect(textFromMessages(handle.agent.messages)).toContain('"source":"post"');
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("persists the final tool result event in Pi JSONL across resume", async () => {
    const harness = await createPiHarness();
    harness.tools.set("persisted_tool", {
      name: "persisted_tool",
      label: "Persisted Tool",
      description: "Verifies durable tool lifecycle events.",
      parameters: Type.Object({ value: Type.String() }),
      execute: async (_toolCallId, params) => ({
        content: [{ type: "text" as const, text: `persisted:${(params as { value: string }).value}` }],
        details: { persisted: true },
      }),
    });
    harness.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("persisted_tool", { value: "yes" })),
      fauxAssistantMessage("durable tool complete"),
    ]);
    const first = await harness.agents.create({ sessionId: "pi-tool-result-persist", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await first.agent.prompt("persist the tool result");
    await first.agent.whenIdle();
    const eventEntries = harness.getEntries("pi-tool-result-persist").filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as { type?: string; customType?: string; data?: { type?: string } };
      return value.type === "custom" && value.customType === "deepseek/agent-event" && value.data?.type === "tool/result";
    });
    expect(eventEntries).toHaveLength(1);
    await first.dispose();

    const resumed = await harness.agents.resume({ resumeSessionId: "pi-tool-result-persist", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    expect(harness.getEntries("pi-tool-result-persist").some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as { type?: string; customType?: string; data?: { type?: string } };
      return value.type === "custom" && value.customType === "deepseek/agent-event" && value.data?.type === "tool/result";
    })).toBe(true);
    await resumed.dispose();
    await harness.loader.dispose();
  });

  it("uses Pi native parallel scheduling for explicitly parallel tools", async () => {
    const harness = await createPiHarness();
    let active = 0;
    let maximumActive = 0;
    let startedCount = 0;
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let allStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => { allStarted = resolve; });
    const makeTool = (name: string): ToolDefinition => ({
      name,
      label: name,
      description: "Parallel scheduling probe.",
      executionMode: "parallel",
      parameters: Type.Object({}),
      execute: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        startedCount += 1;
        if (startedCount === 2) allStarted();
        await released;
        active -= 1;
        return { content: [{ type: "text" as const, text: `${name}:done` }], details: {} };
      },
    });
    harness.tools.set("parallel_a", makeTool("parallel_a"));
    harness.tools.set("parallel_b", makeTool("parallel_b"));
    harness.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("parallel_a", {}), fauxToolCall("parallel_b", {})]),
      fauxAssistantMessage("parallel batch complete"),
    ]);
    const handle = await harness.agents.create({ sessionId: "pi-tool-parallel", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    const prompt = handle.agent.prompt("run parallel tools");
    await Promise.race([bothStarted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("parallel tools did not overlap")), 1000))]);
    expect(maximumActive).toBe(2);
    release();
    await prompt;
    await handle.agent.whenIdle();
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("uses Pi native sequential scheduling for exclusive tools", async () => {
    const harness = await createPiHarness();
    let active = 0;
    let maximumActive = 0;
    let firstStarted!: () => void;
    const firstReady = new Promise<void>((resolve) => { firstStarted = resolve; });
    let secondStarted!: () => void;
    const secondReady = new Promise<void>((resolve) => { secondStarted = resolve; });
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let releaseSecond!: () => void;
    const secondReleased = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let callCount = 0;
    const exclusiveTool: ToolDefinition = {
      name: "exclusive_probe",
      label: "exclusive_probe",
      description: "Sequential scheduling probe.",
      executionMode: "sequential",
      parameters: Type.Object({}),
      execute: async () => {
        callCount += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (callCount === 1) {
          firstStarted();
          await firstReleased;
        } else {
          secondStarted();
          await secondReleased;
        }
        active -= 1;
        return { content: [{ type: "text" as const, text: `exclusive:${callCount}` }], details: {} };
      },
    };
    harness.tools.set("exclusive_probe", exclusiveTool);
    harness.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("exclusive_probe", {}), fauxToolCall("exclusive_probe", {})]),
      fauxAssistantMessage("exclusive batch complete"),
    ]);
    const handle = await harness.agents.create({ sessionId: "pi-tool-exclusive", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    const prompt = handle.agent.prompt("run exclusive tools");
    await firstReady;
    expect(callCount).toBe(1);
    expect(active).toBe(1);
    releaseFirst();
    await Promise.race([secondReady, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("exclusive tool did not advance")), 1000))]);
    expect(callCount).toBe(2);
    expect(maximumActive).toBe(1);
    releaseSecond();
    await prompt;
    await handle.agent.whenIdle();
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("keeps DeepSeek tool execute hooks isolated between agents", async () => {
    const harness = await createPiHarness();
    const seenByAgent = new Map<string, string[]>();
    harness.tools.set("scoped_tool", {
      name: "scoped_tool",
      label: "Scoped Tool",
      description: "Verifies tool hook scope.",
      parameters: Type.Object({ value: Type.String() }),
      execute: async (_toolCallId, params) => {
        harness.toolCalls.push((params as { value: string }).value);
        return { content: [{ type: "text" as const, text: "scoped result" }], details: {} };
      },
    });
    const setup = (agentId: string) => (agentContext: Context) => {
      agentContext.on("tools/execute", async (execution: { agent: { id: string } }, next: () => Promise<unknown>) => {
        const seen = seenByAgent.get(agentId) ?? [];
        seen.push(execution.agent.id);
        seenByAgent.set(agentId, seen);
        return next();
      });
    };
    harness.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("scoped_tool", { value: "one" })),
      fauxAssistantMessage("one done"),
      fauxAssistantMessage(fauxToolCall("scoped_tool", { value: "two" })),
      fauxAssistantMessage("two done"),
    ]);
    const first = await harness.agents.create({ sessionId: "pi-tool-scope-one", setup: setup("pi-tool-scope-one"), agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    const second = await harness.agents.create({ sessionId: "pi-tool-scope-two", setup: setup("pi-tool-scope-two"), agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await first.agent.prompt("run scoped tool one");
    await first.agent.whenIdle();
    await second.agent.prompt("run scoped tool two");
    await second.agent.whenIdle();
    expect(seenByAgent.get("pi-tool-scope-one")).toEqual(["pi-tool-scope-one"]);
    expect(seenByAgent.get("pi-tool-scope-two")).toEqual(["pi-tool-scope-two"]);
    await first.dispose();
    await second.dispose();
    await harness.loader.dispose();
  });

  it("aborts a running Pi tool through the Harness agent handle", async () => {
    const harness = await createPiHarness();
    let started!: () => void;
    const toolStarted = new Promise<void>((resolve) => { started = resolve; });
    let aborted = false;
    let hookAborted = false;
    harness.context.on("tools/execute", async (execution: DeepSeekToolExecution, next: () => Promise<unknown>) => {
      execution.signal?.addEventListener("abort", () => { hookAborted = true; }, { once: true });
      return next();
    });
    harness.tools.set("wait_tool", {
      name: "wait_tool",
      label: "Wait Tool",
      description: "Waits until the agent is aborted.",
      parameters: Type.Object({ value: Type.String() }),
      execute: async (_toolCallId, _params, signal) => {
        started();
        if (!signal) return { content: [{ type: "text", text: "missing signal" }], details: {} };
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
        });
        return { content: [{ type: "text", text: "aborted" }], details: {} };
      },
    });
    harness.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("wait_tool", { value: "wait" })),
      fauxAssistantMessage("the abort test should stop before this response"),
    ]);
    const handle = await harness.agents.create({ sessionId: "pi-abort", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    const prompt = handle.agent.prompt("start waiting").catch(() => undefined);
    await Promise.race([
      toolStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("wait tool did not start")), 1000)),
    ]);
    await handle.agent.abort();
    await prompt;
    await handle.agent.whenIdle();
    expect(aborted).toBe(true);
    expect(hookAborted).toBe(true);
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("resumes the same Pi JSONL session through the Harness facade", async () => {
    const harness = await createPiHarness();
    harness.faux.setResponses([fauxAssistantMessage("first persisted answer")]);
    const first = await harness.agents.create({ sessionId: "pi-resume", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await first.agent.prompt("persist this turn");
    await first.agent.whenIdle();
    const firstFileContent = textFromMessages(first.agent.messages);
    await first.dispose();

    harness.faux.setResponses([fauxAssistantMessage("resumed answer")]);
    const resumed = await harness.agents.resume({ resumeSessionId: "pi-resume", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await resumed.agent.prompt("continue the persisted turn");
    await resumed.agent.whenIdle();
    expect(textFromMessages(resumed.agent.messages)).toContain("first persisted answer");
    expect(textFromMessages(resumed.agent.messages)).toContain("resumed answer");
    expect(textFromMessages(resumed.agent.messages)).not.toBe(firstFileContent);
    await resumed.dispose();
    await harness.loader.dispose();
  });

  it("persists and restores Harness inbox state without a second agent loop", async () => {
    const harness = await createPiHarness();
    harness.faux.setResponses([fauxAssistantMessage("persisted anchor")]);
    const first = await harness.agents.create({ sessionId: "pi-inbox", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await first.agent.prompt("create a persisted anchor");
    await first.agent.whenIdle();
    first.agent.send({ content: "queued for the next turn" }, "next-turn", false);
    expect(first.agent.inbox.nextTurn).toHaveLength(1);
    const queuedId = first.agent.inbox.nextTurn[0]?.id;
    expect(queuedId).toBeTruthy();
    await first.dispose();

    const resumed = await harness.agents.resume({ resumeSessionId: "pi-inbox", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    const resumedCoordinates: string[] = [];
    harness.context.on("turn/start", ({ turn }: { turn: number }) => resumedCoordinates.push(`${turn}`));
    expect(resumed.agent.inbox.nextTurn.map((message) => message.id)).toEqual([queuedId]);
    expect(resumed.agent.inbox.remove(String(queuedId))).toBe(true);
    expect(resumed.agent.inbox.hasPending).toBe(false);
    harness.faux.setResponses([fauxAssistantMessage("post-resume answer")]);
    await resumed.agent.prompt("run after inbox restore");
    await resumed.agent.whenIdle();
    expect(resumedCoordinates[0]).toBe("2");
    await resumed.dispose();
    await harness.loader.dispose();
  });

  it("routes prompt and steer through the durable inbox before Pi execution", async () => {
    const harness = await createPiHarness();
    const claimed: string[] = [];
    const starts: number[] = [];
    harness.context.on("agent/inbox/claimed", ({ message }: { message: { content: Array<{ text: string }> } }) => {
      claimed.push(message.content[0]?.text ?? "");
    });
    harness.context.on("turn/start", ({ turn }: { turn: number }) => starts.push(turn));
    harness.faux.setResponses([fauxAssistantMessage("prompt and steer complete")]);
    const handle = await harness.agents.create({ sessionId: "pi-inbox-prompt-steer", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    const prompt = handle.agent.prompt("durable prompt");
    expect(handle.agent.inbox.nextTurn.map((message) => message.content[0]?.text)).toEqual(["durable prompt"]);
    await prompt;
    await handle.agent.whenIdle();
    expect(claimed).toEqual(["durable prompt"]);
    expect(handle.agent.inbox.hasPending).toBe(false);

    harness.faux.setResponses([fauxAssistantMessage("steer complete")]);
    const steer = handle.agent.steer("durable steer");
    await steer;
    await handle.agent.whenIdle();
    expect(claimed).toEqual(["durable prompt", "durable steer"]);
    expect(starts).toEqual([1, 2]);
    expect(handle.agent.inbox.hasPending).toBe(false);
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("lets DeepSeek plugins reject a pre-step before Pi calls the model", async () => {
    const harness = await createPiHarness();
    let preSteps = 0;
    harness.context.on("agent/pre-step", (_payload: unknown, next: () => Promise<unknown>) => {
      preSteps += 1;
      return Promise.resolve({ kind: "reject" });
    });
    const handle = await harness.agents.create({ sessionId: "pi-pre-step-reject", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await handle.agent.prompt("blocked by plugin");
    await handle.agent.whenIdle();
    expect(preSteps).toBe(1);
    expect(harness.faux.state.callCount).toBe(0);
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("keeps agent-scoped waterfall listeners isolated between Pi agents", async () => {
    const harness = await createPiHarness();
    const seenByAgent = new Map<string, string[]>();
    const setup = (agentId: string) => (agentContext: Context) => {
      const seen = seenByAgent.get(agentId) ?? [];
      seenByAgent.set(agentId, seen);
      agentContext.on("agent/pre-step", (payload: { agent: { id: string } }, next: () => Promise<unknown>) => {
        seen.push(payload.agent.id);
        return next();
      });
    };
    harness.faux.setResponses([
      fauxAssistantMessage("agent one answer"),
      fauxAssistantMessage("agent two answer"),
    ]);
    const first = await harness.agents.create({ sessionId: "pi-scope-one", setup: setup("pi-scope-one"), agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    const second = await harness.agents.create({ sessionId: "pi-scope-two", setup: setup("pi-scope-two"), agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await first.agent.prompt("run agent one");
    await first.agent.whenIdle();
    await second.agent.prompt("run agent two");
    await second.agent.whenIdle();
    expect(seenByAgent.get("pi-scope-one")).toEqual(["pi-scope-one"]);
    expect(seenByAgent.get("pi-scope-two")).toEqual(["pi-scope-two"]);
    await first.dispose();
    await second.dispose();
    await harness.loader.dispose();
  });

  it("sends an agent/pre-step text rewrite to the Pi provider", async () => {
    const harness = await createPiHarness();
    let providerContext = "";
    harness.context.on("agent/pre-step", ({ messages }: { messages: Array<Record<string, unknown>> }, next: () => Promise<unknown>) => ({
      kind: "enter",
      messages: messages.map((message) => ({
        ...message,
        content: [{ type: "text", text: "rewritten by plugin" }],
      })),
    }));
    harness.faux.setResponses([async (context) => {
      providerContext = JSON.stringify(context);
      return fauxAssistantMessage("rewrite answer");
    }]);
    const handle = await harness.agents.create({ sessionId: "pi-pre-step-rewrite", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await handle.agent.prompt("original prompt");
    await handle.agent.whenIdle();
    expect(providerContext).toContain("rewritten by plugin");
    expect(providerContext).not.toContain("original prompt");
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("lets agent/request route the Pi session to another registered model", async () => {
    const harness = await createPiHarness();
    let routed = 0;
    harness.context.on("agent/request", async (_payload: unknown, next: () => Promise<{ provider?: string; model?: string }>) => {
      routed += 1;
      return { ...(await next()), provider: "openbuddy-faux", model: "agentloop-routed" };
    });
    harness.faux.setResponses([fauxAssistantMessage("routed answer")]);
    const handle = await harness.agents.create({ sessionId: "pi-request-route", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await handle.agent.prompt("route this request");
    await handle.agent.whenIdle();
    expect(routed).toBe(1);
    expect(handle.agent.modelId).toBe("openbuddy-faux/agentloop-routed");
    expect(handle.agent.options).toMatchObject({ provider: "openbuddy-faux", model: "agentloop-routed" });
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("persists the latest agent/request model route across Pi session resume", async () => {
    const harness = await createPiHarness();
    harness.context.on("agent/request", async (_payload: unknown, next: () => Promise<{ provider?: string; model?: string }>) => ({
      ...(await next()),
      provider: "openbuddy-faux",
      model: "agentloop-routed",
    }));
    harness.faux.setResponses([fauxAssistantMessage("persisted route answer")]);
    const first = await harness.agents.create({ sessionId: "pi-request-persist", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await first.agent.prompt("persist this route");
    await first.agent.whenIdle();
    expect(first.agent.modelId).toBe("openbuddy-faux/agentloop-routed");
    await first.dispose();

    harness.faux.setResponses([fauxAssistantMessage("resumed route answer")]);
    const resumed = await harness.agents.resume({ resumeSessionId: "pi-request-persist", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    expect(resumed.agent.modelId).toBe("openbuddy-faux/agentloop-routed");
    await resumed.agent.prompt("use the restored route");
    await resumed.agent.whenIdle();
    expect(textFromMessages(resumed.agent.messages)).toContain("resumed route answer");
    await resumed.dispose();
    await harness.loader.dispose();
  });

  it("lets agent/request-error retry a failed Pi request", async () => {
    const harness = await createPiHarness();
    let recoveries = 0;
    harness.context.on("agent/request-error", async () => {
      recoveries += 1;
      return recoveries === 1 ? { kind: "retry" } : undefined;
    });
    harness.faux.setResponses([
      fauxAssistantMessage("first request fails", { stopReason: "error", errorMessage: "transient" }),
      fauxAssistantMessage("recovered answer"),
    ]);
    const handle = await harness.agents.create({ sessionId: "pi-request-retry", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke" } });
    await handle.agent.prompt("retry this request");
    await handle.agent.whenIdle();
    expect(recoveries).toBe(1);
    expect(textFromMessages(handle.agent.messages)).toContain("recovered answer");
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("honors the configured request retry budget", async () => {
    const harness = await createPiHarness();
    let recoveries = 0;
    harness.context.on("agent/request-error", async () => {
      recoveries += 1;
      return { kind: "retry" };
    });
    harness.faux.setResponses([
      fauxAssistantMessage("failure one", { stopReason: "error", errorMessage: "temporary one" }),
      fauxAssistantMessage("failure two", { stopReason: "error", errorMessage: "temporary two" }),
      fauxAssistantMessage("should not be requested"),
    ]);
    const handle = await harness.agents.create({ sessionId: "pi-request-budget", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke", maxRetries: 1 } });
    await handle.agent.prompt("use one retry only");
    await handle.agent.whenIdle();
    expect(recoveries).toBe(2);
    expect(harness.faux.state.callCount).toBe(2);
    await handle.dispose();
    await harness.loader.dispose();
  });

  it("lets cancellation win while request recovery is awaiting", async () => {
    const harness = await createPiHarness();
    let recoveryCalls = 0;
    let recoveryStarted!: () => void;
    const recoveryReady = new Promise<void>((resolve) => { recoveryStarted = resolve; });
    harness.context.on("agent/request-error", async ({ signal }: { signal: AbortSignal }) => {
      recoveryCalls += 1;
      recoveryStarted();
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { kind: "retry" };
    });
    harness.faux.setResponses([fauxAssistantMessage("cancel me", { stopReason: "error", errorMessage: "temporary" }), fauxAssistantMessage("must not retry")]);
    const handle = await harness.agents.create({ sessionId: "pi-request-cancel-recovery", agentOptions: { provider: "openbuddy-faux", model: "agentloop-smoke", maxRetries: 5 } });
    const prompt = handle.agent.prompt("cancel recovery").catch(() => undefined);
    await recoveryReady;
    handle.agent.cancel(new Error("user cancelled"));
    await prompt;
    await handle.agent.whenIdle();
    expect(recoveryCalls).toBe(1);
    expect(harness.faux.state.callCount).toBe(1);
    await handle.dispose();
    await harness.loader.dispose();
  });
});
