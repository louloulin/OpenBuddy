import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPiHooksExtension, discoverHookConfigs, listRegisteredHookConfigs, registerHookConfig, runHookPoint, type HookRuntimeConfig, type HookShellRunRequest } from "./agent-hooks";

describe("OpenBuddy Hook runtime", () => {
  it("runs through an injected shell service with protocol-compatible framing", async () => {
    const requests: HookShellRunRequest[] = [];
    const config: HookRuntimeConfig = {
      packageName: "fixture-injected-shell",
      packageRoot: "/tmp/fixture-injected-shell",
      dialect: "openbuddy",
      defaultTimeoutMs: 321,
      stderrSummaryMaxChars: 500,
      config: { dialect: "openbuddy", events: { "tool/start": [{ matcher: "bash", hooks: [{ command: "ignored" }] }] } },
      diagnostics: [],
    };
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    const shellRunner = {
      run: async (request: HookShellRunRequest) => {
        requests.push(request);
        return { exitCode: 0, stdout: JSON.stringify({ additionalContext: "injected context" }), stderr: "" };
      },
    };
    createPiHooksExtension(() => [config], () => undefined, { resolveShellRunner: () => shellRunner })(pi);

    await handlers.get("tool_call")?.({ toolName: "bash", toolCallId: "call-1", input: { command: "echo hi" } }, { cwd: "/workspace", signal: undefined });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ command: "ignored", cwd: "/workspace", timeoutMs: 321, env: { OPENBUDDY_PROJECT_DIR: "/workspace" } });
    expect(requests[0]?.stdin).toContain('"toolName":"bash"');
    expect(requests[0]?.stdin.endsWith("\n")).toBe(true);
  });

  it("maps Pi session shutdown to SessionEnd and preserves Codex plain stdout context", async () => {
    const configs: HookRuntimeConfig[] = [{
      packageName: "fixture-codex-lifecycle",
      packageRoot: "/tmp/fixture-codex-lifecycle",
      dialect: "codex",
      defaultTimeoutMs: 321,
      stderrSummaryMaxChars: 500,
      config: { dialect: "codex", events: {
        "session/end": [{ hooks: [{ command: "session-end" }] }],
        "prompt/submit": [{ hooks: [{ command: "prompt" }] }],
      } },
      diagnostics: [],
    }];
    const calls: HookShellRunRequest[] = [];
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    createPiHooksExtension(() => configs, () => undefined, {
      shellRunner: { run: async (request) => { calls.push(request); return { exitCode: 0, stdout: request.command === "prompt" ? "plain codex context" : "", stderr: "" }; } },
    })(pi);

    const context = { cwd: "/workspace", signal: undefined, sessionManager: { getSessionId: () => "s-1" } };
    await handlers.get("session_shutdown")?.({ reason: "reload" }, context);
    const promptResult = await handlers.get("before_agent_start")?.({ prompt: "hello", systemPrompt: "base" }, context);

    expect(calls.map((request) => request.command)).toEqual(["session-end", "prompt"]);
    expect(calls[0]?.stdin.endsWith("\n")).toBe(false);
    expect(promptResult).toMatchObject({ systemPrompt: expect.stringContaining("plain codex context") });
  });

  it("injects SessionStart context only once and clears it on shutdown", async () => {
    const config: HookRuntimeConfig = {
      packageName: "fixture-session-context",
      packageRoot: "/tmp/fixture-session-context",
      dialect: "openbuddy",
      defaultTimeoutMs: 1000,
      stderrSummaryMaxChars: 500,
      config: { dialect: "openbuddy", events: {
        "session/start": [{ hooks: [{ command: "session-start" }] }],
      } },
      diagnostics: [],
    };
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    createPiHooksExtension(() => [config], () => undefined, {
      shellRunner: { run: async (request) => ({ exitCode: 0, stdout: request.command === "session-start" ? JSON.stringify({ additionalContext: "startup context" }) : "", stderr: "" }) },
    })(pi);

    const context = { cwd: "/workspace", signal: undefined, sessionManager: { getSessionId: () => "session-context" } };
    await handlers.get("session_start")?.({ source: "startup" }, context);
    const first = await handlers.get("before_agent_start")?.({ prompt: "hello", systemPrompt: "base" }, context);
    const second = await handlers.get("before_agent_start")?.({ prompt: "again", systemPrompt: "base" }, context);

    expect(first).toMatchObject({ systemPrompt: expect.stringContaining("startup context") });
    expect(second).toBeUndefined();

    await handlers.get("session_start")?.({ source: "restart" }, context);
    await handlers.get("session_shutdown")?.({ reason: "reload" }, context);
    const afterShutdown = await handlers.get("before_agent_start")?.({ prompt: "after", systemPrompt: "base" }, context);
    expect(afterShutdown).toBeUndefined();
  });

  it("steers a Claude or Codex Stop hook once per session", async () => {
    const config: HookRuntimeConfig = {
      packageName: "fixture-stop-hook",
      packageRoot: "/tmp/fixture-stop-hook",
      dialect: "claude-code",
      defaultTimeoutMs: 1000,
      stderrSummaryMaxChars: 500,
      config: { dialect: "claude-code", events: {
        "turn/end": [{ hooks: [{ command: "stop" }] }],
      } },
      diagnostics: [],
    };
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const sent: Array<{ text: string; options: unknown }> = [];
    const events: Array<{ type: string; payload: any }> = [];
    const pi = {
      on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler),
      sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
    } as any;
    createPiHooksExtension(() => [config], (type, payload) => events.push({ type, payload }), {
      shellRunner: { run: async () => ({ exitCode: 0, stdout: JSON.stringify({ decision: "block", reason: "finish verification" }), stderr: "" }) },
    })(pi);

    const context = { cwd: "/workspace", signal: undefined, sessionManager: { getSessionId: () => "session-stop" } };
    await handlers.get("turn_end")?.({ turnIndex: 1 }, context);
    await handlers.get("turn_end")?.({ turnIndex: 2 }, context);

    expect(sent).toEqual([{ text: "finish verification", options: { deliverAs: "steer" } }]);
    expect(events).toEqual(expect.arrayContaining([
      { type: "hook/stop-steered", payload: { point: "turn/end", reason: "finish verification", sessionId: "session-stop" } },
      { type: "hook/stop-steer-skipped", payload: { point: "turn/end", reason: "stop hook already steered this session", sessionId: "session-stop" } },
    ]));

    await handlers.get("session_shutdown")?.({ reason: "done" }, context);
  });

  it("executes plugin lifecycle hooks through the shared runtime", async () => {
    const calls: HookShellRunRequest[] = [];
    const config: HookRuntimeConfig = {
      packageName: "fixture-plugin-lifecycle",
      packageRoot: "/tmp/fixture-plugin-lifecycle",
      dialect: "openbuddy",
      defaultTimeoutMs: 1000,
      stderrSummaryMaxChars: 500,
      config: { dialect: "openbuddy", events: { "plugin/loaded": [{ matcher: "fixture-plugin", hooks: [{ command: "plugin-loaded" }] }] } },
      diagnostics: [],
    };
    const outcome = await runHookPoint([config], "plugin/loaded", "fixture-plugin", { id: "fixture-plugin" }, { cwd: "/workspace", signal: undefined }, () => undefined, {
      run: async (request) => { calls.push(request); return { exitCode: 0, stdout: "", stderr: "" }; },
    });
    expect(outcome.decision).toBe("none");
    expect(calls[0]).toMatchObject({ command: "plugin-loaded", cwd: "/workspace" });
  });

  it("accepts plugin unload lifecycle hooks", async () => {
    const config: HookRuntimeConfig = {
      packageName: "fixture-plugin-unload",
      packageRoot: "/tmp/fixture-plugin-unload",
      dialect: "openbuddy",
      defaultTimeoutMs: 1000,
      stderrSummaryMaxChars: 500,
      config: { dialect: "openbuddy", events: { "plugin/unloaded": [{ matcher: "fixture-plugin", hooks: [{ command: "plugin-unloaded" }] }] } },
      diagnostics: [],
    };
    const calls: HookShellRunRequest[] = [];
    const outcome = await runHookPoint([config], "plugin/unloaded", "fixture-plugin", { id: "fixture-plugin" }, { cwd: "/workspace", signal: undefined }, () => undefined, {
      run: async (request) => { calls.push(request); return { exitCode: 0, stdout: "", stderr: "" }; },
    });
    expect(outcome.decision).toBe("none");
    expect(calls[0]).toMatchObject({ command: "plugin-unloaded", cwd: "/workspace" });
  });

  it("serializes Pi-backed subagent lifecycle hooks with Claude-compatible fields", async () => {
    const config: HookRuntimeConfig = {
      packageName: "fixture-subagent-hooks",
      packageRoot: "/tmp/fixture-subagent-hooks",
      dialect: "claude-code",
      defaultTimeoutMs: 1000,
      stderrSummaryMaxChars: 500,
      config: { dialect: "claude-code", events: {
        "agent/start": [{ matcher: "general-purpose", hooks: [{ command: "start" }] }],
        "agent/end": [{ matcher: "general-purpose", hooks: [{ command: "end" }] }],
      } },
      diagnostics: [],
    };
    const requests: HookShellRunRequest[] = [];
    const context = { cwd: "/workspace", signal: undefined, sessionId: "child-1", transcriptPath: "/workspace/child.jsonl" };
    const payload = { runId: "run-1", agentId: "child-1", agentType: "general-purpose", teamId: "team-1", memberId: "member-1" };
    await runHookPoint([config], "agent/start", "general-purpose", payload, context, () => undefined, {
      run: async (request) => { requests.push(request); return { exitCode: 0, stdout: "", stderr: "" }; },
    });
    await runHookPoint([config], "agent/end", "general-purpose", { ...payload, stopReason: "completed" }, context, () => undefined, {
      run: async (request) => { requests.push(request); return { exitCode: 0, stdout: "", stderr: "" }; },
    });
    expect(JSON.parse(requests[0]!.stdin)).toMatchObject({ hook_event_name: "SubagentStart", agent_id: "child-1", agent_type: "general-purpose", session_id: "child-1" });
    expect(JSON.parse(requests[1]!.stdin)).toMatchObject({ hook_event_name: "SubagentStop", stop_reason: "completed", stop_hook_active: false });
  });

  it("feeds PostToolUse context and system messages back into the tool result", async () => {
    const config: HookRuntimeConfig = {
      packageName: "fixture-tool-result-hook",
      packageRoot: "/tmp/fixture-tool-result-hook",
      dialect: "openbuddy",
      defaultTimeoutMs: 1000,
      stderrSummaryMaxChars: 500,
      config: { dialect: "openbuddy", events: { "tool/end": [{ matcher: "bash", hooks: [{ command: "tool-result" }] }] } },
      diagnostics: [],
    };
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    createPiHooksExtension(() => [config], () => undefined, {
      shellRunner: { run: async () => ({ exitCode: 0, stdout: JSON.stringify({ additionalContext: "check output", systemMessage: "hook note" }), stderr: "" }) },
    })(pi);
    const result = await handlers.get("tool_result")?.({ toolName: "bash", toolCallId: "call-1", input: {}, content: [{ type: "text", text: "original" }], isError: false }, { cwd: "/workspace", signal: undefined }) as { content: Array<{ type: string; text: string }> } | undefined;
    expect(result?.content).toEqual(expect.arrayContaining([
      { type: "text", text: "original" },
      { type: "text", text: expect.stringContaining("check output") },
      { type: "text", text: expect.stringContaining("hook note") },
    ]));
  });

  it("turns a strict PostToolUse deny into an error result with feedback", async () => {
    const config: HookRuntimeConfig = {
      packageName: "fixture-claude-post-tool",
      packageRoot: "/tmp/fixture-claude-post-tool",
      dialect: "claude-code",
      defaultTimeoutMs: 1000,
      stderrSummaryMaxChars: 500,
      config: { dialect: "claude-code", events: { "tool/end": [{ matcher: "bash", hooks: [{ command: "post-tool" }] }] } },
      diagnostics: [],
    };
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    createPiHooksExtension(() => [config], () => undefined, {
      shellRunner: { run: async () => ({ exitCode: 2, stdout: "", stderr: "output rejected" }) },
    })(pi);
    const result = await handlers.get("tool_result")?.({ toolName: "bash", toolCallId: "call-1", input: {}, content: [{ type: "text", text: "original" }], isError: false }, { cwd: "/workspace", signal: undefined }) as { content: Array<{ type: string; text: string }>; isError?: boolean } | undefined;
    expect(result?.isError).toBe(true);
    expect(result?.content.some((item) => item.text.includes("output rejected"))).toBe(true);
  });

  it("discovers inline hooks and blocks a matching Pi tool call", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-hooks-"));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture-hooks",
      openbuddy: {
        hooks: {
          "tool/start": [{ matcher: "bash", hooks: [{ type: "command", command: "printf '%s' '{\"hookSpecificOutput\":{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"fixture blocked\"}}'" }] }],
        },
      },
    }));
    const events: Array<{ type: string; payload: any }> = [];
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    try {
      const configs = await discoverHookConfigs([root]);
      expect(configs).toHaveLength(1);
      createPiHooksExtension(() => configs, (type, payload) => events.push({ type, payload }))(pi);
      const result = await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "call-1", toolName: "bash", input: { command: "rm -rf /" } }, { cwd: root, signal: undefined });
      expect(result).toMatchObject({ block: true, reason: "fixture blocked" });
      expect(events.map((event) => event.type)).toEqual(["hook/invoked", "hook/result"]);
      expect(events[1]?.payload).toMatchObject({ decision: "deny", durationMs: expect.any(Number) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("contains malformed config and skips non-command hooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-hooks-invalid-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture-invalid-hooks",
      dsh: { hooks: { "tool/start": [{ hooks: [{ type: "http", url: "https://example.test" }] }] } },
    }));
    try {
      const configs = await discoverHookConfigs([root]);
      expect(configs[0]?.config.events["tool/start"]).toBeUndefined();
      expect(configs[0]?.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: "unsupported hook type 'http'" })]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts DeepSeek Harness dialect registrations and removes them on dispose", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-hooks-registry-"));
    const unregister = registerHookConfig({
      packageName: "@deepseek-ai/dsh-hooks-codex",
      packageRoot: root,
      dialect: "codex",
      config: { PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "printf '{\"decision\":\"deny\"}'" }] }] },
    });
    try {
      expect(listRegisteredHookConfigs()).toHaveLength(1);
      const configs = await discoverHookConfigs([]);
      expect(configs).toHaveLength(1);
      expect(configs[0]).toMatchObject({ packageName: "@deepseek-ai/dsh-hooks-codex", dialect: "codex" });
      expect(configs[0]?.config.events["tool/start"]).toHaveLength(1);
      expect(configs[0]?.config.events["turn/start"]).toBeUndefined();
    } finally {
      unregister();
      await rm(root, { recursive: true, force: true });
    }
    expect(listRegisteredHookConfigs()).toHaveLength(0);
  });

  it("injects additional context through Pi before_agent_start", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-hooks-context-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture-context-hooks",
      openbuddy: {
        hooks: {
          "prompt/submit": [{ hooks: [{ type: "command", command: "printf '%s' '{\"additionalContext\":\"use fixture context\"}'" }] }],
        },
      },
    }));
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    try {
      const configs = await discoverHookConfigs([root]);
      createPiHooksExtension(() => configs, () => undefined)(pi);
      const result = await handlers.get("before_agent_start")?.({ prompt: "hello", systemPrompt: "base" }, { cwd: root, signal: undefined, hasUI: false });
      expect(result).toMatchObject({ systemPrompt: expect.stringContaining("use fixture context") });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes ask decisions through confirmation and blocks rejected tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-hooks-ask-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture-ask-hooks",
      openbuddy: {
        hooks: {
          "tool/start": [{ matcher: "bash", hooks: [{ type: "command", command: "printf '%s' '{\"hookSpecificOutput\":{\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"confirm bash\"}}'" }] }],
        },
      },
    }));
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    try {
      const configs = await discoverHookConfigs([root]);
      createPiHooksExtension(() => configs, () => undefined, { confirm: async () => false })(pi);
      const result = await handlers.get("tool_call")?.({ toolName: "bash", input: {} }, { cwd: root, signal: undefined, hasUI: true });
      expect(result).toMatchObject({ block: true, reason: "confirm bash" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts persistent hook permission decisions and still fails closed without UI", async () => {
    const config: HookRuntimeConfig = {
      packageName: "fixture-ask-decision",
      packageRoot: "/tmp/fixture-ask-decision",
      dialect: "openbuddy",
      defaultTimeoutMs: 1000,
      stderrSummaryMaxChars: 500,
      config: { dialect: "openbuddy", events: { "tool/start": [{ matcher: "bash", hooks: [{ command: "ask" }] }] } },
      diagnostics: [],
    };
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    const shellRunner = { run: async () => ({ exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "confirm" } }), stderr: "" }) };
    createPiHooksExtension(() => [config], () => undefined, { shellRunner, confirm: async () => "allow_always" })(pi);
    await expect(handlers.get("tool_call")?.({ toolName: "bash", input: {} }, { cwd: "/tmp", signal: undefined, hasUI: true })).resolves.toBeUndefined();
    await expect(handlers.get("tool_call")?.({ toolName: "bash", input: {} }, { cwd: "/tmp", signal: undefined, hasUI: false })).resolves.toMatchObject({ block: true });
  });

  it("uses Claude and Codex dialect-specific stdin payloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-hooks-payload-"));
    const claudePayloadPath = join(root, "payload-claude.json");
    const codexPayloadPath = join(root, "payload-codex.json");
    const unregisterClaude = registerHookConfig({
      packageName: "fixture-claude",
      packageRoot: root,
      dialect: "claude-code",
      config: { "tool/start": [{ matcher: "bash", hooks: [{ type: "command", command: `cat > "${claudePayloadPath}"; printf '{\"additionalContext\":\"ok\"}'` }] }] },
    });
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    try {
      const configs = await discoverHookConfigs([root]);
      configs.push({
        packageName: "fixture-codex",
        packageRoot: root,
        dialect: "codex",
        model: "fixture-model",
        defaultTimeoutMs: 600_000,
        stderrSummaryMaxChars: 500,
        config: { dialect: "codex", events: { "tool/start": [{ matcher: "bash", hooks: [{ command: `cat > "${codexPayloadPath}"; printf '{\\\"additionalContext\\\":\\\"ok\\\"}'` }] }] } },
        diagnostics: [],
      });
      createPiHooksExtension(() => configs, () => undefined)(pi);
      await handlers.get("tool_call")?.({ toolName: "bash", toolCallId: "call-1", input: { command: "echo hi" } }, { cwd: root, signal: undefined, hasUI: false, sessionManager: { getSessionId: () => "session-1", getSessionFile: () => join(root, "session.jsonl") } });
      const claudePayload = JSON.parse(await readFile(claudePayloadPath, "utf8"));
      const codexPayload = JSON.parse(await readFile(codexPayloadPath, "utf8"));
      expect(claudePayload).toMatchObject({ hook_event_name: "PreToolUse", session_id: "session-1", transcript_path: join(root, "session.jsonl"), tool_name: "bash", tool_input: { command: "echo hi" } });
      expect(codexPayload).toMatchObject({ hook_event_name: "PreToolUse", session_id: "session-1", transcript_path: join(root, "session.jsonl"), model: "fixture-model", tool_input: { command: "echo hi" } });
    } finally {
      unregisterClaude();
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("cancels active hook processes during runtime disposal", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-hooks-cancel-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture-cancel-hooks",
      openbuddy: { hooks: { "tool/start": [{ hooks: [{ type: "command", command: "sleep 30" }] }] } },
    }));
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    try {
      const configs = await discoverHookConfigs([root]);
      createPiHooksExtension(() => configs, () => undefined)(pi);
      const pending = handlers.get("tool_call")?.({ toolName: "bash", input: {} }, { cwd: root, signal: undefined, hasUI: false });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      const { disposeActiveHookProcesses, drainActiveHookProcesses } = await import("./agent-hooks");
      disposeActiveHookProcesses();
      await drainActiveHookProcesses();
      await expect(pending).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("surfaces system messages and stop reasons as plugin events", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-hooks-system-message-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture-system-message-hooks",
      openbuddy: { hooks: { "turn/end": [{ hooks: [{ type: "command", command: "printf '%s' '{\"systemMessage\":\"heads up\",\"continue\":false,\"stopReason\":\"fixture stop\"}'" }] }] } },
    }));
    const events: Array<{ type: string; payload: any }> = [];
    const handlers = new Map<string, (event: any, context: any) => unknown>();
    const pi = { on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => handlers.set(event, handler) } as any;
    try {
      const configs = await discoverHookConfigs([root]);
      createPiHooksExtension(() => configs, (type, payload) => events.push({ type, payload }))(pi);
      await handlers.get("turn_end")?.({ turnIndex: 1 }, { cwd: root, signal: undefined, sessionManager: { getSessionId: () => "session-1" } });
      expect(events).toEqual(expect.arrayContaining([
        { type: "hook/system-message", payload: { point: "turn/end", systemMessage: "heads up", sessionId: "session-1" } },
        { type: "hook/stop", payload: { point: "turn/end", stop: true, stopReason: "fixture stop", sessionId: "session-1" } },
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
