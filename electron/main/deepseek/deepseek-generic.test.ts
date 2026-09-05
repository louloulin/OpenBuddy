import { Context } from "@openbuddy/cordis";
import { describe, expect, it, vi } from "vitest";
import { HarnessPluginLoader } from "@openbuddy/plugin-host";
import { resolveDeepSeekGenericModule } from "./deepseek-generic";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-deepseek-generic-test" },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("../casdoor/casdoor-auth", () => ({
  casdoorAuth: { status: () => ({ config: { configured: false }, identity: null, tenantContext: { activeTenantId: undefined } }) },
}));

describe("DeepSeek generic compatibility", () => {
  it("loads the official terminal package graph through HarnessPluginLoader and rolls back safely", async () => {
    const context = new Context();
    const tools = new Map<string, { name?: string; execute?: (...args: unknown[]) => Promise<unknown> }>();
    context.provide("piSession", { sessionId: "loader-terminal-session" });
    context.provide("mcpResources", { getCwd: () => process.cwd() });
    context.provide("toolRegistry", {
      registerTool: (tool: typeof tools extends Map<string, infer Value> ? Value : never) => {
        if (!tool.name) throw new Error("test tool name is required");
        tools.set(tool.name, tool);
        return () => {
          if (tools.get(tool.name!) === tool) tools.delete(tool.name!);
        };
      },
      list: () => [...tools.values()],
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => {
        if (specifier === "@deepseek-ai/dsh-terminal-bash-missing") throw new Error(`test importer cannot resolve ${specifier}`);
        const module = resolveDeepSeekGenericModule(specifier);
        if (!module) throw new Error(`test importer cannot resolve ${specifier}`);
        return module;
      },
      logger: () => undefined,
    });

    try {
      await loader.load([
        { id: "tool-terminal", name: "@deepseek-ai/dsh-tool-terminal" },
        { id: "tool-jobs", name: "@deepseek-ai/dsh-tool-jobs" },
        { id: "jobs", name: "@deepseek-ai/dsh-jobs-local" },
        { id: "terminal-bash", name: "@deepseek-ai/dsh-terminal-bash" },
        { id: "terminal", name: "@deepseek-ai/dsh-terminal" },
      ]);

      expect(loader.list()).toEqual(expect.arrayContaining([
        { id: "tool-terminal", name: "@deepseek-ai/dsh-tool-terminal", state: "loaded" },
        { id: "tool-jobs", name: "@deepseek-ai/dsh-tool-jobs", state: "loaded" },
        { id: "jobs", name: "@deepseek-ai/dsh-jobs-local", state: "loaded" },
        { id: "terminal-bash", name: "@deepseek-ai/dsh-terminal-bash", state: "loaded" },
        { id: "terminal", name: "@deepseek-ai/dsh-terminal", state: "loaded" },
      ]));
      const loadOrder = loader.list().map((entry) => entry.id);
      expect(loadOrder.indexOf("terminal")).toBeLessThan(loadOrder.indexOf("terminal-bash"));
      expect(loadOrder.indexOf("terminal")).toBeLessThan(loadOrder.indexOf("tool-terminal"));
      expect(loadOrder.indexOf("jobs")).toBeLessThan(loadOrder.indexOf("tool-jobs"));
      expect([...tools.keys()]).toEqual(expect.arrayContaining([
        "terminal_open", "terminal_send", "terminal_read", "terminal_signal", "terminal_close", "terminal_list",
        "job_list", "job_output", "job_kill",
      ]));

      const openTool = tools.get("terminal_open");
      const sendTool = tools.get("terminal_send");
      const readTool = tools.get("terminal_read");
      const listTool = tools.get("terminal_list");
      const opened = await openTool?.execute?.("loader-open", { type: "shell", cwd: process.cwd() }, new AbortController().signal);
      const openedDetails = (opened as { details?: { sessionId?: string; type?: string } })?.details;
      expect(openedDetails).toMatchObject({ sessionId: expect.stringMatching(/^pty-/u), type: "shell" });
      const sessionId = openedDetails?.sessionId;
      expect(sessionId).toBeTruthy();

      const sent = await sendTool?.execute?.("loader-send", { sessionId, text: "printf loader-terminal-ok", submit: true }, new AbortController().signal);
      expect(sent).toMatchObject({ details: { viewport: expect.stringContaining("loader-terminal-ok") } });
      const read = await readTool?.execute?.("loader-read", { sessionId }, new AbortController().signal);
      expect(read).toMatchObject({ details: { text: expect.stringContaining("loader-terminal-ok") } });
      expect(await listTool?.execute?.("loader-list", {}, new AbortController().signal)).toMatchObject({
        details: [expect.objectContaining({ sessionId })],
      });

      const background = await sendTool?.execute?.(
        "loader-background",
        { sessionId, text: "printf background-terminal-ok", submit: true, run_in_background: true },
        new AbortController().signal,
      );
      const backgroundJobId = (background as { details?: { jobId?: string } })?.details?.jobId;
      expect(backgroundJobId).toMatch(/^dsh-job-/u);
      const jobId = backgroundJobId as string;
      const jobList = tools.get("job_list");
      const jobOutput = tools.get("job_output");
      await vi.waitFor(async () => {
        const result = await jobOutput?.execute?.("loader-job-output", { job_id: jobId }, new AbortController().signal);
        expect(result).toMatchObject({ content: [{ text: expect.stringContaining("background-terminal-ok") }] });
      }, { timeout: 10_000, interval: 100 });
      expect(await jobList?.execute?.("loader-job-list", {}, new AbortController().signal)).toMatchObject({
        content: [{ text: expect.stringContaining(jobId) }],
      });

      const runtime = context.get("terminals") as {
        list: (owner: object) => unknown[];
      };
      const owner = (await import("./terminal-runtime")).terminalOwner(context);
      expect(runtime.list(owner)).toHaveLength(1);

      await loader.reload("tool-terminal");
      expect([...tools.keys()]).toEqual(expect.arrayContaining([
        "terminal_open", "terminal_send", "terminal_read", "terminal_signal", "terminal_close", "terminal_list",
        "job_list", "job_output", "job_kill",
      ]));
      const sentAfterToolReload = await tools.get("terminal_send")?.execute?.(
        "loader-send-after-tool-reload",
        { sessionId, text: "printf tool-reload-ok", submit: true },
        new AbortController().signal,
      );
      expect(sentAfterToolReload).toMatchObject({ details: { viewport: expect.stringContaining("tool-reload-ok") } });

      await loader.reload("terminal-bash");
      expect((context.get("terminals") as { listBackends: () => string[] }).listBackends()).toEqual(["shell"]);
      const sentAfterBackendReload = await tools.get("terminal_send")?.execute?.(
        "loader-send-after-backend-reload",
        { sessionId, text: "printf backend-reload-ok", submit: true },
        new AbortController().signal,
      );
      expect(sentAfterBackendReload).toMatchObject({ details: { viewport: expect.stringContaining("backend-reload-ok") } });

      await expect(loader.update("terminal-bash", { name: "@deepseek-ai/dsh-terminal-bash-missing" })).rejects.toThrow(/cannot resolve/u);
      expect(loader.list()).toEqual(expect.arrayContaining([
        { id: "terminal-bash", name: "@deepseek-ai/dsh-terminal-bash", state: "loaded" },
      ]));
      expect((context.get("terminals") as { listBackends: () => string[] }).listBackends()).toEqual(["shell"]);
      const sentAfterRollback = await tools.get("terminal_send")?.execute?.(
        "loader-send-after-rollback",
        { sessionId, text: "printf rollback-ok", submit: true },
        new AbortController().signal,
      );
      expect(sentAfterRollback).toMatchObject({ details: { viewport: expect.stringContaining("rollback-ok") } });

      const foreignContext = new Context();
      foreignContext.provide("piSession", { sessionId: "foreign-loader-terminal-session" });
      foreignContext.provide("terminals", context.get("terminals"));
      const foreignTools = new Map<string, { name?: string; execute?: (...args: unknown[]) => Promise<unknown> }>();
      foreignContext.provide("toolRegistry", {
        registerTool: (tool: typeof tools extends Map<string, infer Value> ? Value : never) => {
          if (!tool.name) throw new Error("foreign test tool name is required");
          foreignTools.set(tool.name, tool);
          return () => foreignTools.delete(tool.name!);
        },
      });
      const foreignLoader = new HarnessPluginLoader({
        context: foreignContext,
        importer: async (specifier) => {
          const module = resolveDeepSeekGenericModule(specifier);
          if (!module) throw new Error(`foreign test importer cannot resolve ${specifier}`);
          return module;
        },
        logger: () => undefined,
      });
      await foreignLoader.load([{ id: "foreign-tool-terminal", name: "@deepseek-ai/dsh-tool-terminal" }]);
      await expect(foreignTools.get("terminal_read")?.execute?.(
        "foreign-read",
        { sessionId },
        new AbortController().signal,
      )).rejects.toMatchObject({ code: "FOREIGN_SESSION" });
      await foreignLoader.dispose();
    } finally {
      await loader.dispose();
    }
  }, 45_000);

  it("shares the loader-owned subprocess and sandbox facades across official package entries", async () => {
    const context = new Context();
    context.provide("mcpResources", { getCwd: () => process.cwd() });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => {
        const module = resolveDeepSeekGenericModule(specifier);
        if (!module) throw new Error(`execution importer cannot resolve ${specifier}`);
        return module;
      },
      logger: () => undefined,
    });

    try {
      await loader.load([
        { id: "sandbox", name: "@deepseek-ai/dsh-sandbox-local" },
        { id: "subprocess", name: "@deepseek-ai/dsh-subprocess-local" },
        { id: "sandbox-policy", name: "@deepseek-ai/dsh-sandbox-policy", config: { mode: "workspace-write", workspaceRoot: process.cwd() } },
      ]);
      const subprocess = context.get("subprocess") as {
        resolveExecutable: (command: string) => Promise<string>;
        spawn: (spec: unknown) => { done: Promise<unknown>; collected: { stdout: () => { text: string } } };
      };
      const policy = context.get("sandboxPolicy") as { resolve: (request?: unknown) => { mode: string; workspaceRoot: string } };
      const sandbox = context.get("sandbox") as { confine: (argv: readonly string[], policy?: unknown) => { argv: string[]; enforcement: string } };
      expect(subprocess).toBeDefined();
      expect(sandbox).toBeDefined();
      await expect(subprocess.resolveExecutable("node")).resolves.toMatch(/node/u);
      expect(policy.resolve({ session: { sessionId: "execution-session", cwd: process.cwd() } })).toMatchObject({
        mode: "workspace-write",
      });
      expect(() => sandbox.confine([process.execPath, "-e", "process.stdout.write('sandbox-ok')"])).not.toThrow();

      const handle = subprocess.spawn({
        argv: [process.execPath, "-e", "process.stdout.write('loader-subprocess-ok')"],
        cwd: process.cwd(),
        stdio: { stdin: "ignore", stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
        graceMs: 500,
      });
      await expect(handle.done).resolves.toMatchObject({ exitCode: 0, signal: null });
      expect(handle.collected.stdout().text).toContain("loader-subprocess-ok");

      const subprocessInstance = context.get("subprocess");
      await loader.reload("sandbox-policy");
      expect(context.get("subprocess")).toBe(subprocessInstance);
      expect(context.get("sandboxPolicy")).toBeDefined();
      await loader.dispose();
      expect(context.get("subprocess")).toBeUndefined();
      expect(context.get("sandboxPolicy")).toBeUndefined();
    } finally {
      await loader.dispose();
    }
  });

  it("resolves the jobs service from the top-level Cordis context", async () => {
    const context = new Context();
    const tools: Array<{ name?: string }> = [];
    const jobs = {
      register: vi.fn(() => () => undefined),
      update: vi.fn(),
      list: vi.fn(() => []),
      get: vi.fn(),
    };
    context.provide("jobs", jobs);
    context.provide("toolRegistry", {
      registerTool: (tool: { name?: string }) => {
        tools.push(tool);
        return () => undefined;
      },
      list: () => tools,
    });

    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => {
        const module = resolveDeepSeekGenericModule(specifier);
        if (!module) throw new Error(`test importer cannot resolve ${specifier}`);
        return module;
      },
      logger: () => undefined,
    });

    await loader.load([{ id: "tool-jobs", name: "@deepseek-ai/dsh-tool-jobs", inject: [] }]);

    expect(loader.list()).toEqual([
      expect.objectContaining({ id: "tool-jobs", state: "loaded" }),
    ]);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["job_list", "job_output", "job_kill"]));
    await loader.dispose();
  });

  it("composes the DeepSeek terminal service, backend, and tools as reversible layers", async () => {
    const context = new Context();
    const runtime = (await import("./terminal-runtime")).createTerminalService();
    const tools: Array<{ name?: string; execute?: (...args: unknown[]) => Promise<unknown> }> = [];
    context.provide("terminals", runtime);
    context.provide("piSession", { sessionId: "terminal-test-session" });
    context.provide("toolRegistry", {
      registerTool: (tool: typeof tools[number]) => { tools.push(tool); return () => undefined; },
    });

    const terminal = resolveDeepSeekGenericModule("@deepseek-ai/dsh-terminal");
    const bash = resolveDeepSeekGenericModule("@deepseek-ai/dsh-terminal-bash");
    const tool = resolveDeepSeekGenericModule("@deepseek-ai/dsh-tool-terminal");
    const bashDispose = await (bash?.default as { apply: (ctx: Context, config?: unknown) => Promise<() => void> }).apply(context);
    const toolDispose = await (tool?.default as { apply: (ctx: Context, config?: unknown) => Promise<() => void> }).apply(context);

    expect(terminal?.default).toBeDefined();
    expect(runtime.listBackends()).toEqual(["shell"]);
    expect(tools.map((entry) => entry.name)).toEqual([
      "terminal_open", "terminal_send", "terminal_read", "terminal_signal", "terminal_close", "terminal_list",
    ]);

    const openTool = tools.find((entry) => entry.name === "terminal_open");
    const sendTool = tools.find((entry) => entry.name === "terminal_send");
    const opened = await openTool?.execute?.("open-1", { type: "shell", cwd: process.cwd() }, new AbortController().signal);
    const sessionId = (opened as { details?: { sessionId?: string } })?.details?.sessionId;
    expect(sessionId).toMatch(/^pty-/u);
    const sent = await sendTool?.execute?.("send-1", { sessionId, text: "printf generic-terminal-ok" }, new AbortController().signal);
    expect(sent).toMatchObject({ details: { viewport: expect.stringContaining("generic-terminal-ok") } });

    toolDispose();
    bashDispose();
    await runtime.disposeOwner((await import("./terminal-runtime")).terminalOwner({ get: (key) => key === "piSession" ? { sessionId: "terminal-test-session" } : undefined, root: context.root }));
    expect(runtime.listBackends()).toEqual([]);
    await runtime.dispose();
  });

  it("maps subprocess and sandbox packages to the host execution facades", async () => {
    const context = new Context();
    context.provide("mcpResources", { getCwd: () => "/workspace/project" });
    const subprocessModule = resolveDeepSeekGenericModule("@deepseek-ai/dsh-subprocess-local");
    const sandboxModule = resolveDeepSeekGenericModule("@deepseek-ai/dsh-sandbox-policy");
    const subprocessDispose = await (subprocessModule?.default as { apply: (ctx: Context) => Promise<() => void> }).apply(context);
    const sandboxDispose = await (sandboxModule?.default as { apply: (ctx: Context, config?: unknown) => Promise<() => void> }).apply(context, { mode: "read-only" });
    const subprocess = context.get("subprocess") as { resolveExecutable: (name: string) => Promise<string>; spawn: (spec: unknown) => unknown };
    const policy = context.get("sandboxPolicy") as { resolve: (request?: unknown) => { mode: string; workspaceRoot: string } };
    expect(subprocess.resolveExecutable).toEqual(expect.any(Function));
    expect(subprocess.spawn).toEqual(expect.any(Function));
    await expect(subprocess.resolveExecutable("node")).resolves.toMatch(/node/u);
    expect(policy.resolve({ session: { sessionId: "s-1", cwd: "/workspace/project" } })).toMatchObject({ mode: "read-only", workspaceRoot: "/workspace/project" });
    sandboxDispose();
    subprocessDispose();
  });

  it("provides a real dsh-agent-instructions service backed by Pi workspace resources", async () => {
    const context = new Context();
    context.provide("piResources", {
      getCwd: () => "/workspace/project/src",
    });
    const module = resolveDeepSeekGenericModule("@deepseek-ai/dsh-agent-instructions");
    const plugin = module?.default as { apply: (ctx: Context, config?: unknown) => Promise<() => void> };
    const dispose = await plugin.apply(context, { maxBytes: 4096 });
    const service = context.get("agentInstructions") as { read: (request?: unknown) => Promise<string>; load: (request?: unknown) => Promise<string> };
    expect(service).toMatchObject({ read: expect.any(Function), load: expect.any(Function) });
    await expect(service.read({ cwd: "/tmp/no-openbuddy-instructions", maxBytes: 256 })).resolves.toBe("");
    await expect(service.load({ cwd: "/tmp/no-openbuddy-instructions", maxBytes: 256 })).resolves.toBe("");
    dispose();
  });

  it("provides a real dsh-agent-presets roster service", async () => {
    const context = new Context();
    const presets = [{ id: "standard", trust: "user", path: "/tmp/standard/agent.cordis.yml" }];
    context.provide("piResources", {
      getCwd: () => "/workspace",
      listAgentPresets: async () => presets,
      readAgentPreset: async () => "- name: pi\n",
      readAgentPresetDefaults: async () => ({ default: "standard" }),
      writeAgentPresetDefault: async (id?: string) => id ? { default: id } : {},
    });
    const module = resolveDeepSeekGenericModule("@deepseek-ai/dsh-agent-presets");
    const plugin = module?.default as { apply: (ctx: Context) => Promise<() => void> };
    const dispose = await plugin.apply(context);
    const service = context.get("agentPresets") as { list: () => Promise<unknown[]>; resolve: () => Promise<unknown>; readComposition: (id: string) => Promise<string>; setDefault: (id?: string) => Promise<unknown> };
    await expect(service.list()).resolves.toEqual(presets);
    await expect(service.resolve()).resolves.toEqual(presets[0]);
    await expect(service.readComposition("standard")).resolves.toContain("name: pi");
    await expect(service.setDefault("standard")).resolves.toEqual({ default: "standard" });
    dispose();
  });

  it("routes dsh-tool-ask-user through the canonical Pi UI request path", async () => {
    const context = new Context();
    const tools: Array<{ name?: string; execute?: (...args: unknown[]) => Promise<unknown> }> = [];
    const select = vi.fn(async () => "Use Pi");
    context.provide("piUi", { select });
    context.provide("toolRegistry", { registerTool: (tool: typeof tools[number]) => { tools.push(tool); return () => undefined; } });
    const questionsModule = resolveDeepSeekGenericModule("@deepseek-ai/dsh-user-questions");
    const questionsPlugin = questionsModule?.default as { apply: (ctx: Context) => Promise<() => void> };
    await questionsPlugin.apply(context);
    const askUserModule = resolveDeepSeekGenericModule("@deepseek-ai/dsh-tool-ask-user");
    const askUserPlugin = askUserModule?.default as { apply: (ctx: Context) => Promise<() => void> };
    const dispose = await askUserPlugin.apply(context);
    const tool = tools.find((candidate) => candidate.name === "ask_user_question");
    const result = await tool?.execute?.("ask-1", { questions: [{ id: "choice", question: "Which runtime?", options: [{ label: "Use Pi" }] }] }, new AbortController().signal);
    expect(select).toHaveBeenCalledWith("Which runtime?", ["Use Pi"]);
    expect(result).toMatchObject({ details: { answers: [{ id: "choice", selected: ["Use Pi"] }] } });
    dispose();
  });

  it("does not replace the canonical session-query service", async () => {
    const context = new Context();
    const sessionQuery = { listSessions: async () => [] };
    const tools: unknown[] = [];
    context.provide("sessionQuery", sessionQuery);
    context.provide("toolRegistry", { registerTool: (tool: unknown) => { tools.push(tool); return () => undefined; } });

    const module = resolveDeepSeekGenericModule("@deepseek-ai/dsh-tool-session-query");
    const plugin = module?.default as { apply: (ctx: Context) => Promise<() => void> };
    const dispose = await plugin.apply(context);

    expect(context.get("sessionQuery")).toMatchObject({ listSessions: expect.any(Function) });
    expect(typeof (context.get("sessionQuery") as { listSessions?: unknown }).listSessions).toBe("function");
    expect(tools.length).toBeGreaterThan(0);
    dispose();
  });

  it("projects background subagent jobs through the host registry", async () => {
    const context = new Context();
    const tools: Array<{ name?: string; execute?: (...args: unknown[]) => Promise<unknown> }> = [];
    let release!: (value: unknown) => void;
    const output = new Promise((resolve) => { release = resolve; });
    const registry = new Map<string, { id: string; status: string; controller?: AbortController; output?: string; error?: string; sessionId?: string }>();
    const register = vi.fn((job: { id: string; status: string; controller?: AbortController; sessionId?: string }) => {
      const dispose = () => undefined;
      registry.set(job.id, { ...job });
      registered.push({ ...job });
      return dispose;
    });
    const update = vi.fn((id: string, patch: { status?: string; output?: string; error?: string }) => {
      updates.push({ id, ...patch });
      const current = registry.get(id);
      if (current) Object.assign(current, patch);
    });
    const registered: Array<{ id: string; status: string }> = [];
    const updates: Array<{ id: string; status?: string }> = [];
    context.provide("pi", { getSession: () => ({ sessionId: "parent-1" }) });
    context.provide("agentHost", {
      jobs: {
        register,
        update,
        list: (sessionId?: string) => [...registry.values()].filter((job) => sessionId === undefined || job.sessionId === sessionId),
        get: (id: string) => registry.get(id),
      },
    });
    context.provide("teamRunner", { runMember: () => output });
    context.provide("toolRegistry", { registerTool: (tool: typeof tools[number]) => { tools.push(tool); return () => undefined; } });

    const module = resolveDeepSeekGenericModule("@deepseek-ai/dsh-tool-subagent");
    const plugin = module?.default as { apply: (ctx: Context) => Promise<() => void> };
    const dispose = await plugin.apply(context);
    const jobsModule = resolveDeepSeekGenericModule("@deepseek-ai/dsh-tool-jobs");
    const jobsPlugin = jobsModule?.default as { apply: (ctx: Context) => Promise<() => void> };
    await jobsPlugin.apply(context);
    const tool = tools.find((candidate) => candidate.name === "subagent");
    expect(tool?.execute).toBeTypeOf("function");
    const started = await tool?.execute?.("call-1", { description: "Research", prompt: "find it", run_in_background: true }, new AbortController().signal);
    expect(started).toMatchObject({ details: { kind: "background" } });
    expect(registered).toEqual([expect.objectContaining({ status: "running" })]);
    release("done");
    await vi.waitFor(() => expect(updates).toEqual([expect.objectContaining({ status: "completed" })]));
    const jobList = tools.find((candidate) => candidate.name === "job_list");
    const jobOutput = tools.find((candidate) => candidate.name === "job_output");
    const listedResult = await jobList?.execute?.("list", {}) as { content?: Array<{ text?: string }> } | undefined;
    const outputResult = await jobOutput?.execute?.("output", { job_id: registered[0]?.id }) as { content?: Array<{ text?: string }> } | undefined;
    expect(listedResult?.content?.[0]?.text).toContain("completed");
    expect(outputResult?.content?.[0]?.text).toBe("done");
    dispose();
  });
});
