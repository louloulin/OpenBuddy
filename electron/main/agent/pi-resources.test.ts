import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-pi-resources-test" },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("../casdoor/casdoor-auth", () => ({
  casdoorAuth: { status: () => ({ config: { configured: false }, identity: null, tenantContext: { activeTenantId: undefined } }) },
}));

const originalPiHome = process.env.PI_HOME;
const originalPiAgent = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalPiHome === undefined) delete process.env.PI_HOME;
  else process.env.PI_HOME = originalPiHome;
  if (originalPiAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiAgent;
});

async function loadResources() {
  return import("./pi-resources");
}

describe("Pi resource adapters", () => {
  it("persists defaults and agents inside the configured Pi home", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-resources-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();

    await expect(resources.writeAgentDefaults({ defaultModel: "anthropic/claude", defaultPermission: "plan", rememberToolApprovals: false })).resolves.toMatchObject({ defaultModel: "anthropic/claude", defaultPermission: "plan", rememberToolApprovals: false });
    await expect(resources.readAgentDefaults()).resolves.toMatchObject({ defaultModel: "anthropic/claude", defaultPermission: "plan", rememberToolApprovals: false });
    const entry = await resources.saveAgent("reviewer", resources.agentTemplate("reviewer", "Review code", "Check the diff."));
    expect(entry.name).toBe("reviewer");
    await expect(resources.getAgent("reviewer.md")).resolves.toContain("Check the diff.");
    await expect(resources.getAgent("../../outside.md")).rejects.toThrow("outside allowed roots");
    await resources.deleteAgent("reviewer.md");
    await expect(resources.listAgents()).resolves.toEqual([]);
  });

	it("loads layered AGENTS.md workspace instructions with a bounded prompt envelope", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-instructions-home-"));
    const project = await mkdtemp(join(tmpdir(), "openbuddy-instructions-project-"));
    const nested = join(project, "src", "feature");
    process.env.PI_CODING_AGENT_DIR = join(home, "agent");
    await mkdir(nested, { recursive: true });
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(join(home, "agent"), { recursive: true });
    await writeFile(join(home, "agent", "AGENTS.md"), "Global guidance\n", "utf8");
    await writeFile(join(project, "AGENTS.md"), "Project guidance\n", "utf8");
    await writeFile(join(project, "src", "AGENTS.md"), "Nested guidance\n", "utf8");
    const resources = await loadResources();
    const rendered = await resources.readWorkspaceInstructions(nested);
    expect(rendered).toContain("Global guidance");
    expect(rendered).toContain("Project guidance");
    expect(rendered).toContain("Nested guidance");
    expect(rendered).toContain("do not override system, developer, or direct user instructions");
    expect((await resources.readWorkspaceInstructions(nested, 10)).length).toBeLessThanOrEqual(400);
  });

	it("scans skills and marketplace plugins and supports local install/remove", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-market-"));
    const source = await mkdtemp(join(tmpdir(), "openbuddy-source-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();
    await mkdir(join(source, "plugins", "demo", "skills", "hello"), { recursive: true });
    await mkdir(join(source, "plugins", "demo", "agents"), { recursive: true });
    await writeFile(join(source, "plugins", "demo", "package.json"), JSON.stringify({ name: "demo", version: "1.0.0", description: "Demo" }));
    await writeFile(join(source, "plugins", "demo", "skills", "hello", "SKILL.md"), "---\ndescription: Say hello\n---\n");
    await writeFile(join(source, "plugins", "demo", "agents", "review.md"), "---\ndescription: Review\n---\n");
    await resources.marketplaceAddSource(source);
    const scanned = await resources.marketplaceScan();
    const localSource = scanned.sources.find((entry) => entry.sourceKindValue === "local");
    expect(localSource).toMatchObject({ plugins: [{ name: "demo", installStatus: "available", hasAgents: true }] });
    await resources.marketplaceAction({ type: "install", sourceUrlOrPath: source, pluginRelativePath: "demo" });
    await expect(resources.listPlugins()).resolves.toMatchObject([{ name: "demo", agentCount: 1, skillCount: 1 }]);
    await resources.marketplaceAction({ type: "uninstall", sourceUrlOrPath: source, pluginRelativePath: "demo" });
    await expect(resources.listPlugins()).resolves.toEqual([]);
    await expect(readFile(join(home, ".pi", "agent", "marketplaces.json"), "utf8")).resolves.toContain(source);
	});

	it("supports Harness candidate files, local overlays, and configured source limits", async () => {
		const home = await mkdtemp(join(tmpdir(), "openbuddy-instructions-config-home-"));
		const project = await mkdtemp(join(tmpdir(), "openbuddy-instructions-config-project-"));
		const nested = join(project, "src");
		process.env.PI_CODING_AGENT_DIR = join(home, "agent");
		await mkdir(nested, { recursive: true });
		await mkdir(join(project, ".git"), { recursive: true });
		await mkdir(join(home, "agent"), { recursive: true });
		await writeFile(join(home, "agent", "AGENTS.md"), "Global guidance\n", "utf8");
		await writeFile(join(project, "CLAUDE.md"), "Project guidance\n", "utf8");
		await writeFile(join(project, "AGENTS.local.md"), "Local overlay\n", "utf8");
		await writeFile(join(nested, "AGENTS.md"), "This source is too large\n", "utf8");
		const resources = await loadResources();
		const rendered = await resources.readWorkspaceInstructions(nested, 4096, {
			maxSourceBytes: 20,
			instructionFileCandidates: ["CLAUDE.md"],
			localInstructionFileCandidates: ["AGENTS.local.md"],
		});
		expect(rendered).toContain("$DSH_HOME/AGENTS.md");
		expect(rendered).toContain("Project guidance");
		expect(rendered).toContain("Local overlay");
		expect(rendered).not.toContain("This source is too large");
	});

	it("discovers Pi-backed agent presets with precedence, metadata, and defaults", async () => {
		const home = await mkdtemp(join(tmpdir(), "openbuddy-presets-home-"));
		const project = await mkdtemp(join(tmpdir(), "openbuddy-presets-project-"));
		process.env.PI_CODING_AGENT_DIR = join(home, "agent");
		await mkdir(join(home, "agent", "agent-presets", "standard"), { recursive: true });
		await mkdir(join(project, ".agent-presets", "standard"), { recursive: true });
		await mkdir(join(project, ".agent-presets", "broken"), { recursive: true });
		await writeFile(join(home, "agent", "agent-presets", "standard", "agent.cordis.yml"), "- name: system\n", "utf8");
		await writeFile(join(home, "agent", "agent-presets", "standard", "preset.yml"), "name: Standard\ndescription: shipped\norder: 1\n", "utf8");
		await writeFile(join(project, ".agent-presets", "standard", "agent.cordis.yml"), "- name: project\n", "utf8");
		await writeFile(join(project, ".agent-presets", "broken", "preset.yml"), "name: Broken\n", "utf8");
		const resources = await loadResources();
		const presets = await resources.listAgentPresets(project);
		expect(presets).toEqual([
			expect.objectContaining({ id: "standard", trust: "user", name: "Standard", description: "shipped", order: 1 }),
			expect.objectContaining({ id: "broken", broken: expect.stringContaining("missing") }),
		]);
		expect(await resources.readAgentPreset("standard", project)).toContain("system");
		await resources.writeAgentPresetDefault("standard");
		expect(await resources.readAgentPresetDefaults()).toEqual({ default: "standard" });
		await resources.writeAgentPresetDefault(undefined);
		expect(await resources.readAgentPresetDefaults()).toEqual({});
	});

	it("counts declared OpenBuddy and DSH hooks instead of only hook files", async () => {
		const home = await mkdtemp(join(tmpdir(), "openbuddy-market-hooks-"));
		process.env.PI_HOME = home;
		delete process.env.PI_CODING_AGENT_DIR;
		const pluginRoot = join(home, ".pi", "agent", "plugins", "declared-hooks");
		await mkdir(pluginRoot, { recursive: true });
		await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
			name: "declared-hooks",
			openbuddy: { hooks: { "prompt/submit": [{ hooks: [{ type: "command", command: "printf ok" }] }] } },
			dsh: { hooks: { PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "printf ok" }] }] } },
		}));
		const resources = await loadResources();
		await expect(resources.listPlugins()).resolves.toMatchObject([{
			name: "declared-hooks",
			hookCount: 2,
			hookPoints: ["prompt/submit", "tool/start"],
			hookDiagnostics: [],
		}]);
	});

	it("projects installed plugin resources into Pi loader paths", async () => {
		const home = await mkdtemp(join(tmpdir(), "openbuddy-market-pi-resources-"));
		const source = await mkdtemp(join(tmpdir(), "openbuddy-market-pi-source-"));
		process.env.PI_HOME = home;
		delete process.env.PI_CODING_AGENT_DIR;
		const resources = await loadResources();
		await mkdir(join(source, "plugins", "pi-demo", "extensions"), { recursive: true });
		await mkdir(join(source, "plugins", "pi-demo", "skills", "hello"), { recursive: true });
		await writeFile(join(source, "plugins", "pi-demo", "package.json"), JSON.stringify({
			name: "pi-demo",
			pi: { extensions: ["./extensions/index.js"], skills: ["./skills"] },
		}));
		await writeFile(join(source, "plugins", "pi-demo", "extensions", "index.js"), "export default () => {};\n");
		await writeFile(join(source, "plugins", "pi-demo", "skills", "hello", "SKILL.md"), "---\ndescription: Hello\n---\n");
		await resources.marketplaceAddSource(source);
		await resources.marketplaceAction({ type: "install", sourceUrlOrPath: source, pluginRelativePath: "pi-demo" });
		const paths = await resources.listPiPluginResourcePaths();
		expect(paths).toHaveLength(1);
		expect(paths[0]).toMatchObject({ plugin: { name: "pi-demo", enabled: true } });
		expect(paths[0]?.extensions[0]).toContain("extensions/index.js");
		expect(paths[0]?.skills[0]).toContain("skills");
	});

	it("rejects unsupported remote marketplace sources", async () => {
		const home = await mkdtemp(join(tmpdir(), "openbuddy-market-remote-"));
		process.env.PI_HOME = home;
		delete process.env.PI_CODING_AGENT_DIR;
		const resources = await loadResources();
		await expect(resources.marketplaceAction({ type: "add_source", url: "https://example.com/marketplace.git" })).rejects.toThrow("remote marketplace");
	});

  it("loads WorkBuddy expert manifests and featured scenes", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-experts-"));
    await mkdir(join(root, "_meta"), { recursive: true });
    await mkdir(join(root, "reviewer", ".aily-plugin"), { recursive: true });
    await mkdir(join(root, "reviewer", "agents"), { recursive: true });
    await writeFile(join(root, "reviewer", ".aily-plugin", "plugin.json"), JSON.stringify({ avatar: "avatar.png", agentName: "reviewer" }));
    await writeFile(join(root, "reviewer", "avatar.png"), "png");
    await writeFile(join(root, "reviewer", "agents", "reviewer.md"), "---\ndescription: Review code\n---\n");
    await writeFile(join(root, "_meta", "_expert_center.json"), JSON.stringify({ categories: [{ id: "code", name: { zh: "代码", en: "Code" } }], experts: [{ id: "reviewer", categoryId: "code", plugin: "reviewer", displayName: { zh: "审查员", en: "Reviewer" }, profession: { zh: "代码审查", en: "Code review" }, displayDescription: { zh: "审查变更" }, expertType: "agent", tags: [{ zh: "工程" }], quickPrompts: [{ zh: "检查这个 diff" }] }] }));
    await writeFile(join(root, "_meta", "featuredScenes.json"), JSON.stringify({ scenes: [{ id: "code", displayName: { zh: "代码场景" }, expertIds: ["reviewer"] }] }));
    const resources = await loadResources();
    await expect(resources.listExpertCatalog(root)).resolves.toMatchObject({ categories: [{ id: "code", zh: "代码", en: "Code" }], experts: [{ id: "reviewer", name: "审查员", avatarLocal: join(root, "reviewer", "avatar.png"), plugin: "reviewer", agentName: "reviewer", quickPrompts: ["检查这个 diff"] }], featuredScenes: [{ id: "code", expertIds: ["reviewer"] }] });
    await expect(resources.expertListRoots(root)).resolves.toEqual([root]);
    await expect(resources.readImageData(join(root, "reviewer", "agents", "reviewer.md"))).rejects.toThrow("asset is not an image");
  });

	it("merges global and project MCP configs and tracks auth state", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-mcp-"));
    const project = await mkdtemp(join(tmpdir(), "openbuddy-mcp-project-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();
    await resources.mcpConfigSave(JSON.stringify({ mcpServers: { global: { command: "global", emailProfile: "gmail" }, shared: { command: "global" } } }));
    await mkdir(join(project, ".pi"), { recursive: true });
    await writeFile(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "project" }, local: { command: "local", needs_auth: true } } }));
    await expect(resources.mcpList(project)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "global", source: "user", emailProfile: "gmail" }),
      expect.objectContaining({ name: "shared", source: "project", target: "project" }),
      expect.objectContaining({ name: "local", source: "project" }),
    ]));
    await expect(resources.mcpAuthStatus(project)).resolves.toEqual([{ serverName: "local", status: "needs_auth" }]);
    await resources.mcpAuthMark("local", "pending", "finish login");
    await expect(resources.mcpAuthStatus(project)).resolves.toEqual([{ serverName: "local", status: "pending", error: "finish login" }]);
    await resources.mcpAuthStoreCredential("local", { accessToken: "secret-token", refreshToken: "refresh-token", expiresIn: 3600 });
    await expect(resources.mcpAuthStatus(project)).resolves.toEqual([]);
    await expect(resources.mcpAuthCredential("local")).resolves.toMatchObject({ accessToken: "secret-token" });
		await expect(readFile(join(home, ".pi", "agent", "mcp-auth.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("writes MCP mutations to the owning project or global scope", async () => {
		const home = await mkdtemp(join(tmpdir(), "openbuddy-mcp-scope-"));
		const project = await mkdtemp(join(tmpdir(), "openbuddy-mcp-scope-project-"));
		process.env.PI_HOME = home;
		delete process.env.PI_CODING_AGENT_DIR;
		const resources = await loadResources();
		await resources.mcpUpsert("global", { command: "global" }, project);
		await mkdir(join(project, ".pi"), { recursive: true });
		await writeFile(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { project: { command: "project" } } }));
		await resources.mcpUpsert("project", { command: "project-updated" }, project);
		await expect(readFile(join(home, ".pi", "agent", "mcp.json"), "utf8")).resolves.toContain('"global"');
		await expect(readFile(join(project, ".pi", "mcp.json"), "utf8")).resolves.toContain('"project"');
		await resources.mcpToggle("project", false, project);
		await resources.mcpDelete("project", project);
		await expect(readFile(join(project, ".pi", "mcp.json"), "utf8")).resolves.not.toContain('"project"');
	});

  it("projects enabled marketplace MCP servers without persisting them", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-marketplace-mcp-"));
    const project = await mkdtemp(join(tmpdir(), "openbuddy-marketplace-mcp-project-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const pluginRoot = join(home, ".pi", "agent", "plugins", "market-mcp");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "market-mcp", version: "1.0.0" }));
    await writeFile(join(pluginRoot, "mcp.json"), JSON.stringify({ mcpServers: { bundled: { command: "market-command" }, shared: { command: "market-shared" } } }));
    const resources = await loadResources();

    await expect(resources.mcpConfigRead(project)).resolves.toMatchObject({ mcpServers: {
      bundled: { command: "market-command" },
      shared: { command: "market-shared" },
    } });
    await resources.mcpConfigSave(JSON.stringify(await resources.mcpConfigRead(project)));
    await expect(readFile(join(home, ".pi", "agent", "mcp.json"), "utf8")).resolves.not.toContain("market-command");
    await resources.mcpConfigSave(JSON.stringify({ mcpServers: { shared: { command: "user-shared" } } }));
    await mkdir(join(project, ".pi"), { recursive: true });
    await writeFile(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "project-shared" } } }));
    await expect(resources.mcpList(project)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "bundled", source: "marketplace:market-mcp", target: "market-command" }),
      expect.objectContaining({ name: "shared", source: "project", target: "project-shared" }),
    ]));
    await expect(readFile(join(home, ".pi", "agent", "mcp.json"), "utf8")).resolves.toBe(JSON.stringify({ mcpServers: { shared: { command: "user-shared" } } }, null, 2) + "\n");
  });

  it("links expert agent prompts into the Pi agent directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-experts-link-"));
    const root = await mkdtemp(join(tmpdir(), "openbuddy-expert-source-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();
    await mkdir(join(root, "plugin", "agents"), { recursive: true });
    await writeFile(join(root, "plugin", "agents", "reviewer.md"), "---\ndescription: Review\n---\nReview the change.\n");
    await expect(resources.linkExpertAgents(root, "plugin", ["reviewer"])).resolves.toBe(1);
    await expect(readFile(join(home, ".pi", "agent", "agents", "reviewer.md"), "utf8")).resolves.toContain("Review the change.");
    await expect(resources.linkExpertAgents(root, "plugin", ["../escape"])).rejects.toThrow("invalid resource name");
  });

  it("searches and forks sessions through Pi's canonical agent root", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-session-resources-"));
    const cwd = await mkdtemp(join(tmpdir(), "openbuddy-session-cwd-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();
    const sessionId = "01a04373-374a-796c-bdbb-ecd1d67056ee";
    const sessionRoot = join(home, ".pi", "agent");
    await mkdir(sessionRoot, { recursive: true });
    await writeFile(join(sessionRoot, "session.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd })}\n${JSON.stringify({ type: "message", id: "message-1", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: "lifecycle smoke", timestamp: Date.now() } })}\n`);
    await expect(resources.searchSessions("lifecycle smoke", cwd)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId }),
    ]));
    await expect(resources.forkSession(sessionId, cwd)).resolves.toEqual(expect.any(String));
  });

  it("forks a Pi session from an entry without changing the source branch", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-session-fork-at-seq-"));
    const cwd = await mkdtemp(join(tmpdir(), "openbuddy-session-fork-at-seq-cwd-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();
    const sessionId = "01a04373-374a-796c-bdbb-ecd1d67056f0";
    const sessionRoot = join(home, ".pi", "agent");
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "message", id: "message-1", parentId: null, timestamp, message: { role: "user", content: "first", timestamp: Date.now() } },
      { type: "message", id: "message-2", parentId: "message-1", timestamp, message: { role: "assistant", content: "second", timestamp: Date.now() } },
      { type: "message", id: "message-3", parentId: "message-2", timestamp, message: { role: "user", content: "third", timestamp: Date.now() } },
    ];
    await mkdir(sessionRoot, { recursive: true });
    await writeFile(join(sessionRoot, "session-at-seq.jsonl"), [
      { type: "session", version: 3, id: sessionId, timestamp, cwd },
      ...entries,
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");

    const childId = await resources.forkSession(sessionId, cwd, 1);
    const sessions = await SessionManager.listAll(sessionRoot);
    const child = sessions.find((session) => session.id === childId);
    const source = sessions.find((session) => session.id === sessionId);
    expect(child).toBeDefined();
    expect(source).toBeDefined();
    expect(SessionManager.open(child!.path, sessionRoot).getEntries().map((entry) => entry.id)).toEqual(["message-1", "message-2"]);
    expect(SessionManager.open(source!.path, sessionRoot).getEntries().map((entry) => entry.id)).toEqual(["message-1", "message-2", "message-3"]);
    await expect(resources.forkSession(sessionId, cwd, -1)).rejects.toMatchObject({ code: "bad-request" });
    await expect(resources.forkSession(sessionId, cwd, 99)).rejects.toMatchObject({ code: "lookup-not-found" });
  });

  it("rewindPoints surfaces prompt/assistant previews and tool-call metadata via SessionManager", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-rewind-points-"));
    const cwd = await mkdtemp(join(tmpdir(), "openbuddy-rewind-points-cwd-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();
    const sessionId = "01a04373-374a-796c-bdbb-rewind0001";
    const sessionRoot = join(home, ".pi", "agent");
    const timestamp = new Date().toISOString();
    const sessionPath = join(sessionRoot, "session-rewind.jsonl");
    await mkdir(sessionRoot, { recursive: true });
    const entries = [
      { type: "session", version: 3, id: sessionId, timestamp, cwd },
      { type: "message", id: "u1", parentId: null, timestamp, message: { role: "user", content: "explain pi SDK branch summary API", timestamp: Date.now() } },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Use SessionManager.branchWithSummary — see docs." },
            { type: "toolUse", name: "read", id: "tc-1" },
          ],
          timestamp: Date.now(),
        },
      },
      { type: "message", id: "u2", parentId: "a1", timestamp, message: { role: "user", content: "what about generateBranchSummary?", timestamp: Date.now() } },
      {
        type: "message",
        id: "a2",
        parentId: "u2",
        timestamp,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "It needs an LLM; we punt to a follow-up." },
            { type: "toolUse", name: "write", id: "tc-2" },
            { type: "toolUse", name: "memory", id: "tc-3" },
          ],
          timestamp: Date.now(),
        },
      },
    ];
    await writeFile(sessionPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");

    const points = await resources.rewindPoints(sessionPath);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      promptIndex: 0,
      promptPreview: "explain pi SDK branch summary API",
      hasFileChanges: false,
      hasMemoryChanges: false,
      toolNames: ["read"],
      messagePreview: "Use SessionManager.branchWithSummary — see docs.",
      timestamp,
    });
    expect(points[1]).toMatchObject({
      promptIndex: 1,
      promptPreview: "what about generateBranchSummary?",
      hasFileChanges: true,
      hasMemoryChanges: true,
      toolNames: ["write", "memory"],
      messagePreview: "It needs an LLM; we punt to a follow-up.",
    });
  });

  it("rewindPoints truncates long previews and overflows tool names with +N", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-rewind-overflow-"));
    const cwd = await mkdtemp(join(tmpdir(), "openbuddy-rewind-overflow-cwd-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();
    const sessionId = "01a04373-374a-796c-bdbb-rewind0002";
    const sessionRoot = join(home, ".pi", "agent");
    const timestamp = new Date().toISOString();
    const sessionPath = join(sessionRoot, "session-rewind-overflow.jsonl");
    await mkdir(sessionRoot, { recursive: true });
    const longPrompt = "x".repeat(400);
    const longAssistant = "y".repeat(400);
    const entries = [
      { type: "session", version: 3, id: sessionId, timestamp, cwd },
      { type: "message", id: "u1", parentId: null, timestamp, message: { role: "user", content: longPrompt, timestamp: Date.now() } },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: longAssistant },
            { type: "toolUse", name: "read", id: "tc-1" },
            { type: "toolUse", name: "edit", id: "tc-2" },
            { type: "toolUse", name: "write", id: "tc-3" },
            { type: "toolUse", name: "delete", id: "tc-4" },
            { type: "toolUse", name: "memory", id: "tc-5" },
          ],
          timestamp: Date.now(),
        },
      },
    ];
    await writeFile(sessionPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");

    const [point] = await resources.rewindPoints(sessionPath);
    expect(point?.promptPreview?.length).toBe(160);
    expect(point?.messagePreview?.endsWith("…")).toBe(true);
    expect(point?.messagePreview?.length).toBe(201);
    expect(point?.toolNames).toEqual(["read", "edit", "write", "+2"]);
    expect(point?.hasFileChanges).toBe(true);
    expect(point?.hasMemoryChanges).toBe(true);
  });
});
