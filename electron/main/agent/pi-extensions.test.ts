import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { applyPiExtensionOverrides, builtinPiExtensionIds, describeCompatibilityAdapterCommands, describeCompatibilityAdapterCommandsMarkdown, mergePiExtensionStatuses, piExtensionsResolvedPayload, resolvePiExtensions } from "./pi-extensions";

describe("OpenBuddy Pi extension resolution", () => {
  it("publishes an empty resolved projection so removed extensions disappear from clients", () => {
    expect(piExtensionsResolvedPayload({ factories: [], paths: [], resolved: [] })).toEqual({
      builtins: [],
      paths: [],
      availableBuiltins: builtinPiExtensionIds(),
      commands: [],
    });
  });

  function extensionHarness(id: string, config?: unknown) {
    const emit = vi.fn();
    const handlers = new Map<string, (payload: unknown, context: unknown) => unknown>();
    const result = resolvePiExtensions([{ id, config }], {
      profileDir: "/tmp/profile",
      resolveSource: () => "/tmp/profile/node_modules/unused/index.js",
      emit,
    });
    const api = {
      on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => {
        handlers.set(event, handler);
      },
    };
    result.factories[0]?.factory(api as never);
    return { emit, handlers };
  }

  it("resolves built-ins and profile-local extension sources", () => {
    const emit = vi.fn();
    const result = resolvePiExtensions([
      { id: "openbuddy-pi-observability", config: { toolEvents: false } },
      { id: "external-extension", source: "external-extension" },
    ], {
      profileDir: "/tmp/profile",
      resolveSource: (source) => `/tmp/profile/node_modules/${source}/index.js`,
      emit,
    });
    expect(result.factories.map((entry) => entry.name)).toEqual(["openbuddy-pi-observability"]);
    expect(result.paths).toEqual(["/tmp/profile/node_modules/external-extension/index.js"]);
    expect(result.resolved).toEqual([
      { id: "openbuddy-pi-observability", source: "<inline:openbuddy-pi-observability>", builtIn: true },
      { id: "external-extension", source: "/tmp/profile/node_modules/external-extension/index.js", builtIn: false },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("adapts goal, plan, task, session, and fs pi backends to canonical OpenBuddy services", async () => {
    const emit = vi.fn();
    const services: Record<string, unknown> = {
      team: { list: async () => [{ id: "team-1" }] },
      plan: { list: async () => [{ sessionId: "s1", enabled: true }] },
      task: {
        list: async () => [{ id: "t-1", content: "stub", status: "pending" }],
        add: async () => ({ id: "t-2", content: "new", status: "pending" }),
        update: async () => ({ id: "t-1", status: "completed" }),
        remove: async () => undefined,
        clear: async () => undefined,
      },
      sessions: {
        list: async () => [{ sessionId: "s-1" }],
        listWorkspaces: async () => [{ cwd: "/tmp", sessionCount: 1 }],
        setPinned: async () => undefined,
        setArchived: async () => undefined,
      },
      fsLocal: {
        stat: async () => ({ exists: true, kind: "file" }),
        listDir: async () => [{ name: "stub.txt" }],
        readTextFile: async () => "stub content",
        openPath: async () => undefined,
        reveal: async () => undefined,
        makeDirectory: async () => "/tmp/new",
      },
    };
    const result = resolvePiExtensions(
      [
        { id: "pi-goal" },
        { id: "@narumitw/pi-plan-mode" },
        { id: "pi-todo" },
        { id: "@narumitw/pi-todo" },
        { id: "pi-session" },
        { id: "pi-history" },
        { id: "pi-fs" },
        { id: "pi-filesystem" },
      ],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("third-party module must not resolve"); },
        emit,
        resolveService: (key) => services[key],
      },
    );

    expect(result.paths).toEqual([]);
    expect(result.resolved).toEqual([
      expect.objectContaining({ id: "pi-goal", mode: "adapter", adapter: "openbuddy-team" }),
      expect.objectContaining({ id: "@narumitw/pi-plan-mode", mode: "adapter", adapter: "pi-plan-mode" }),
      expect.objectContaining({ id: "pi-todo", mode: "adapter", adapter: "openbuddy-task", commands: ["tasks", "todo"] }),
      expect.objectContaining({ id: "@narumitw/pi-todo", mode: "adapter", adapter: "openbuddy-task", commands: ["tasks", "todo"] }),
      expect.objectContaining({ id: "pi-session", mode: "adapter", adapter: "openbuddy-session", commands: ["sessions", "history"] }),
      expect.objectContaining({ id: "pi-history", mode: "adapter", adapter: "openbuddy-session", commands: ["sessions", "history"] }),
      expect.objectContaining({ id: "pi-fs", mode: "adapter", adapter: "openbuddy-fs-local", commands: ["fs", "files"] }),
      expect.objectContaining({ id: "pi-filesystem", mode: "adapter", adapter: "openbuddy-fs-local", commands: ["fs", "files"] }),
    ]);

    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const notify = vi.fn();
    const api = {
      on: vi.fn(),
      registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
        commands.set(name, options);
      },
    };
    result.factories.forEach((entry) => entry.factory(api as never));
    expect(emit.mock.calls.map(([type, payload]) => [type, (payload as { owner: string }).owner])).toEqual([
      ["pi/extension-adapted", "openbuddy-team"],
      ["pi/extension-adapted", "pi-plan-mode"],
      ["pi/extension-adapted", "openbuddy-task"],
      ["pi/extension-adapted", "openbuddy-task"],
      ["pi/extension-adapted", "openbuddy-session"],
      ["pi/extension-adapted", "openbuddy-session"],
      ["pi/extension-adapted", "openbuddy-fs-local"],
      ["pi/extension-adapted", "openbuddy-fs-local"],
    ]);

    const ctx = { cwd: "/tmp/workspace", sessionManager: { getSessionId: () => "s-1" }, ui: { notify } };

    await commands.get("goal")!.handler("list", ctx);
    // Stage G-1d: goal now goes through invokeGoalCommand (real path)
    // which returns "1 active team(s)." instead of describe-only text.
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("1 active team");

    await commands.get("plan")!.handler("status", ctx);
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("1 plan");

    await commands.get("tasks")!.handler("add ship it", ctx);
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("Task added: t-2");
    await commands.get("tasks")!.handler("done t-1", ctx);
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("Task completed: t-1");
    await commands.get("sessions")!.handler("pin s-1", ctx);
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("Session pinned: s-1");
    await commands.get("fs")!.handler("read README.md", ctx);
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("stub content");
  });

  it("populates the commands field for every adapter-projected entry", () => {
    const result = resolvePiExtensions(
      [
        { id: "pi-mcp-adapter" },
        { id: "pi-web-access" },
        { id: "pi-permission-system" },
        { id: "pi-goal" },
        { id: "@narumitw/pi-plan-mode" },
      ],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("unused"); },
        emit: () => undefined,
      },
    );

    expect(result.resolved).toEqual([
      expect.objectContaining({ id: "pi-mcp-adapter", mode: "adapter", commands: ["mcp", "pi-mcp", "mcp-auth"] }),
      expect.objectContaining({ id: "pi-permission-system", mode: "adapter", commands: ["permission-system"] }),
      expect.objectContaining({ id: "pi-goal", mode: "adapter", commands: ["goal"] }),
      expect.objectContaining({ id: "@narumitw/pi-plan-mode", mode: "adapter", commands: ["plan"] }),
    ]);
  });

  it("adapts duplicate MCP, web, and permission backends to canonical OpenBuddy services", () => {
    const emit = vi.fn();
    const result = resolvePiExtensions([
      { id: "pi-mcp-adapter", source: "pi-mcp-adapter" },
      { id: "pi-web-access", source: "@diegopetrucci/pi-web-access" },
      { id: "pi-permission-system", source: "pi-permission-system" },
    ], { profileDir: "/tmp/profile", resolveSource: () => { throw new Error("duplicate backend must not resolve"); }, emit });

    expect(result.paths).toEqual([]);
    expect(result.resolved).toEqual([
      expect.objectContaining({ id: "pi-mcp-adapter", mode: "adapter", adapter: "openbuddy-mcp-client" }),
      expect.objectContaining({ id: "pi-permission-system", mode: "adapter", adapter: "openbuddy-authorization" }),
    ]);
    result.factories.forEach((entry) => entry.factory({} as never));
    expect(emit.mock.calls.map(([type, payload]) => [type, (payload as { owner: string }).owner])).toEqual([
      ["pi/extension-adapted", "openbuddy-mcp-client"],
      ["pi/extension-adapted", "openbuddy-authorization"],
    ]);
    expect(emit.mock.calls.map(([type, payload]) => [type, (payload as { commands: readonly string[] }).commands]))
      .toEqual([
        ["pi/extension-adapted", ["mcp", "pi-mcp", "mcp-auth"]],
        ["pi/extension-adapted", ["permission-system"]],
      ]);
  });

  it("registers adapter-projected slash commands that delegate to OpenBuddy canonical services", async () => {
    const emit = vi.fn();
    const services: Record<string, unknown> = {
      "openbuddy-mcp-client": {
        list: async () => ({ servers: [{ name: "filesystem", status: "ready", toolCount: 2 }] }),
        authorize: async () => ({ status: "authenticated" }),
      },
      "openbuddy-authorization": {
        readMode: async () => "default",
        readRules: async () => [{ tool: "bash", action: "allow" }],
      },
    };
    const result = resolvePiExtensions(
      [
        { id: "pi-mcp-adapter" },
        { id: "pi-permission-system" },
      ],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("adapter must not resolve a third-party module"); },
        emit,
        resolveService: (owner) => services[owner],
      },
    );

    const commands = new Map<string, { description?: string; argumentHint?: string; handler: (args: string, ctx: unknown) => Promise<void> }>();
    const notify = vi.fn();
    const api = {
      on: vi.fn(),
      registerCommand: (name: string, options: { description?: string; argumentHint?: string; handler: (args: string, ctx: unknown) => Promise<void> }) => {
        commands.set(name, options);
      },
    };
    result.factories.forEach((entry) => entry.factory(api as never));

    expect([...commands.keys()].sort()).toEqual(["mcp", "mcp-auth", "permission-system", "pi-mcp"]);
    const ctx = { ui: { notify } };

    await commands.get("mcp")!.handler("", ctx);
    // Stage G-1d: mcp now goes through invokeMcpCommand (real path)
    // which returns the summariseMcpSnapshot output directly.
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("MCP servers");
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("filesystem=ready(2 tools)");

    await commands.get("mcp-auth")!.handler("filesystem", ctx);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("filesystem"), "info");

    await commands.get("permission-system")!.handler("status", ctx);
    // Stage G-1d: permission-system now goes through invokePermissionSystemCommand (real path)
    // which returns the mode/rules summary directly.
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("mode=default");
    expect(notify.mock.calls.at(-1)?.[0] as string).toContain("rules=1");

    // Service resolver returns undefined: adapter falls back to a friendly notification.
    const fallbackServices: Record<string, unknown> = {};
    const resultWithoutService = resolvePiExtensions([{ id: "pi-mcp-adapter" }], {
      profileDir: "/tmp/profile",
      resolveSource: () => { throw new Error("unused"); },
      emit: () => undefined,
      resolveService: (owner) => fallbackServices[owner],
    });
    const fallbackCommands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    resultWithoutService.factories.forEach((entry) =>
      entry.factory({ on: vi.fn(), registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => fallbackCommands.set(name, options) } as never),
    );
    const fallbackNotify = vi.fn();
    await fallbackCommands.get("mcp")!.handler("", { ui: { notify: fallbackNotify } });
    expect(fallbackNotify).toHaveBeenCalledWith(expect.stringContaining("MCP status unavailable"), "info");
  });

  it("renders a markdown section for active adapter-projected commands and skips empty inputs", () => {
    const empty = describeCompatibilityAdapterCommandsMarkdown([]);
    expect(empty).toBe("");

    const mcpOnly = describeCompatibilityAdapterCommandsMarkdown(["pi-mcp-adapter"]);
    expect(mcpOnly).toContain("## Pi 扩展兼容投影");
    expect(mcpOnly).toContain("`/mcp`");
    expect(mcpOnly).toContain("`/pi-mcp`");
    expect(mcpOnly).toContain("`/mcp-auth`");
    expect(mcpOnly).toContain("openbuddy-mcp-client");
    expect(mcpOnly).toContain("serviceKey: `mcpClient`");
    // Other families should not appear when only MCP is active.
    expect(mcpOnly).not.toContain("`/permission-system`");
    expect(mcpOnly).not.toContain("`/subagent`");
    // The MCP adapter is now opt-in passthrough, so the markdown should
    // flag the capability as releasable to the native Pi package.
    expect(mcpOnly).toContain("passthrough 可放行");

    const all = describeCompatibilityAdapterCommandsMarkdown([
      "pi-mcp-adapter",
      "pi-permission-system",
      "pi-goal",
      "@narumitw/pi-plan-mode",
    ]);
    expect(all).toContain("`/mcp`");
    expect(all).toContain("`/permission-system`");
    expect(all).toContain("`/goal`");
    expect(all).toContain("`/plan`");
  });

  it("releases high-traffic Pi packages when the spec opts in via passthrough", () => {
    const emit = vi.fn();
    const result = resolvePiExtensions(
      [
        { id: "pi-mcp-adapter" },
        { id: "pi-web-access", source: "pi-web-access", passthrough: true },
        { id: "pi-subagents", source: "pi-subagents", passthrough: true },
        { id: "pi-todo", source: "@juicesharp/rpiv-todo", passthrough: true },
        { id: "pi-permission-system" },
      ],
      {
        profileDir: "/tmp/profile",
        resolveSource: (source) => `/tmp/profile/node_modules/${source}/index.js`,
        emit,
      },
    );

    // pi-web-access / pi-subagents / pi-todo should NOT take the adapter
    // path; they fall through to Pi's native loader. The other two
    // (mcp-adapter without passthrough, permission-system) still resolve
    // through the OpenBuddy adapter.
    expect(result.resolved.find((entry) => entry.id === "pi-mcp-adapter")).toEqual(
      expect.objectContaining({ id: "pi-mcp-adapter", mode: "adapter" }),
    );
    expect(result.resolved.find((entry) => entry.id === "pi-permission-system")).toEqual(
      expect.objectContaining({ id: "pi-permission-system", mode: "adapter" }),
    );
    expect(result.resolved.find((entry) => entry.id === "pi-web-access")?.mode ?? "native").toBe("native");
    expect(result.resolved.find((entry) => entry.id === "pi-subagents")?.mode ?? "native").toBe("native");
    expect(result.resolved.find((entry) => entry.id === "pi-todo")?.mode ?? "native").toBe("native");
    // Native loader path resolution must have been called for the passthrough packages.
    expect(result.paths.some((entry) => entry.includes("pi-web-access"))).toBe(true);
    expect(result.paths.some((entry) => entry.includes("pi-subagents"))).toBe(true);
    expect(result.paths.some((entry) => entry.includes("@juicesharp/rpiv-todo"))).toBe(true);
  });

  it("auto-passthroughs when the pi package is detected as installed", async () => {
    vi.resetModules();
    vi.doMock("./pi-package-installed", () => ({
      isPiPackageInstalled: () => true,
      probePiPackage: () => ({ installed: true, version: "9.9.9" }),
    }));
    const { resolvePiExtensions: resolvePiExtensionsAuto } = await import("./pi-extensions");
    const emit = vi.fn();
    const result = resolvePiExtensionsAuto(
      [{ id: "pi-subagents", source: "pi-subagents" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: (source) => `/tmp/profile/node_modules/${source}/index.js`,
        emit,
      },
    );
    expect(result.resolved[0]).toEqual(expect.objectContaining({ id: "pi-subagents" }));
    expect(result.resolved[0]).not.toEqual(expect.objectContaining({ mode: "adapter" }));
    expect(result.paths.some((p) => p.includes("pi-subagents"))).toBe(true);
    vi.doUnmock("./pi-package-installed");
    vi.resetModules();
  });

  it("Stage D F1+F4: explicit passthrough opt-in records source='opted-in'", async () => {
    vi.resetModules();
    const pluginHost = await import("@openbuddy/plugin-host");
    pluginHost.clearPassthroughRegistry();

    const { resolvePiExtensions: resolvePiExtensionsAuto } = await import("./pi-extensions");
    const api = {
      on: vi.fn(),
      registerCommand: vi.fn(),
    };
    const result = resolvePiExtensionsAuto(
      [{ id: "pi-plan-mode", passthrough: true } as never],
      {
        profileDir: "/tmp/profile",
        resolveSource: (source) => source,
        emit: () => undefined,
      },
    );
    for (const factory of result.factories) factory.factory(api as never);

    expect(api.registerCommand).not.toHaveBeenCalled();
    expect(pluginHost.isPassthroughed("plan")).toBe(true);
    expect(pluginHost.getPassthroughInfo("plan")?.source).toBe("opted-in");
    pluginHost.clearPassthroughRegistry();
    vi.resetModules();
  });

  it("propagates the passthrough override through applyPiExtensionOverrides", () => {
    const result = applyPiExtensionOverrides(
      [{ id: "pi-web-access" }],
      { "pi-web-access": { passthrough: true, config: { provider: "duckduckgo" } } },
    );
    expect(result[0]).toEqual({ id: "pi-web-access", passthrough: true, config: { provider: "duckduckgo" } });
  });

  it("exposes a static inventory of every adapter-projected slash command", () => {
    const names = describeCompatibilityAdapterCommands().map((command) => command.name);
    const sortedNames = [...names].sort();
    // Stage G-1c: openbuddy-automation removed; automation is owned by pi-background-tasks +
    // pi-goal (passthrough). "automation" and "workflow" (also removed earlier) are no
    // longer adapter-projected. The expected list is shrunk to the 11 live commands.
    expect(sortedNames).toEqual([
      "files",
      "fs",
      "goal",
      "history",
      "mcp",
      "mcp-auth",
      "permission-system",
      "pi-mcp",
      "plan",
      "sessions",
      "tasks",
      "todo",
    ]);
  });

  it("keeps a profile-installed duplicate backend out of Pi's module graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-adapter-profile-"));
    const packageRoot = join(root, "node_modules", "pi-mcp-adapter");
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(packageRoot, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "pi-mcp-adapter", version: "2.30.0" }));
    await writeFile(join(packageRoot, "index.js"), "throw new Error('duplicate MCP backend must not execute');\n");
    try {
      const resolved = resolvePiExtensions([{ id: "pi-mcp-adapter", source: join(packageRoot, "index.js") }], {
        profileDir: root,
        resolveSource: () => join(packageRoot, "index.js"),
        emit: () => undefined,
      });
      expect(resolved.paths).toEqual([]);
      const loader = new DefaultResourceLoader({ cwd, agentDir, extensionFactories: resolved.factories });
      await loader.reload();
      const created = await createAgentSession({ cwd, agentDir, noTools: "builtin", resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) });
      try {
        await created.session.bindExtensions({ mode: "rpc" });
        expect(loader.getExtensions().errors).toEqual([]);
      } finally {
        created.session.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("registers every adapter-projected slash command in a real Pi resource loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-adapter-resource-loader-"));
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    try {
      const emit = vi.fn();
      const resolved = resolvePiExtensions(
        [
          { id: "pi-mcp-adapter" },
          { id: "pi-web-access" },
          { id: "pi-permission-system" },
          { id: "pi-goal" },
          { id: "@narumitw/pi-plan-mode" },
        ],
        {
          profileDir: root,
          resolveSource: () => { throw new Error("adapter must not resolve a third-party module"); },
          emit,
        },
      );
      expect(resolved.paths).toEqual([]);
      expect(resolved.resolved.every((entry) => entry.mode === "adapter")).toBe(true);
      const loader = new DefaultResourceLoader({ cwd, agentDir, extensionFactories: resolved.factories });
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      const created = await createAgentSession({ cwd, agentDir, noTools: "builtin", resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) });
      try {
        await created.session.bindExtensions({ mode: "rpc" });
        const registered = created.session.extensionRunner.getRegisteredCommands().map((command) => command.invocationName || command.name).sort();
        expect(registered).toEqual([
          "goal",
          "mcp",
          "mcp-auth",
          "permission-system",
          "pi-mcp",
          "plan",
        ]);
        expect(emit.mock.calls.map(([type, payload]) => [type, (payload as { owner: string }).owner])).toEqual([
          ["pi/extension-adapted", "openbuddy-mcp-client"],
          ["pi/extension-adapted", "openbuddy-authorization"],
          ["pi/extension-adapted", "openbuddy-team"],
          ["pi/extension-adapted", "pi-plan-mode"],
        ]);
      } finally {
        created.session.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports disabled and unknown extensions without aborting startup", () => {
    const result = resolvePiExtensions([
      { id: "disabled", enabled: false },
      { id: "unknown" },
    ], {
      profileDir: "/tmp/profile",
      resolveSource: () => "/tmp/unused.js",
      emit: () => undefined,
    });
    expect(result.diagnostics).toEqual([
      { id: "disabled", state: "disabled" },
      { id: "unknown", state: "failed", error: "Unknown Pi extension unknown; source is required" },
    ]);
  });

  it("exposes the supported built-in extension inventory", () => {
    expect(builtinPiExtensionIds()).toEqual([
      "openbuddy-apply-patch",
      "openbuddy-pi-observability",
      "openbuddy-pi-context-status",
      "openbuddy-pi-context-guard",
      "openbuddy-pi-telemetry-bridge",
    ]);
  });

  it("applies persisted profile overrides without mutating the source manifest", () => {
    const specs = [{ id: "pi-context-prune", enabled: true, config: { maxTokens: 5000 } }];
    const next = applyPiExtensionOverrides(specs, { "pi-context-prune": { enabled: false, config: { maxTokens: 1000 } } });
    expect(next).toEqual([{ id: "pi-context-prune", enabled: false, config: { maxTokens: 1000 } }]);
    expect(specs).toEqual([{ id: "pi-context-prune", enabled: true, config: { maxTokens: 5000 } }]);
  });

  it("keeps external extension resolution anchored to the profile dependency graph", () => {
    const result = resolvePiExtensions([
      { id: "absolute-extension", source: "/tmp/extensions/absolute.ts" },
    ], {
      profileDir: "/tmp/profile",
      resolveSource: () => { throw new Error("host resolution must not be used"); },
      emit: () => undefined,
    });
    expect(result.paths).toEqual(["/tmp/extensions/absolute.ts"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("forwards lifecycle summaries without retaining message or content bodies", () => {
    const { emit, handlers } = extensionHarness("openbuddy-pi-observability", { toolEvents: true });
    handlers.get("agent_end")?.({
      sessionId: "session-1",
      messages: [{ role: "user", content: "secret prompt" }],
      content: [{ type: "text", text: "secret response" }],
      reason: "completed",
    }, {});
    expect(emit).toHaveBeenCalledWith("pi/agent-end", {
      sessionId: "session-1",
      reason: "completed",
      messageCount: 1,
      contentCount: 1,
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain("secret prompt");
    expect(JSON.stringify(emit.mock.calls)).not.toContain("secret response");
  });

  it("requests native compaction only when usage crosses the configured threshold", () => {
    const { emit, handlers } = extensionHarness("openbuddy-pi-context-guard", { thresholdTokens: 1000 });
    const compact = vi.fn();
    const usage = vi.fn()
      .mockReturnValueOnce({ tokens: 800 })
      .mockReturnValueOnce({ tokens: 1000 })
      .mockReturnValueOnce({ tokens: 1200 })
      .mockReturnValueOnce({ tokens: 1400 });
    const invoke = () => handlers.get("turn_end")?.({}, { getContextUsage: usage, compact });
    invoke();
    invoke();
    invoke();
    invoke();
    expect(compact).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("pi/context-compaction-requested", { thresholdTokens: 1000, tokens: 1200 });
  });

  it("projects Pi auto-discovered extensions without making them profile-managed", () => {
    const statuses = mergePiExtensionStatuses(
      [{ id: "declared", name: "declared", kind: "pi", state: "pending", source: "/profile/declared.ts", managed: true }],
      [{ path: "/home/.pi/agent/extensions/global.ts", resolvedPath: "/home/.pi/agent/extensions/global.ts" }],
      [{ path: "/home/.pi/agent/extensions/broken.ts", error: "syntax error" }],
    );
    expect(statuses).toEqual([
      expect.objectContaining({ id: "declared", state: "pending", managed: true }),
      expect.objectContaining({ id: "/home/.pi/agent/extensions/global.ts", state: "loaded", managed: false }),
      expect.objectContaining({ id: "/home/.pi/agent/extensions/broken.ts", state: "failed", managed: false, disabledReason: "load-failed", diagnostics: ["syntax error"], error: "syntax error" }),
    ]);
  });

  it("retains package version and user-disabled diagnostics", () => {
    const statuses = mergePiExtensionStatuses(
      [{ id: "pi-demo", name: "pi-demo", kind: "pi", state: "disabled", managed: true, source: "/profile/pi-demo/index.js", packageName: "pi-demo", version: "1.2.3", disabledReason: "user" }],
      [],
      [],
    );
    expect(statuses[0]).toMatchObject({ packageName: "pi-demo", version: "1.2.3", disabledReason: "user" });
  });

  it("preserves Pi discovery scope and package origin for auto-discovered extensions", () => {
    const statuses = mergePiExtensionStatuses([], [
      {
        path: "/profile/node_modules/pi-fixture/extensions/index.ts",
        resolvedPath: "/profile/node_modules/pi-fixture/extensions/index.ts",
        sourceInfo: { scope: "project", origin: "package", baseDir: "/profile/node_modules/pi-fixture" },
      },
    ], []);

    expect(statuses).toEqual([
      expect.objectContaining({
        id: "/profile/node_modules/pi-fixture/extensions/index.ts",
        managed: false,
        sourceScope: "project",
        sourceOrigin: "package",
        sourceBaseDir: "/profile/node_modules/pi-fixture",
      }),
    ]);
  });

  it("removes stale auto-discovered rows on the next ResourceLoader snapshot", () => {
    const statuses = mergePiExtensionStatuses(
      [{ id: "/old.ts", name: "/old.ts", kind: "pi", state: "loaded", source: "/old.ts", managed: false }],
      [],
      [],
    );
    expect(statuses).toEqual([]);
  });

  it("reuses a disabled package placeholder when its extensions load again", () => {
    const packageRoot = "/profile/node_modules/pi-fixture";
    const statuses = mergePiExtensionStatuses(
      [{
        id: "pi-fixture",
        name: "pi-fixture",
        kind: "pi",
        state: "disabled",
        source: packageRoot,
        sourceBaseDir: packageRoot,
        managed: true,
        builtIn: false,
      }],
      [
        {
          path: `${packageRoot}/extensions/first.ts`,
          resolvedPath: `${packageRoot}/extensions/first.ts`,
          sourceInfo: { scope: "user", origin: "package", baseDir: packageRoot },
        },
        {
          path: `${packageRoot}/extensions/second.ts`,
          resolvedPath: `${packageRoot}/extensions/second.ts`,
          sourceInfo: { scope: "user", origin: "package", baseDir: packageRoot },
        },
      ],
      [],
    );
    expect(statuses).toHaveLength(2);
    expect(statuses.map((status) => status.source)).toEqual([
      `${packageRoot}/extensions/first.ts`,
      `${packageRoot}/extensions/second.ts`,
    ]);
  });

  // Stage G-1d: verify the session compatibility adapter registers a real
  // pi.registerTool call alongside its slash command, so the LLM can drive
  // the canonical openbuddy-session service from inside the agent loop
  // (not just via /sessions or /history).
  it("registers a real pi tool for the session adapter (Stage G-1d)", async () => {
    const services: Record<string, unknown> = {
      "openbuddy-session": {
        list: async (cwd: string) => [{ id: "s-1", cwd }],
        listWorkspaces: async () => ["ws-a", "ws-b"],
        setPinned: async (id: string, pinned: boolean) => ({ id, pinned }),
      },
    };
    const result = resolvePiExtensions(
      [{ id: "pi-session" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("adapter must not resolve a third-party module"); },
        emit: () => undefined,
        resolveService: (owner) => services[owner],
      },
    );

    const tools = new Map<string, {
      name: string;
      description: string;
      parameters: unknown;
      execute: (...callArgs: unknown[]) => Promise<{ content: Array<{ type: string; text: string }>; details: { ok: boolean; summary?: string } }>;
    }>();
    const api = {
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerTool: (tool: { name: string; description: string; parameters: unknown; execute: (...callArgs: unknown[]) => Promise<{ content: Array<{ type: string; text: string }>; details: { ok: boolean; summary?: string } }> }) => {
        tools.set(tool.name, tool);
      },
    };
    result.factories.forEach((entry) => entry.factory(api as never));

    expect(tools.has("openbuddy_sessions")).toBe(true);
    const tool = tools.get("openbuddy_sessions")!;
    expect(tool.description).toContain("session ledger");

    // verb=list with no target → execute invokes invokeSessionCommand("list", …)
    // ctx.cwd is the workspace root the tool's ExtensionContext provides.
    const listResult = await tool.execute("tc-1", { verb: "list" }, undefined, undefined, { cwd: "/tmp/workspace" } as never);
    expect(listResult.details.ok).toBe(true);
    expect(listResult.content[0]?.text).toContain("s-1");
    expect(listResult.content[0]?.text).toContain("/tmp/workspace");

    // verb=pin with target → execute serializes to "pin s-1"
    const pinResult = await tool.execute("tc-2", { verb: "pin", target: "s-1" }, undefined, undefined, { cwd: "/tmp/workspace" } as never);
    expect(pinResult.details.ok).toBe(true);
    expect(pinResult.content[0]?.text).toContain("Session pinned: s-1");
  });

  // Stage G-1d: when pi.registerTool is missing from the runtime (older
  // builds, RPC stubs), the adapter must silently skip tool registration
  // rather than throw.
  it("skips tool registration when pi.registerTool is unavailable", () => {
    const result = resolvePiExtensions(
      [{ id: "pi-session" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("unused"); },
        emit: () => undefined,
        resolveService: () => undefined,
      },
    );
    const api = {
      on: vi.fn(),
      registerCommand: vi.fn(),
      // intentionally no registerTool
    };
    expect(() => result.factories.forEach((entry) => entry.factory(api as never))).not.toThrow();
  });

  // Stage G-1d: MCP adapter registers a real pi tool backed by invokeMcpCommand.
  it("registers a real pi tool for the MCP adapter (Stage G-1d)", async () => {
    const services: Record<string, unknown> = {
      "openbuddy-mcp-client": {
        list: async () => ({ servers: [{ name: "filesystem", status: "ready", toolCount: 3 }] }),
      },
    };
    const result = resolvePiExtensions(
      [{ id: "pi-mcp-adapter" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("unused"); },
        emit: () => undefined,
        resolveService: (owner) => services[owner],
      },
    );
    const tools = collectRegisteredTools(result);
    expect(tools.has("openbuddy_mcp")).toBe(true);
    const tool = tools.get("openbuddy_mcp")!;
    const listResult = await tool.execute("tc-1", { verb: "list" }, undefined, undefined, { cwd: "/tmp/workspace" } as never);
    expect(listResult.details.ok).toBe(true);
    expect(listResult.content[0]?.text).toContain("filesystem=ready(3 tools)");
  });

  // Stage G-1d: permission adapter registers a real pi tool.
  it("registers a real pi tool for the permission adapter (Stage G-1d)", async () => {
    const services: Record<string, unknown> = {
      "openbuddy-authorization": {
        readMode: async () => "strict",
        readRules: async () => [{ tool: "bash", action: "deny" }],
      },
    };
    const result = resolvePiExtensions(
      [{ id: "pi-permission-system" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("unused"); },
        emit: () => undefined,
        resolveService: (owner) => services[owner],
      },
    );
    const tools = collectRegisteredTools(result);
    expect(tools.has("openbuddy_permissions")).toBe(true);
    const tool = tools.get("openbuddy_permissions")!;
    const statusResult = await tool.execute("tc-1", { verb: "status" }, undefined, undefined, { cwd: "/tmp/workspace" } as never);
    expect(statusResult.details.ok).toBe(true);
    expect(statusResult.content[0]?.text).toContain("mode=strict");
    expect(statusResult.content[0]?.text).toContain("rules=1");
  });

  // Stage G-1d: goal adapter registers a real pi tool.
  it("registers a real pi tool for the goal adapter (Stage G-1d)", async () => {
    const services: Record<string, unknown> = {
      "openbuddy-team": {
        list: async () => [{ id: "team-1" }, { id: "team-2" }],
        get: async (id: string) => ({ id, members: 3 }),
      },
    };
    const result = resolvePiExtensions(
      [{ id: "pi-goal" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("unused"); },
        emit: () => undefined,
        resolveService: (owner) => services[owner],
      },
    );
    const tools = collectRegisteredTools(result);
    expect(tools.has("openbuddy_goals")).toBe(true);
    const tool = tools.get("openbuddy_goals")!;
    const listResult = await tool.execute("tc-1", { verb: "list" }, undefined, undefined, { cwd: "/tmp/workspace" } as never);
    expect(listResult.details.ok).toBe(true);
    expect(listResult.content[0]?.text).toContain("2 active team(s)");
  });

  // Stage G-1d: task adapter registers a real pi tool; sessionId flows through.
  it("registers a real pi tool for the task adapter and forwards sessionId (Stage G-1d)", async () => {
    const calls: Array<{ verb: string; sessionId?: string }> = [];
    const services: Record<string, unknown> = {
      "openbuddy-task": {
        list: async (sessionId: string) => {
          calls.push({ verb: "list", sessionId });
          return [{ id: "t-1", status: "pending" }];
        },
        add: async (sessionId: string, content: string) => {
          calls.push({ verb: "add", sessionId });
          return { id: "t-2", content };
        },
      },
    };
    const result = resolvePiExtensions(
      [{ id: "pi-todo" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("unused"); },
        emit: () => undefined,
        resolveService: (owner) => services[owner],
      },
    );
    const tools = collectRegisteredTools(result);
    expect(tools.has("openbuddy_tasks")).toBe(true);
    const tool = tools.get("openbuddy_tasks")!;
    const ctx = { cwd: "/tmp/workspace", sessionManager: { getSessionId: () => "session-xyz" } } as never;
    const listResult = await tool.execute("tc-1", { verb: "list" }, undefined, undefined, ctx);
    expect(listResult.details.ok).toBe(true);
    expect(listResult.content[0]?.text).toContain("t-1");
    expect(calls).toEqual([{ verb: "list", sessionId: "session-xyz" }]);
  });

  // Stage G-1d: fs adapter registers a real pi tool.
  it("registers a real pi tool for the fs adapter (Stage G-1d)", async () => {
    const services: Record<string, unknown> = {
      "openbuddy-fs-local": {
        listDir: async (path: string, cwd: string) => [{ name: "package.json", cwd, path }],
        readTextFile: async (path: string, _cwd: string) => `// contents of ${path}`,
      },
    };
    const result = resolvePiExtensions(
      [{ id: "pi-fs" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("unused"); },
        emit: () => undefined,
        resolveService: (owner) => services[owner],
      },
    );
    const tools = collectRegisteredTools(result);
    expect(tools.has("openbuddy_fs")).toBe(true);
    const tool = tools.get("openbuddy_fs")!;
    const readResult = await tool.execute("tc-1", { verb: "read", path: "README.md" }, undefined, undefined, { cwd: "/tmp/workspace" } as never);
    expect(readResult.details.ok).toBe(true);
    expect(readResult.content[0]?.text).toContain("// contents of README.md");
  });

  // Stage G-1d: when service is unavailable, tool returns a graceful error.
  it("returns a graceful error when adapter service is not mounted (Stage G-1d)", async () => {
    const result = resolvePiExtensions(
      [{ id: "pi-todo" }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => { throw new Error("unused"); },
        emit: () => undefined,
        resolveService: () => undefined,
      },
    );
    const tools = collectRegisteredTools(result);
    const tool = tools.get("openbuddy_tasks")!;
    // verb=add with no service → invokeTasksCommand returns undefined → bridge
    // produces a "completed without text summary" payload (not an error).
    const result2 = await tool.execute("tc-1", { verb: "list" }, undefined, undefined, { cwd: "/tmp/workspace" } as never);
    expect(result2.details.ok).toBe(true);
    expect(result2.content[0]?.text).toContain("completed without text summary");
  });
});

/**
 * Helper: collect all `pi.registerTool` calls produced by the given
 * resolved extensions. Mirrors the inline `tools = new Map(...)` setup
 * repeated in each G-1d test above.
 */
function collectRegisteredTools(
  resolution: Pick<import("./pi-extensions").PiExtensionResolution, "factories">,
): Map<string, {
  name: string;
  description: string;
  parameters: unknown;
  execute: (...callArgs: unknown[]) => Promise<{ content: Array<{ type: string; text: string }>; details: { ok: boolean; summary?: string; fallback?: boolean } }>;
}> {
  const tools = new Map<string, {
    name: string;
    description: string;
    parameters: unknown;
    execute: (...callArgs: unknown[]) => Promise<{ content: Array<{ type: string; text: string }>; details: { ok: boolean; summary?: string; fallback?: boolean } }>;
  }>();
  const api = {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: (tool: { name: string; description: string; parameters: unknown; execute: (...callArgs: unknown[]) => Promise<{ content: Array<{ type: string; text: string }>; details: { ok: boolean; summary?: string; fallback?: boolean } }> }) => {
      tools.set(tool.name, tool);
    },
  };
  resolution.factories.forEach((entry) => entry.factory(api as never));
  return tools;
}
