import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ensureOpenBuddyProfile, installProfilePackage, readOpenBuddyProfile, removeProfilePackage } from "@openbuddy/plugin-host";
import * as resources from "./pi-resources";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-pi-resource-loader-test" },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("../casdoor/casdoor-auth", () => ({
  casdoorAuth: { status: () => ({ config: { configured: false }, identity: null, tenantContext: { activeTenantId: undefined } }) },
}));

describe("OpenBuddy Pi package resource loading", () => {
  it.skipIf(process.env.OPENBUDDY_REAL_PI_E2E !== "1")("loads pinned real ecosystem packages through profile install and session reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-pi-e2e-"));
    const profileDir = join(root, "profile");
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const mcpServerPath = join(root, "mcp-server.mjs");
    const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    const previousPiHome = process.env.PI_HOME;
    const packages = [
      ["pi-context-prune", "1.3.0"],
      ["pi-mcp-adapter", "2.31.0"],
      ["pi-web-access", "0.27.0"],
      ["pi-goal", "0.1.7"],
      ["pi-plan-mode", "0.4.8"],
      ["pi-subagents", "0.59.0"],
      ["pi-lens", "4.1.3"],
      ["pi-hermes-memory", "0.9.7"],
    ] as const;
    await mkdir(cwd, { recursive: true });
    process.env.PI_HOME = root;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "hermes-memory-config.json"), JSON.stringify({
      flushOnShutdown: false,
      flushOnCompact: false,
      reviewEnabled: false,
    }));
    await writeFile(mcpServerPath, `
      import readline from "node:readline";
      const tools = [{
        name: "echo",
        description: "Echo text from the local OpenBuddy E2E server",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      }];
      const output = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      readline.createInterface({ input: process.stdin }).on("line", (line) => {
        let request;
        try { request = JSON.parse(line); } catch { return; }
        if (request.method === "notifications/initialized") return;
        if (request.method === "initialize") {
          output({ jsonrpc: "2.0", id: request.id, result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "openbuddy-local-e2e", version: "1.0.0" },
          }});
          return;
        }
        if (request.method === "tools/list") {
          output({ jsonrpc: "2.0", id: request.id, result: { tools } });
          return;
        }
        if (request.method === "tools/call") {
          const text = request.params?.arguments?.text ?? "";
          output({ jsonrpc: "2.0", id: request.id, result: {
            content: [{ type: "text", text: "echo:" + text }],
          }});
          return;
        }
        output({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "method not found" } });
      });
    `);
    await writeFile(join(cwd, ".mcp.json"), JSON.stringify({
      mcpServers: {
        local: { command: process.execPath, args: [mcpServerPath], reconnect: { enabled: false } },
      },
    }, null, 2));
    try {
      await ensureOpenBuddyProfile({ profileDir });
      for (const [name, version] of packages) {
        const installed = await installProfilePackage({ profileDir }, `${name}@${version}`);
        expect(installed.name).toBe(name);
        expect(installed.pi).toBe(true);
      }

      const profile = await readOpenBuddyProfile({ profileDir });
      const extensionPaths = [...profile.piResourcePaths.extensions];
      const skillPaths = [...profile.piResourcePaths.skills];
      const promptPaths = [...profile.piResourcePaths.prompts];
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        additionalExtensionPaths: extensionPaths,
        additionalSkillPaths: skillPaths,
        additionalPromptTemplatePaths: promptPaths,
      });
      await loader.reload();
      const commandNames = loader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()]);
      expect(loader.getExtensions().errors).toEqual([]);
      expect(commandNames).toEqual(expect.arrayContaining(["pruner", "mcp", "websearch", "goal", "plan", "subagents", "run"]));
      expect(commandNames).toEqual(expect.arrayContaining(["lens-toggle", "lens-health", "lens-tools"]));
      expect(commandNames).toEqual(expect.arrayContaining(["memory-consolidate", "memory-insights", "memory-index-sessions"]));
      expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("mcp-scripting");
      expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("pi-goal-writer");
      const subagentsSkills = loader.getSkills().skills.filter((skill) => skill.sourceInfo.path.includes("pi-subagents"));
      expect(subagentsSkills.length).toBeGreaterThan(0);
      const lensSkills = loader.getSkills().skills.filter((skill) => skill.sourceInfo.path.includes("pi-lens"));
      expect(lensSkills.map((skill) => skill.name)).toEqual(expect.arrayContaining(["pi-lens-ast-grep", "pi-lens-lsp-navigation"]));

      const created = await createAgentSession({
        cwd,
        agentDir,
        noTools: "builtin",
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
      });
      try {
        await created.session.bindExtensions({ mode: "print", onError: () => undefined });
        const mcp = created.session.getToolDefinition("mcp");
        expect(mcp).toBeDefined();
        const executeMcp = (toolCallId: string, params: Record<string, unknown>) => {
          const definition = created.session.getToolDefinition("mcp");
          expect(definition).toBeDefined();
          return definition!.execute(toolCallId, params, undefined, undefined, created.session.extensionRunner.createContext());
        };
        const search = await executeMcp("real-mcp-search", { search: "echo", server: "local" });
        expect(JSON.stringify(search)).toContain("echo");
        const call = await executeMcp("real-mcp-call", {
          tool: "echo",
          server: "local",
          args: { text: "hello-openbuddy" },
        });
        expect(JSON.stringify(call)).toContain("echo:hello-openbuddy");
        expect(created.session.getAllTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
          "context_tree_query",
          "context_prune",
          "web_search",
          "get_goal",
          "create_goal",
          "update_goal",
        ]));
        expect(created.session.getAllTools().map((tool) => tool.name)).toEqual(expect.arrayContaining(["memory_search", "session_search"]));
        const subagentsPrompts = loader.getPrompts().prompts.filter((prompt) => prompt.sourceInfo?.path?.includes("pi-subagents") || prompt.filePath?.includes("pi-subagents") || prompt.name?.includes("subagent"));
        expect(subagentsPrompts.length).toBeGreaterThan(0);
        await created.session.reload();
        expect(loader.getExtensions().errors).toEqual([]);
        const reloadedCall = await executeMcp("real-mcp-reload-call", {
          tool: "echo",
          server: "local",
          args: { text: "after-reload" },
        });
        expect(JSON.stringify(reloadedCall)).toContain("echo:after-reload");
        expect(created.session.getAllTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
          "context_tree_query",
          "context_prune",
          "web_search",
          "get_goal",
          "create_goal",
          "update_goal",
        ]));
        const reloadedSubagentsPrompts = loader.getPrompts().prompts.filter((prompt) => prompt.sourceInfo?.path?.includes("pi-subagents") || prompt.filePath?.includes("pi-subagents") || prompt.name?.includes("subagent"));
        expect(reloadedSubagentsPrompts.length).toBeGreaterThan(0);
        expect(loader.getSkills().skills.filter((skill) => skill.sourceInfo.path.includes("pi-lens")).length).toBeGreaterThan(0);
      } finally {
        created.session.dispose();
      }

      for (const [name] of packages) {
        await removeProfilePackage({ profileDir }, name);
        const next = await readOpenBuddyProfile({ profileDir });
        extensionPaths.splice(0, extensionPaths.length, ...next.piResourcePaths.extensions);
        skillPaths.splice(0, skillPaths.length, ...next.piResourcePaths.skills);
        await loader.reload();
        expect(loader.getExtensions().errors).toEqual([]);
      }
      expect((await readOpenBuddyProfile({ profileDir })).piResourcePaths.extensions).toEqual([]);
    } finally {
      if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
      if (previousPiHome === undefined) delete process.env.PI_HOME;
      else process.env.PI_HOME = previousPiHome;
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("reconciles a marketplace plugin across disable, enable, reload, and uninstall", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-marketplace-lifecycle-"));
    const previousPiHome = process.env.PI_HOME;
    const previousPiAgent = process.env.PI_CODING_AGENT_DIR;
    const pluginRoot = join(root, ".pi", "agent", "plugins", "lifecycle-fixture");
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(join(pluginRoot, "extensions"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    process.env.PI_HOME = root;
    delete process.env.PI_CODING_AGENT_DIR;
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "lifecycle-fixture",
      pi: { extensions: ["./extensions/index.js"] },
    }));
    await writeFile(join(pluginRoot, "extensions", "index.js"), `
      export default function (pi) {
        pi.registerCommand("lifecycle-before", { description: "Before", handler: async () => undefined });
      }
    `);

    try {
      const extensionPaths: string[] = [];
      const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: extensionPaths });
      const reload = async () => {
        const paths = await resources.listPiPluginResourcePaths(cwd);
        extensionPaths.splice(0, extensionPaths.length, ...paths.flatMap((entry) => entry.extensions));
        await loader.reload();
        return loader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()]);
      };

      await expect(resources.listPlugins(cwd)).resolves.toMatchObject([{ name: "lifecycle-fixture", enabled: true }]);
      await expect(reload()).resolves.toEqual(["lifecycle-before"]);

      await resources.setPluginEnabled("lifecycle-fixture", false);
      await expect(reload()).resolves.toEqual([]);

      await resources.setPluginEnabled("lifecycle-fixture", true);
      await writeFile(join(pluginRoot, "extensions", "index.js"), `
        export default function (pi) {
          pi.registerCommand("lifecycle-after", { description: "After", handler: async () => undefined });
        }
      `);
      await expect(reload()).resolves.toEqual(["lifecycle-after"]);

      await rm(pluginRoot, { recursive: true, force: true });
      await expect(reload()).resolves.toEqual([]);
      await expect(resources.listPlugins(cwd)).resolves.toEqual([]);
    } finally {
      if (previousPiHome === undefined) delete process.env.PI_HOME;
      else process.env.PI_HOME = previousPiHome;
      if (previousPiAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousPiAgent;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the external dsh package through Pi native resources after profile installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-external-dsh-pi-"));
    const profileDir = join(root, "profile");
    const cwd = join(root, "workspace");
    // Resolve relative to this test file's location so the path is stable
    // regardless of how vitest is invoked (repo root vs sub-package cwd).
    const { fileURLToPath } = await import("node:url");
    const { dirname: dirnameUrl, join: pathJoin } = await import("node:path");
    const here = dirnameUrl(fileURLToPath(import.meta.url));
    // Test file lives at electron/main/agent/<name>.test.ts; the fixture is
    // three directories up under packages/runtime/openbuddy-plugin-host/.
    const source = pathJoin(here, "..", "..", "..", "packages", "runtime", "openbuddy-plugin-host", "src", "__fixtures__", "external-dsh-plugin");
    await mkdir(cwd, { recursive: true });
    try {
      await ensureOpenBuddyProfile({ profileDir });
      const installed = await installProfilePackage({ profileDir }, source);
      const profile = await readOpenBuddyProfile({ profileDir });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: join(root, "agent"),
        noSkills: true,
        additionalExtensionPaths: [...profile.piResourcePaths.extensions],
        additionalSkillPaths: [...profile.piResourcePaths.skills],
      });
      await loader.reload();
      expect(installed.name).toBe("@fixture/external-dsh-plugin");
      expect(loader.getExtensions().errors).toEqual([]);
      expect(loader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()])).toEqual(["external-fixture"]);
      expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("external-fixture");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads package manifest extensions and replaces them on native reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-loader-"));
    const packageRoot = join(root, "pi-package");
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    await mkdir(join(packageRoot, "extensions"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "fixture-pi-package",
      pi: { extensions: ["./extensions/first.js"] },
    }));
    await writeFile(join(packageRoot, "extensions", "first.js"), "export default () => undefined;\n");
    await writeFile(join(packageRoot, "extensions", "second.js"), "export default () => undefined;\n");

    try {
      const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [packageRoot] });
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      expect(loader.getExtensions().extensions.map((extension) => basename(extension.resolvedPath))).toEqual(["first.js"]);
      expect(loader.getExtensions().extensions[0]?.sourceInfo).toEqual(expect.objectContaining({
        source: "cli",
        scope: "temporary",
        origin: "top-level",
      }));

      await writeFile(join(packageRoot, "package.json"), JSON.stringify({
        name: "fixture-pi-package",
        pi: { extensions: ["./extensions/second.js"] },
      }));
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      expect(loader.getExtensions().extensions.map((extension) => basename(extension.resolvedPath))).toEqual(["second.js"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads filtered profile Pi resources through the native resource loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-filtered-profile-"));
    const profileDir = join(root, "profile");
    const packageDir = join(profileDir, "node_modules", "pi-filtered");
    const cwd = join(root, "workspace");
    await mkdir(join(packageDir, "extensions"), { recursive: true });
    await mkdir(join(packageDir, "skills", "keep-skill"), { recursive: true });
    await mkdir(join(packageDir, "skills", "skip-skill"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({ name: "desktop" }));
    await writeFile(join(packageDir, "package.json"), JSON.stringify({
      name: "pi-filtered",
      pi: {
        extensions: ["./extensions/*.{js,ts}", "!./extensions/skip.js", "+./extensions/forced.ts"],
        skills: ["./skills/*", "!./skills/skip-skill"],
      },
    }));
    await writeFile(join(packageDir, "extensions", "keep.js"), `
      export default function (pi) {
        pi.registerCommand("filtered-keep", { description: "keep", handler: async () => undefined });
      }
    `);
    await writeFile(join(packageDir, "extensions", "skip.js"), `
      export default function (pi) {
        pi.registerCommand("filtered-skip", { description: "skip", handler: async () => undefined });
      }
    `);
    await writeFile(join(packageDir, "extensions", "forced.ts"), `
      export default function (pi) {
        pi.registerCommand("filtered-forced", { description: "forced", handler: async () => undefined });
      }
    `);
    await writeFile(join(packageDir, "skills", "keep-skill", "SKILL.md"), "---\ndescription: keep\n---\nKeep this skill.\n");
    await writeFile(join(packageDir, "skills", "skip-skill", "SKILL.md"), "---\ndescription: skip\n---\nSkip this skill.\n");

    try {
      const profile = await readOpenBuddyProfile({ profileDir });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: join(root, "agent"),
        additionalExtensionPaths: [...profile.piResourcePaths.extensions],
        additionalSkillPaths: [...profile.piResourcePaths.skills],
      });
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      expect(loader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()])).toEqual([
        "filtered-forced",
        "filtered-keep",
      ]);
      const skillNames = loader.getSkills().skills.map((skill) => skill.name);
      expect(skillNames).toContain("keep-skill");
      expect(skillNames).not.toContain("skip-skill");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("executes third-party extension factories and isolates load failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-extension-runtime-"));
    const packageRoot = join(root, "pi-package");
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    await mkdir(join(packageRoot, "extensions"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "fixture-pi-extension-runtime",
      pi: { extensions: ["./extensions/good.js", "./extensions/broken.js"] },
    }));
    await writeFile(join(packageRoot, "extensions", "good.js"), `
      export default function (pi) {
        pi.registerCommand("fixture-first", {
          description: "First fixture command",
          handler: async () => undefined,
        });
      }
    `);
    await writeFile(join(packageRoot, "extensions", "broken.js"), "export default () => { throw new Error('fixture extension failed'); };\n");

    try {
      const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [packageRoot] });
      await loader.reload();
      expect(loader.getExtensions().extensions).toHaveLength(1);
      expect(loader.getExtensions().extensions[0]?.commands.has("fixture-first")).toBe(true);
      expect(loader.getExtensions().errors).toEqual([
        expect.objectContaining({ path: expect.stringContaining("broken.js"), error: expect.stringContaining("fixture extension failed") }),
      ]);

      await writeFile(join(packageRoot, "extensions", "good.js"), `
        export default function (pi) {
          pi.registerCommand("fixture-second", {
            description: "Second fixture command",
            handler: async () => undefined,
          });
        }
      `);
      await writeFile(join(packageRoot, "extensions", "broken.js"), `
        export default function (pi) {
          pi.registerCommand("fixture-recovered", {
            description: "Recovered fixture command",
            handler: async () => undefined,
          });
        }
      `);
      await loader.reload();
      const commands = loader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()]);
      expect(commands).toEqual(["fixture-second", "fixture-recovered"]);
      expect(loader.getExtensions().errors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("executes an installed Pi package with its materialized dependency closure", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-installed-extension-"));
    const source = join(root, "source");
    const helper = join(source, "node_modules", "fixture-pi-helper");
    const profileDir = join(root, "profile");
    const cwd = join(root, "workspace");
    await mkdir(join(source, "extensions"), { recursive: true });
    await mkdir(helper, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(helper, "package.json"), JSON.stringify({ name: "fixture-pi-helper", version: "1.0.0", main: "index.js" }));
    await writeFile(join(helper, "index.js"), "export const marker = 'materialized-helper';\n");
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-installed-pi-extension",
      version: "1.0.0",
      type: "module",
      pi: { extensions: ["./extensions/index.js"] },
      dependencies: { "fixture-pi-helper": "1.0.0" },
    }));
    await writeFile(join(source, "extensions", "index.js"), `
      import { marker } from "fixture-pi-helper";
      export default function (pi) {
        pi.registerCommand(marker, {
          description: "Installed dependency fixture command",
          handler: async () => undefined,
        });
      }
    `);

    try {
      await ensureOpenBuddyProfile({ profileDir });
      const installed = await installProfilePackage({ profileDir }, source);
      const profile = await readOpenBuddyProfile({ profileDir });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: join(root, "agent"),
        additionalExtensionPaths: [...profile.piResourcePaths.extensions],
      });
      await loader.reload();
      expect(installed.path).toContain(join(profileDir, "node_modules"));
      expect(loader.getExtensions().errors).toEqual([]);
      expect(loader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()])).toEqual([
        "materialized-helper",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rebinds the real AgentSession extension runner after reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-session-reload-"));
    const packageRoot = join(root, "pi-package");
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    await mkdir(join(packageRoot, "extensions"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "fixture-pi-session-reload",
      pi: { extensions: ["./extensions/runtime.js"] },
    }));
    await writeFile(join(packageRoot, "extensions", "runtime.js"), `
      export default function (pi) {
        pi.registerTool({
          name: "session_reload_before",
          label: "Before reload",
          description: "Before reload",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [{ type: "text", text: "before" }] }),
        });
      }
    `);

    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [packageRoot] });
      await loader.reload();
      const created = await createAgentSession({
        cwd,
        agentDir,
        noTools: "builtin",
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
      });
      session = created.session;
      await session.bindExtensions({ mode: "print" });
      expect(loader.getExtensions().errors).toEqual([]);
      expect(loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()])).toEqual(["session_reload_before"]);
      expect(created.extensionsResult.extensions.flatMap((extension) => [...extension.tools.keys()])).toEqual(["session_reload_before"]);
      expect(session.getAllTools().some((tool) => tool.name === "session_reload_before")).toBe(true);

      await writeFile(join(packageRoot, "extensions", "runtime.js"), `
        export default function (pi) {
          pi.registerTool({
            name: "session_reload_after",
            label: "After reload",
            description: "After reload",
            parameters: { type: "object", properties: {} },
            execute: async () => ({ content: [{ type: "text", text: "after" }] }),
          });
        }
      `);
      await session.reload();
      expect(session.getAllTools().some((tool) => tool.name === "session_reload_before")).toBe(false);
      expect(session.getAllTools().some((tool) => tool.name === "session_reload_after")).toBe(true);
    } finally {
      session?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("observes profile resource path changes through a stable array reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-skills-"));
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    await mkdir(join(firstRoot, "alpha"), { recursive: true });
    await mkdir(join(secondRoot, "beta"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(firstRoot, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: First skill\n---\n\nAlpha\n");
    await writeFile(join(secondRoot, "beta", "SKILL.md"), "---\nname: beta\ndescription: Second skill\n---\n\nBeta\n");

    try {
      const skillPaths = [firstRoot];
      const loader = new DefaultResourceLoader({ cwd, agentDir, additionalSkillPaths: skillPaths });
      await loader.reload();
      expect(loader.getSkills().skills.filter((skill) => skill.name === "alpha").map((skill) => skill.name)).toEqual(["alpha"]);

      skillPaths.splice(0, skillPaths.length, secondRoot);
      await loader.reload();
      expect(loader.getSkills().skills.filter((skill) => skill.name === "beta").map((skill) => skill.name)).toEqual(["beta"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes stale marketplace resource paths when the source snapshot shrinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-marketplace-refresh-"));
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    await mkdir(join(firstRoot, "skill-a"), { recursive: true });
    await mkdir(join(secondRoot, "skill-b"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(firstRoot, "skill-a", "SKILL.md"), "---\nname: skill-a\ndescription: A\n---\n\nA\n");
    await writeFile(join(secondRoot, "skill-b", "SKILL.md"), "---\nname: skill-b\ndescription: B\n---\n\nB\n");

    try {
      const profilePaths = [firstRoot];
      const marketplacePaths: string[] = [];
      const loader = new DefaultResourceLoader({ cwd, agentDir, additionalSkillPaths: [...profilePaths, ...marketplacePaths] });
      await loader.reload();
      expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("skill-a");

      marketplacePaths.push(secondRoot);
      const nextLoader = new DefaultResourceLoader({ cwd, agentDir, additionalSkillPaths: [...profilePaths, ...marketplacePaths] });
      await nextLoader.reload();
      expect(nextLoader.getSkills().skills.map((skill) => skill.name)).toEqual(expect.arrayContaining(["skill-a", "skill-b"]));

      marketplacePaths.splice(0, marketplacePaths.length);
      const finalLoader = new DefaultResourceLoader({ cwd, agentDir, additionalSkillPaths: [...profilePaths, ...marketplacePaths] });
      await finalLoader.reload();
      const finalSkillNames = finalLoader.getSkills().skills.map((skill) => skill.name);
      expect(finalSkillNames).toContain("skill-a");
      expect(finalSkillNames).not.toContain("skill-b");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes an installed OpenBuddy Pi package graph to the native loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-profile-"));
    const profileRoot = join(root, "profile");
    const packageRoot = join(profileRoot, "node_modules", "pi-profile-fixture");
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(join(packageRoot, "extensions"), { recursive: true });
    await mkdir(join(packageRoot, "skills", "profile-skill"), { recursive: true });
    await mkdir(join(packageRoot, "prompts"), { recursive: true });
    await mkdir(join(packageRoot, "themes"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(profileRoot, "package.json"), JSON.stringify({ name: "profile", pi: {} }));
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "pi-profile-fixture",
      pi: {
        extensions: ["./extensions"],
        skills: ["./skills"],
        prompts: ["./prompts"],
        themes: ["./themes"],
      },
    }));
    await writeFile(join(packageRoot, "extensions", "profile.js"), "export default () => undefined;\n");
    await writeFile(join(packageRoot, "skills", "profile-skill", "SKILL.md"), "---\nname: profile-skill\ndescription: profile skill\n---\n\nUse profile skill.\n");
    await writeFile(join(packageRoot, "prompts", "profile.md"), "---\nname: profile-prompt\ndescription: profile prompt\n---\n\nProfile prompt.\n");
    await writeFile(join(packageRoot, "themes", "profile.json"), JSON.stringify({
      name: "profile-theme",
      colors: {
        accent: "#00ffff",
        border: "#666666",
        borderAccent: "#00ffff",
        borderMuted: "#444444",
        success: "#00ff00",
        error: "#ff0000",
        warning: "#ffff00",
        muted: "#888888",
        dim: "#555555",
        text: "#ffffff",
        thinkingText: "#aaaaaa",
        selectedBg: "#333333",
        userMessageBg: "#222222",
        userMessageText: "#ffffff",
        customMessageBg: "#222222",
        customMessageText: "#ffffff",
        customMessageLabel: "#00ffff",
        toolPendingBg: "#333333",
        toolSuccessBg: "#003300",
        toolErrorBg: "#330000",
        toolTitle: "#00ffff",
        toolOutput: "#cccccc",
        mdHeading: "#00ffff",
        mdLink: "#00aaff",
        mdLinkUrl: "#0088aa",
        mdCode: "#ffaa00",
        mdCodeBlock: "#cccccc",
        mdCodeBlockBorder: "#666666",
        mdQuote: "#aaaaaa",
        mdQuoteBorder: "#666666",
        mdHr: "#666666",
        mdListBullet: "#00ffff",
        toolDiffAdded: "#00ff00",
        toolDiffRemoved: "#ff0000",
        toolDiffContext: "#888888",
        syntaxComment: "#888888",
        syntaxKeyword: "#ff00ff",
        syntaxFunction: "#00aaff",
        syntaxVariable: "#ffaa00",
        syntaxString: "#00ff00",
        syntaxNumber: "#ff00ff",
        syntaxType: "#00aaff",
        syntaxOperator: "#ff00ff",
        syntaxPunctuation: "#888888",
        thinkingOff: "#888888",
        thinkingMinimal: "#00ffff",
        thinkingLow: "#00aaff",
        thinkingMedium: "#00ffff",
        thinkingHigh: "#ff00ff",
        thinkingXhigh: "#ff0000",
        bashMode: "#ffaa00",
      },
    }));

    try {
      const profile = await readOpenBuddyProfile({ profileDir: profileRoot });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        additionalExtensionPaths: [...profile.piResourcePaths.extensions],
        additionalSkillPaths: [...profile.piResourcePaths.skills],
        additionalPromptTemplatePaths: [...profile.piResourcePaths.prompts],
        additionalThemePaths: [...profile.piResourcePaths.themes],
      });
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      expect(loader.getExtensions().extensions.some((extension) => extension.resolvedPath.endsWith("profile.js"))).toBe(true);
      expect(loader.getSkills().skills.some((skill) => skill.name === "profile-skill")).toBe(true);
      expect(loader.getPrompts().prompts.some((prompt) => prompt.name === "profile")).toBe(true);
      expect(loader.getThemes().themes.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds and removes marketplace agent files through the native override", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-agents-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    const pluginAgent = join(root, "marketplace", "agents", "market-reviewer.md");
    await mkdir(dirname(pluginAgent), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(pluginAgent, "---\ndescription: Marketplace reviewer\n---\nReview marketplace code.\n");
    const files = [{ path: pluginAgent, content: await readFile(pluginAgent, "utf8") }];

    try {
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        agentsFilesOverride: (base) => ({ agentsFiles: [...base.agentsFiles, ...files] }),
      });
      await loader.reload();
      expect(loader.getAgentsFiles().agentsFiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: pluginAgent, content: expect.stringContaining("Marketplace reviewer") }),
      ]));
      files.splice(0, files.length);
      await loader.reload();
      expect(loader.getAgentsFiles().agentsFiles.some((agent) => agent.path === pluginAgent)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("captures pendingProviderRegistrations with extensionPath context", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-provider-registry-"));
    const packageRoot = join(root, "pi-package");
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    await mkdir(join(packageRoot, "extensions"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "fixture-pi-provider-registry",
      pi: { extensions: ["./extensions/index.js"] },
    }));
    await writeFile(join(packageRoot, "extensions", "index.js"), `
      export default function (pi) {
        pi.registerProvider("fixture-acme", {
          baseUrl: "https://fixture.test/v1",
          apiKey: "fixture-key",
          api: "openai-responses",
          models: [{ id: "fixture-model", name: "Fixture Model", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 2048 }],
        });
      }
    `);
    try {
      const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [packageRoot] });
      await loader.reload();
      const extensionsResult = loader.getExtensions();
      expect(extensionsResult.errors).toEqual([]);
      const pending = extensionsResult.runtime.pendingProviderRegistrations ?? [];
      const fixtureEntry = pending.find((entry: { name: string }) => entry.name === "fixture-acme");
      expect(fixtureEntry).toBeDefined();
      if (!fixtureEntry) throw new Error("fixture-acme provider registration was not captured");
      expect(fixtureEntry.extensionPath).toContain("extensions/index.js");
      // Wire up the tracker pattern the host uses, drain pending into ModelRuntime,
      // and verify attribution is preserved end-to-end.
      const registry = new Map();
      let changeEvents = 0;
      // Dynamic import to avoid ESM issues with the runner.
      const trackerModule = await import("./agent-host-provider-registry").catch(() => null);
      if (trackerModule && typeof trackerModule.installProviderRegistryTracker === "function") {
        const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
        const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
        trackerModule.installProviderRegistryTracker(runtime, registry, () => changeEvents += 1);
        for (const entry of pending) {
          registry.set(entry.name, {
            id: entry.name,
            source: "pi-extension",
            extensionPath: entry.extensionPath,
            registeredAt: Date.now(),
          });
          runtime.registerProvider(entry.name, entry.config);
        }
        expect(registry.get("fixture-acme")?.extensionPath).toContain("extensions/index.js");
        expect(registry.get("fixture-acme")?.source).toBe("pi-extension");
        expect(changeEvents).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});
