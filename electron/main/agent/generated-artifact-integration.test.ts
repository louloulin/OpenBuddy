import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { _electron as electron } from "playwright";
import { Context } from "@openbuddy/cordis";
import {
  composeRendererPluginBootGraph,
  discoverRendererPluginEntries,
  discoverRemoteManifestEntries,
  discoverTypertManifestEntries,
  ensureOpenBuddyProfile,
  HarnessPluginLoader,
  DeepSeekCordisRuntime,
  composePluginPatches,
  manifestToBundle,
  readBundleManifest,
  installProfilePackage,
  listProfilePackages,
  removeProfilePackage,
  serializeRemoteContribution,
  validateTypertHostContribution,
} from "@openbuddy/plugin-host";
import {
  ClientModuleSystem,
  createRendererContext,
  createDeepSeekClientCompatibilityModules,
  type ClientBundleRegistration,
  type ClientModuleRegistrationTarget,
} from "@openbuddy/renderer-host";
import { DeepSeekTypertService } from "../deepseek/deepseek-runtime";
import { RemoteDispatcher } from "../harness/remote-dispatch";
import { createProfileArtifactResolvers, toModuleUrl } from "./profile-artifact-resolution";
import { createDeepSeekExecutionAdapter, createDeepSeekExecutionServices, DEEPSEEK_EXECUTION_PACKAGES } from "../deepseek/deepseek-execution-adapters";

const packageName = "@fixture/generated";
const zodRoot = realpathSync(join(process.cwd(), "node_modules/.pnpm/zod@4.4.3/node_modules/zod"));

function artifactSource(): { host: string; remote: string } {
  const shared = `
import { z } from "zod";
const Request = z.object({ value: z.string() });
const codec = { mode: "strict", typeSymbol: "${packageName}#Request", schema: Request };
const invocation = {
  id: "${packageName}#fixture/ping",
  service: "fixture",
  namespace: "fixture",
  method: "ping",
  invocation: { kind: "direct" },
  parameters: [{ name: "request", wire: "request", source: "json", codec }],
  result: codec,
};
`;
  return {
    host: `${shared}
export const TYPERT = {
  package: "${packageName}",
  face: "host",
  schemas: [{ name: "Request", schema: Request }],
  invocations: [invocation],
  model: { services: [], events: [], objects: [] },
};
export default TYPERT;
`,
    remote: `${shared}
export const TYPERT_REMOTE = { package: "${packageName}", descriptors: [invocation] };
export default TYPERT_REMOTE;
`,
  };
}

describe("generated DeepSeek Harness artifact integration", () => {
  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("loads the published core Harness service graph and survives profile replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-core-e2e-"));
    const profileDir = join(root, "profile");
    const packageSpecs = ["@deepseek-ai/dsh-base@0.1.1-rc.2"];
    const corePackages = [
      "@deepseek-ai/dsh-typert-registry",
      "@deepseek-ai/dsh-system-prompt",
      "@deepseek-ai/dsh-llm",
      "@deepseek-ai/dsh-session",
      "@deepseek-ai/dsh-agent",
      "@deepseek-ai/dsh-tools",
      "@deepseek-ai/dsh-subagent",
      "@deepseek-ai/dsh-web",
    ];
    const entries = [
      { id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
      { id: "systemPrompt", name: "@deepseek-ai/dsh-system-prompt" },
      { id: "llm", name: "@deepseek-ai/dsh-llm" },
      { id: "session", name: "@deepseek-ai/dsh-session" },
      { id: "agent", name: "@deepseek-ai/dsh-agent" },
      { id: "tools", name: "@deepseek-ai/dsh-tools" },
      { id: "subagent", name: "@deepseek-ai/dsh-subagent" },
      { id: "web", name: "@deepseek-ai/dsh-web" },
    ];
    try {
      await ensureOpenBuddyProfile({ profileDir });
      for (const spec of packageSpecs) await installProfilePackage({ profileDir }, spec);
      const profilePackage = await listProfilePackages({ profileDir });
      const packageJsonByName = new Map(profilePackage.map((entry) => [entry.name, join(entry.path, "package.json")]));
      const resolvers = createProfileArtifactResolvers({
        packageJsonByName,
        profilePackageJson: join(profileDir, "package.json"),
      });
      for (const name of corePackages) {
        packageJsonByName.set(name, await resolvers.resolvePackageJson(name));
      }
      const cordisPackageJson = await resolvers.resolvePackageJson("@deepseek-ai/cordis");
      const cordisModule = await import(/* @vite-ignore */ pathToFileURL(
        await resolvers.resolveModule("@deepseek-ai/cordis", cordisPackageJson),
      ).href);
      const runtime = new DeepSeekCordisRuntime({
        cordisModule,
        importer: async (specifier) => {
          const packageJson = packageJsonByName.get(specifier) ?? await resolvers.resolvePackageJson(specifier);
          packageJsonByName.set(specifier, packageJson);
          return import(/* @vite-ignore */ pathToFileURL(await resolvers.resolveModule(specifier, packageJson)).href);
        },
        allowInvocation: (service, method) => service === "sessions" && method === "list",
      });
      await runtime.load(entries);
      expect(runtime.getSnapshot()).toMatchObject({
        plugins: entries.map((entry) => ({ id: entry.id, state: "active" })),
        services: expect.arrayContaining(["llm", "sessions", "agents", "tools", "subagents", "web"]),
        disposed: false,
      });
      await expect(runtime.invoke({ service: "sessions", method: "list" })).resolves.toEqual([]);

      await runtime.replace(entries.filter((entry) => entry.id !== "web"));
      expect(runtime.getSnapshot().services).not.toContain("web");
      await runtime.replace(entries);
      expect(runtime.getSnapshot().services).toContain("web");
      await runtime.dispose();
      expect(runtime.getSnapshot()).toMatchObject({ services: [], disposed: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("restores a published profile and Pi session across Electron Main restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-electron-resume-e2e-"));
    const userData = join(root, "user-data");
    const piAgentDir = join(root, "pi-agent");
    const profileDir = join(root, "profile");
    const electronPath = process.env.OPENBUDDY_ELECTRON_PATH ?? join(process.cwd(), "node_modules", ".bin", "electron");
    let firstApp: Awaited<ReturnType<typeof electron.launch>> | undefined;
    let secondApp: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await ensureOpenBuddyProfile({ profileDir });
      await installProfilePackage({ profileDir }, "@deepseek-ai/dsh-base@0.1.1-rc.2");
      const launch = () => electron.launch({
        args: [`--user-data-dir=${userData}`, process.cwd()],
        executablePath: electronPath,
        cwd: process.cwd(),
        timeout: 30_000,
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: "",
          ELECTRON_SKIP_AUTO_BUILD: "1",
          PI_CODING_AGENT_DIR: piAgentDir,
          OPENBUDDY_PROFILE_DIR: profileDir,
          OPENBUDDY_DEBUG_UI: "0",
        },
      });
      const inspect = async (app: Awaited<ReturnType<typeof electron.launch>>) => {
        const page = await app.firstWindow();
        await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
        await page.locator("#root").waitFor({ state: "attached", timeout: 20_000 });
        return { page, state: await page.evaluate(async (cwd) => {
          const init = await globalThis.window.api.invoke("agent:init", cwd);
          const created = await globalThis.window.api.invoke("agent:new-session", { cwd });
          const sessions = await globalThis.window.api.invoke("sessions:list", cwd);
          const plugins = await globalThis.window.api.invoke("agent:plugin-snapshot");
          const cordis = await globalThis.window.api.invoke("agent:deepseek-cordis-snapshot");
          const listed = await globalThis.window.api.invoke("agent:deepseek-cordis-invoke", { service: "sessions", method: "list" }).catch((error) => ({ error: String(error) }));
          return { init, created, sessions, plugins, cordis, listed };
        }, root) };
      };

      firstApp = await launch();
      const first = await inspect(firstApp);
      const firstSessionId = first.state.created?.sessionId;
      expect(first.state.init?.ok).toBe(true);
      expect(typeof firstSessionId).toBe("string");
      expect(first.state.cordis?.disposed).toBe(false);
      expect(first.state.plugins).toBeDefined();
      expect(first.state.listed).not.toMatchObject({ error: expect.anything() });
      await firstApp.close();
      firstApp = undefined;

      secondApp = await launch();
      const secondWindow = await secondApp.firstWindow();
      await secondWindow.waitForLoadState("domcontentloaded", { timeout: 20_000 });
      await secondWindow.locator("#root").waitFor({ state: "attached", timeout: 20_000 });
      const second = await secondWindow.evaluate(async ({ cwd, sessionId }) => {
        const init = await window.api.invoke("agent:init", cwd);
        const sessions = await window.api.invoke<Array<{ id?: string; sessionId?: string }>>("sessions:list", cwd);
        const plugins = await window.api.invoke("agent:plugin-snapshot");
        const cordis = await window.api.invoke("agent:deepseek-cordis-snapshot");
        const listed = await window.api.invoke("agent:deepseek-cordis-invoke", { service: "sessions", method: "list" }).catch((error) => ({ error: String(error) }));
        const restored = sessions.some((entry) => entry.id === sessionId || entry.sessionId === sessionId);
        return { init, sessions, plugins, cordis, listed, restored };
      }, { cwd: root, sessionId: firstSessionId });
      expect(second.init?.ok).toBe(true);
      expect(second.restored).toBe(true);
      expect(second.cordis?.disposed).toBe(false);
      expect(second.plugins).toBeDefined();
      expect(second.listed).not.toMatchObject({ error: expect.anything() });
    } finally {
      await secondApp?.close().catch(() => undefined);
      await firstApp?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("loads the published dsh-base patch in isolated Cordis", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-base-e2e-"));
    const profileDir = join(root, "profile");
    try {
      await ensureOpenBuddyProfile({ profileDir });
      await installProfilePackage({ profileDir }, "@deepseek-ai/dsh-base@0.1.1-rc.2");
      const installed = await listProfilePackages({ profileDir });
      const packageJsonByName = new Map(installed.map((entry) => [entry.name, join(entry.path, "package.json")]));
      const resolvers = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: join(profileDir, "package.json") });
      const manifest = await readBundleManifest("@deepseek-ai/dsh-base", {
        importer: async (specifier) => resolvers.resolveModule(specifier, await resolvers.resolvePackageJson(specifier)),
      });
      const bundle = await manifestToBundle(manifest, {
        importer: async (specifier) => resolvers.resolveModule(specifier, await resolvers.resolvePackageJson(specifier)),
        scope: { dshHomePath: (subpath: string) => join(profileDir, subpath) },
      });
      const entries = composePluginPatches(bundle.entries, bundle.patches ?? []);
      const cordisPackageJson = await resolvers.resolvePackageJson("@deepseek-ai/cordis");
      const cordisModule = await import(/* @vite-ignore */ pathToFileURL(
        await resolvers.resolveModule("@deepseek-ai/cordis", cordisPackageJson),
      ).href);
      const runtime = new DeepSeekCordisRuntime({
        cordisModule,
        importer: async (specifier) => import(/* @vite-ignore */ pathToFileURL(
          await resolvers.resolveModule(specifier, await resolvers.resolvePackageJson(specifier)),
        ).href),
        allowInvocation: () => true,
      });
      await expect(runtime.load(entries)).resolves.toMatchObject({ disposed: false });
      expect(runtime.getSnapshot().plugins.filter((plugin) => plugin.state === "active").length).toBeGreaterThan(8);
      await runtime.dispose();
      expect(runtime.getSnapshot().services).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("recreates the published core runtime from the same durable profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-runtime-resume-e2e-"));
    const profileDir = join(root, "profile");
    const entries = [
      { id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
      { id: "systemPrompt", name: "@deepseek-ai/dsh-system-prompt" },
      { id: "llm", name: "@deepseek-ai/dsh-llm" },
      { id: "session", name: "@deepseek-ai/dsh-session" },
      { id: "agent", name: "@deepseek-ai/dsh-agent" },
      { id: "tools", name: "@deepseek-ai/dsh-tools" },
      { id: "subagent", name: "@deepseek-ai/dsh-subagent" },
      { id: "web", name: "@deepseek-ai/dsh-web" },
    ];
    let firstRuntime: DeepSeekCordisRuntime | undefined;
    let secondRuntime: DeepSeekCordisRuntime | undefined;
    try {
      await ensureOpenBuddyProfile({ profileDir });
      await installProfilePackage({ profileDir }, "@deepseek-ai/dsh-base@0.1.1-rc.2");
      const installed = await listProfilePackages({ profileDir });
      const packageJsonByName = new Map(installed.map((entry) => [entry.name, join(entry.path, "package.json")]));
      const resolvers = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: join(profileDir, "package.json") });
      const cordisPackageJson = await resolvers.resolvePackageJson("@deepseek-ai/cordis");
      const cordisModule = await import(/* @vite-ignore */ pathToFileURL(await resolvers.resolveModule("@deepseek-ai/cordis", cordisPackageJson)).href);
      const importer = async (specifier: string): Promise<unknown> => {
        const packageJson = packageJsonByName.get(specifier) ?? await resolvers.resolvePackageJson(specifier);
        packageJsonByName.set(specifier, packageJson);
        return import(/* @vite-ignore */ pathToFileURL(await resolvers.resolveModule(specifier, packageJson)).href);
      };
      const createRuntime = () => new DeepSeekCordisRuntime({
        cordisModule,
        importer,
        allowInvocation: (service, method) => service === "sessions" && method === "list",
      });

      firstRuntime = createRuntime();
      await firstRuntime.load(entries);
      await expect(firstRuntime.invoke({ service: "sessions", method: "list" })).resolves.toEqual([]);
      expect((await listProfilePackages({ profileDir })).some((entry) => entry.name === "@deepseek-ai/dsh-base")).toBe(true);
      await firstRuntime.dispose();
      firstRuntime = undefined;

      secondRuntime = createRuntime();
      await secondRuntime.load(entries);
      expect(secondRuntime.getSnapshot()).toMatchObject({ disposed: false, services: expect.arrayContaining(["sessions", "agents", "tools"]) });
      await expect(secondRuntime.invoke({ service: "sessions", method: "list" })).resolves.toEqual([]);
    } finally {
      await firstRuntime?.dispose();
      await secondRuntime?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("mounts published subprocess and sandbox packages through the OpenBuddy execution adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-execution-e2e-"));
    const profileDir = join(root, "profile");
    try {
      await ensureOpenBuddyProfile({ profileDir });
      const installed = await installProfilePackage({ profileDir }, "@deepseek-ai/dsh-base@0.1.1-rc.2");
      const executionPackages = [
        "@deepseek-ai/dsh-subprocess-local",
        "@deepseek-ai/dsh-sandbox-local",
        "@deepseek-ai/dsh-sandbox-policy",
      ];
      const packageJsonByName = new Map([[installed.name, join(installed.path, "package.json")] as const]);
      const resolvers = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: join(profileDir, "package.json") });
      for (const packageName of executionPackages) {
        expect(DEEPSEEK_EXECUTION_PACKAGES.has(packageName)).toBe(true);
        expect(await resolvers.resolveModule(packageName, await resolvers.resolvePackageJson(packageName))).toMatch(/(?:index|main)/u);
      }
      const context = new Context();
      const services = createDeepSeekExecutionServices({ cwd: root, mode: "workspace-write" });
      const loader = new HarnessPluginLoader({
        context,
        importer: async (specifier) => {
          const adapter = createDeepSeekExecutionAdapter(specifier, services);
          if (!adapter) throw new Error(`unexpected execution package ${specifier}`);
          return { default: adapter };
        },
      });
      await loader.load(executionPackages.map((name, index) => ({ id: ["subprocess", "sandbox", "sandbox-policy"][index]!, name })));
      const subprocess = context.get("subprocess") as { resolveExecutable: (command: string) => Promise<string>; spawnTerminal: (spec: unknown) => Promise<{ output: NodeJS.ReadableStream; write: (value: string) => Promise<void>; done: Promise<unknown>; terminate: () => Promise<void> }> };
      const sandboxPolicy = context.get("sandboxPolicy") as { resolve: (request?: unknown) => { mode: string; workspaceRoot: string } };
      const sandbox = context.get("sandbox") as { confine: (argv: readonly string[], policy?: unknown) => { argv: string[] } };
      await expect(subprocess.resolveExecutable("node")).resolves.toMatch(/node/u);
      expect(sandboxPolicy.resolve({ session: { sessionId: "real-execution", cwd: root } })).toMatchObject({ mode: "workspace-write", workspaceRoot: realpathSync(root) });
      if (process.platform === "darwin") {
        expect(sandbox.confine([process.execPath, "-e", "process.stdout.write('sandbox')"], { mode: "read-only", workspaceRoot: root }).argv[0]).toBe("/usr/bin/sandbox-exec");
      } else {
        expect(() => sandbox.confine([process.execPath, "-e", "process.stdout.write('sandbox')"], { mode: "read-only", workspaceRoot: root })).toThrow(/no enforcing provider/u);
      }
      const terminal = await subprocess.spawnTerminal({ argv: ["/bin/bash", "--noprofile", "--norc", "-i"], cwd: root, rows: 24, cols: 120, graceMs: 500 });
      const output: Buffer[] = [];
      terminal.output.on("data", (value: Buffer) => output.push(Buffer.from(value)));
      await terminal.write("printf published-execution-ok\nexit\n");
      await terminal.done;
      expect(Buffer.concat(output).toString()).toContain("published-execution-ok");
      await loader.dispose();
      expect(context.get("subprocess")).toBeDefined();
      expect(context.get("sandbox")).toBeDefined();
      expect(context.get("sandboxPolicy")).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("executes the published dsh-bash-sandbox through the shared Pi host services", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-bash-e2e-"));
    const profileDir = join(root, "profile");
    try {
      await ensureOpenBuddyProfile({ profileDir });
      const installed = await installProfilePackage({ profileDir }, "@deepseek-ai/dsh-base@0.1.1-rc.2");
      const packageJsonByName = new Map([[installed.name, join(installed.path, "package.json")] as const]);
      const resolvers = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: join(profileDir, "package.json") });
      const cordisPackageJson = await resolvers.resolvePackageJson("@deepseek-ai/cordis");
      const cordisModule = await import(/* @vite-ignore */ pathToFileURL(
        await resolvers.resolveModule("@deepseek-ai/cordis", cordisPackageJson),
      ).href);
      const services = createDeepSeekExecutionServices({ cwd: root, mode: "workspace-write" });
      let mountedContext: { get?: (name: string, strict?: boolean) => unknown } | undefined;
      const runtime = new DeepSeekCordisRuntime({
        cordisModule,
        importer: async (specifier) => {
          const adapter = createDeepSeekExecutionAdapter(specifier, services);
          if (adapter) return { default: adapter };
          const packageJson = packageJsonByName.get(specifier) ?? await resolvers.resolvePackageJson(specifier);
          packageJsonByName.set(specifier, packageJson);
          return import(/* @vite-ignore */ pathToFileURL(await resolvers.resolveModule(specifier, packageJson)).href);
        },
        onPluginActive: (context, entry) => {
          if (entry.id === "bash-sandbox") mountedContext = context as { get?: (name: string, strict?: boolean) => unknown };
          return undefined;
        },
        allowInvocation: () => true,
      });
      const entries = [
        { id: "subprocess", name: "@deepseek-ai/dsh-subprocess-local" },
        { id: "sandbox", name: "@deepseek-ai/dsh-sandbox-local" },
        { id: "sandbox-policy", name: "@deepseek-ai/dsh-sandbox-policy", config: { mode: "workspace-write", workspaceRoot: root } },
        { id: "bash-sandbox", name: "@deepseek-ai/dsh-bash-sandbox", config: { cwd: root, timeoutMs: 5_000, maxTimeoutMs: 10_000, graceMs: 300 } },
      ];
      const adapterEntries = entries.filter((entry) => DEEPSEEK_EXECUTION_PACKAGES.has(entry.name));
      const bashEntry = entries.find((entry) => entry.id === "bash-sandbox")!;
      await expect(runtime.load([...adapterEntries, bashEntry])).resolves.toMatchObject({ disposed: false });
      const context = mountedContext!;
      const shell = context.get?.("shell") as {
        resolve: (request: Record<string, unknown>) => { command: string; workdir: string; timeoutMs: number; stdoutMaxBytes: number; sandboxPolicy: unknown };
        run: (spec: unknown) => Promise<{ exitCode: number | null; stdout: { text: string }; stderr: { text: string }; sandbox?: { mode: string; denied?: boolean } }>;
        start: (spec: unknown) => { status: string; done: Promise<void>; readOutput: () => { delta: string }; kill: () => boolean };
      };
      expect(shell).toBeDefined();
      const writablePath = join(root, "workspace-write.txt");
      const writableResult = await shell.run(shell.resolve({
        command: `printf workspace-write-ok > ${JSON.stringify(writablePath)}`,
        workdir: root,
        sandboxPolicy: { mode: "workspace-write", workspaceRoot: root },
      }));
      expect(writableResult).toMatchObject({ exitCode: 0, sandbox: { mode: "workspace-write", denied: false } });
      await expect(readFile(writablePath, "utf8")).resolves.toBe("workspace-write-ok");
      const readOnlyPath = join(root, "read-only-denied.txt");
      try {
        const readOnlyResult = await shell.run(shell.resolve({
          command: `printf should-not-write > ${JSON.stringify(readOnlyPath)}`,
          workdir: root,
          sandboxPolicy: { mode: "read-only", workspaceRoot: root },
        }));
        expect(readOnlyResult).toMatchObject({ sandbox: { mode: "read-only", denied: true } });
      } catch (error) {
        expect(String(error)).toMatch(/no enforcing provider|sandbox unavailable/u);
      }
      expect(() => lstatSync(readOnlyPath)).toThrow();
      const processHandle = shell.start(shell.resolve({
        command: "sleep 60",
        workdir: root,
        sandboxPolicy: { mode: "workspace-write", workspaceRoot: root },
      }));
      await runtime.dispose();
      await processHandle.done;
      expect(processHandle.status).toBe("killed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("executes the published dsh-tool-bash and dsh-tool-jobs over the Pi-owned shell seam", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-tool-bash-e2e-"));
    const profileDir = join(root, "profile");
    try {
      await ensureOpenBuddyProfile({ profileDir });
      const installed = await installProfilePackage({ profileDir }, "@deepseek-ai/dsh-base@0.1.1-rc.2");
      const packageJsonByName = new Map([[installed.name, join(installed.path, "package.json")] as const]);
      const resolvers = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: join(profileDir, "package.json") });
      const cordisPackageJson = await resolvers.resolvePackageJson("@deepseek-ai/cordis");
      const cordisModule = await import(/* @vite-ignore */ pathToFileURL(
        await resolvers.resolveModule("@deepseek-ai/cordis", cordisPackageJson),
      ).href);
      const services = createDeepSeekExecutionServices({ cwd: root, mode: "workspace-write" });
      let mountedContext: { get?: (name: string, strict?: boolean) => unknown } | undefined;
      const runtime = new DeepSeekCordisRuntime({
        cordisModule,
        importer: async (specifier) => {
          const adapter = createDeepSeekExecutionAdapter(specifier, services);
          if (adapter) return { default: adapter };
          const packageJson = packageJsonByName.get(specifier) ?? await resolvers.resolvePackageJson(specifier);
          packageJsonByName.set(specifier, packageJson);
          return import(/* @vite-ignore */ pathToFileURL(await resolvers.resolveModule(specifier, packageJson)).href);
        },
        onPluginActive: (context, entry) => {
          if (entry.id === "tool-bash") mountedContext = context as { get?: (name: string, strict?: boolean) => unknown };
          return undefined;
        },
        allowInvocation: () => true,
      });
      await runtime.load([
        { id: "subprocess", name: "@deepseek-ai/dsh-subprocess-local" },
        { id: "sandbox", name: "@deepseek-ai/dsh-sandbox-local" },
        { id: "sandbox-policy", name: "@deepseek-ai/dsh-sandbox-policy", config: { mode: "workspace-write", workspaceRoot: root } },
        { id: "bash-sandbox", name: "@deepseek-ai/dsh-bash-sandbox", config: { cwd: root, timeoutMs: 5_000, maxTimeoutMs: 10_000, graceMs: 300 } },
        { id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
        { id: "tools", name: "@deepseek-ai/dsh-tools" },
        { id: "shell-env", name: "@deepseek-ai/dsh-shell-env", config: { dshHome: join(root, "dsh-home") } },
        { id: "jobs", name: "@deepseek-ai/dsh-jobs-local" },
        { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash" },
        { id: "tool-jobs", name: "@deepseek-ai/dsh-tool-jobs" },
      ]);
      const context = mountedContext!;
      const tools = context.get?.("tools") as {
        get: (name: string) => unknown;
        execute: (input: { callId: string; name: string; arguments: unknown; signal: AbortSignal }) => Promise<unknown>;
      };
      const jobs = context.get?.("jobs") as {
        get: (id: string) => { status: string };
        wait: (id: string, timeoutMs: number) => Promise<{ status: string }>;
      };
      expect(tools.get("bash")).toBeDefined();
      expect(tools.get("job_list")).toBeDefined();
      const foregroundPath = join(root, "published-tool-bash.txt");
      const foreground = await tools.execute({
        callId: "published-tool-bash-foreground",
        name: "bash",
        arguments: {
          command: `printf published-tool-bash-ok > ${JSON.stringify(foregroundPath)}`,
          description: "Write published bash output",
        },
        signal: new AbortController().signal,
      });
      expect(foreground).toMatchObject({ isError: false, value: { exitCode: 0 } });
      await expect(readFile(foregroundPath, "utf8")).resolves.toBe("published-tool-bash-ok");

      const background = await tools.execute({
        callId: "published-tool-bash-background",
        name: "bash",
        arguments: { command: "sleep 60", description: "Run a background bash job", run_in_background: true },
        signal: new AbortController().signal,
      });
      const backgroundJson = JSON.stringify(background);
      const jobId = /(?:jobId|job_id)[^A-Za-z0-9]+([A-Za-z0-9._-]+)/u.exec(backgroundJson)?.[1];
      expect(jobId).toBeTruthy();
      expect(jobs.get(jobId!).status).toBe("running");
      await tools.execute({
        callId: "published-tool-jobs-kill",
        name: "job_kill",
        arguments: { job_id: jobId },
        signal: new AbortController().signal,
      });
      await expect(jobs.wait(jobId!, 10_000)).resolves.toMatchObject({ status: expect.stringMatching(/^(stopping|killed|completed)$/u) });
      await runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("executes the published terminal, terminal-bash, and terminal-job packages with owner isolation", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-terminal-e2e-"));
    const profileDir = join(root, "profile");
    let runtime: DeepSeekCordisRuntime | undefined;
    try {
      await ensureOpenBuddyProfile({ profileDir });
      const packageSpecs = [
        "@deepseek-ai/dsh-base@0.1.1-rc.2",
        "@deepseek-ai/dsh-terminal@0.1.1-rc.2",
        "@deepseek-ai/dsh-terminal-bash@0.1.1-rc.2",
        "@deepseek-ai/dsh-tool-terminal@0.1.1-rc.2",
        "@deepseek-ai/dsh-jobs-local@0.1.1-rc.2",
        "@deepseek-ai/dsh-tool-jobs@0.1.1-rc.2",
      ];
      const installedPackages = [];
      for (const spec of packageSpecs) installedPackages.push(await installProfilePackage({ profileDir }, spec));
      const packageJsonByName = new Map(installedPackages.map((entry) => [entry.name, join(entry.path, "package.json")] as const));
      const resolvers = createProfileArtifactResolvers({ packageJsonByName, profilePackageJson: join(profileDir, "package.json") });
      const cordisPackageJson = await resolvers.resolvePackageJson("@deepseek-ai/cordis");
      const cordisModule = await import(/* @vite-ignore */ pathToFileURL(
        await resolvers.resolveModule("@deepseek-ai/cordis", cordisPackageJson),
      ).href);
      const services = createDeepSeekExecutionServices({ cwd: root, mode: "danger-full-access" });
      let mountedContext: {
        get: (name: string, strict?: boolean) => unknown;
        plugin: (plugin: unknown) => { ctx: unknown };
      } | undefined;
      const importPublished = async (specifier: string): Promise<unknown> => {
        const packageJson = packageJsonByName.get(specifier) ?? await resolvers.resolvePackageJson(specifier);
        packageJsonByName.set(specifier, packageJson);
        return import(/* @vite-ignore */ pathToFileURL(await resolvers.resolveModule(specifier, packageJson)).href);
      };
      runtime = new DeepSeekCordisRuntime({
        cordisModule,
        importer: async (specifier) => {
          const adapter = createDeepSeekExecutionAdapter(specifier, services);
          if (adapter) return { default: adapter };
          return importPublished(specifier);
        },
        onPluginActive: (context, entry) => {
          if (entry.id === "tool-terminal") mountedContext = context as typeof mountedContext;
          return undefined;
        },
        allowInvocation: () => true,
      });

      await runtime.load([
        { id: "agent", name: "@deepseek-ai/dsh-agent" },
        { id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
        { id: "tools", name: "@deepseek-ai/dsh-tools" },
        { id: "subprocess", name: "@deepseek-ai/dsh-subprocess-local" },
        { id: "sandbox", name: "@deepseek-ai/dsh-sandbox-local" },
        { id: "sandbox-policy", name: "@deepseek-ai/dsh-sandbox-policy", config: { mode: "danger-full-access", workspaceRoot: root } },
        { id: "terminal", name: "@deepseek-ai/dsh-terminal" },
        { id: "terminal-bash", name: "@deepseek-ai/dsh-terminal-bash", config: { cwd: root, idleSilenceMs: 250, timeoutMs: 5_000, disposeGraceMs: 500 } },
        { id: "jobs", name: "@deepseek-ai/dsh-jobs-local" },
        { id: "tool-jobs", name: "@deepseek-ai/dsh-tool-jobs" },
        { id: "tool-terminal", name: "@deepseek-ai/dsh-tool-terminal", config: { maxResultBytes: 4096 } },
      ]);

      const context = mountedContext!;
      const tools = context.get("tools") as {
        execute: (input: { signal: AbortSignal; callId: string; name: string; arguments: unknown; agent: unknown }) => Promise<any>;
        get: (name: string) => unknown;
      };
      const agents = context.get("agents") as { register: (agent: unknown) => unknown };
      const sessionModule = await importPublished("@deepseek-ai/dsh-session") as {
        Session: { create: (id: string) => unknown };
        SessionId: (id: string) => string;
      };
      const agentModule = await importPublished("@deepseek-ai/dsh-agent") as {
        Inbox: new (session: unknown, callbacks: Record<string, () => void>) => unknown;
      };
      const createOwner = (id: string) => {
        const sessionId = sessionModule.SessionId(id);
        const session = sessionModule.Session.create(sessionId);
        const scope = context.plugin(() => {});
        const agent = {
          id: sessionId,
          options: {},
          session,
          inbox: new agentModule.Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
          status: "idle",
          ctx: scope.ctx,
          send: () => {},
          followup: () => {},
          steer: () => {},
          inject: () => {},
          cancel: () => {},
          runMaintenance: (job: (signal: AbortSignal) => unknown) => job(new AbortController().signal),
          whenIdle: () => Promise.resolve(),
        };
        agents.register(agent);
        return agent;
      };
      const owner = createOwner("published-terminal-owner");
      const foreign = createOwner("published-terminal-foreign");
      const call = (callId: string, name: string, args: unknown, agent: unknown) => tools.execute({
        signal: new AbortController().signal,
        callId,
        name,
        arguments: args,
        agent,
      });

      expect(tools.get("terminal_open")).toBeDefined();
      expect(tools.get("terminal_send")).toBeDefined();
      expect(tools.get("job_output")).toBeDefined();
      const opened = await call("published-terminal-open", "terminal_open", { type: "shell", name: "main", cwd: root }, owner);
      expect(opened.isError).toBe(false);
      const sessionId = (opened.value as { sessionId: string }).sessionId;
      expect(sessionId).toMatch(/^pty-/u);

      const state = await call("published-terminal-state", "terminal_send", { sessionId, text: "export PUBLISHED_KEEP=1; cd /", submit: true }, owner);
      expect(state.isError).toBe(false);
      const read = await call("published-terminal-read", "terminal_send", { sessionId, text: "printf 'cwd=%s keep=%s' \"$PWD\" \"$PUBLISHED_KEEP\"", submit: true }, owner);
      expect(JSON.stringify(read)).toContain("cwd=/ keep=1");
      const foreignRead = await call("published-terminal-foreign-read", "terminal_read", { sessionId }, foreign);
      expect(foreignRead.isError).toBe(true);

      const background = await call("published-terminal-background", "terminal_send", { sessionId, text: "printf published-terminal-job-ok", submit: true, run_in_background: true }, owner);
      expect(background.isError).toBe(false);
      const jobId = (background.value as { jobId: string }).jobId;
      expect(jobId).toBeTruthy();
      let output: any;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        output = await call(`published-terminal-job-output-${attempt}`, "job_output", { job_id: jobId }, owner);
        if (JSON.stringify(output).includes("published-terminal-job-ok")) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(JSON.stringify(output)).toContain("published-terminal-job-ok");
      const listed = await call("published-terminal-list", "terminal_list", {}, owner);
      expect(JSON.stringify(listed)).toContain(sessionId);
      const closed = await call("published-terminal-close", "terminal_close", { sessionId }, owner);
      expect(closed.isError).toBe(false);
    } finally {
      await runtime?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("loads and disposes the published DeepSeek GoalService through Cordis", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-service-e2e-"));
    const profileDir = join(root, "profile");
    try {
      await ensureOpenBuddyProfile({ profileDir });
      const installed = await installProfilePackage({ profileDir }, "@deepseek-ai/dsh-goal@0.1.1-rc.2");
      const packageJson = join(installed.path, "package.json");
      const resolvers = createProfileArtifactResolvers({
        packageJsonByName: new Map([[installed.name, packageJson]]),
        profilePackageJson: join(profileDir, "package.json"),
      });
      const context = new Context();
      const session = { entries: [], getEntries: () => [] };
      const agent = { id: "agent-real-goal", session };
      context.provide("agents", {
        get: (id: string) => id === agent.id ? agent : undefined,
        list: () => [agent],
      });
      context.provide("sessionProjections", {
        register: () => () => undefined,
      });
      const loader = new HarnessPluginLoader({
        context,
        importer: async (specifier) => {
          if (specifier === installed.name) {
            return import(/* @vite-ignore */ pathToFileURL(await resolvers.resolveModule(specifier, packageJson)).href);
          }
          throw new Error(`unexpected real service dependency ${specifier}`);
        },
      });
      await loader.load([{ id: "real-goal", name: installed.name }]);
      expect(loader.resolve("real-goal").status.state).toBe("loaded");
      expect(context.get("goals")).toBeDefined();
      await loader.dispose();
      expect(loader.resolve("real-goal").status.state).toBe("unloaded");
      expect(context.get("goals")).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("rolls back a failed published GoalService replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-rollback-e2e-"));
    const profileDir = join(root, "profile");
    try {
      await ensureOpenBuddyProfile({ profileDir });
      const installed = await installProfilePackage({ profileDir }, "@deepseek-ai/dsh-goal@0.1.1-rc.2");
      const packageJson = join(installed.path, "package.json");
      const resolvers = createProfileArtifactResolvers({
        packageJsonByName: new Map([[installed.name, packageJson]]),
        profilePackageJson: join(profileDir, "package.json"),
      });
      const context = new Context();
      const agent = { id: "agent-real-goal-rollback", session: { entries: [], getEntries: () => [] } };
      context.provide("agents", { get: (id: string) => id === agent.id ? agent : undefined, list: () => [agent] });
      context.provide("sessionProjections", { register: () => () => undefined });
      let imports = 0;
      const loader = new HarnessPluginLoader({
        context,
        importer: async (specifier) => {
          if (specifier !== installed.name) throw new Error(`unexpected real rollback dependency ${specifier}`);
          imports += 1;
          if (imports === 2) throw new Error("simulated published GoalService replacement failure");
          return import(/* @vite-ignore */ pathToFileURL(await resolvers.resolveModule(specifier, packageJson)).href);
        },
      });
      const original = [{ id: "real-goal", name: installed.name, config: { defaultMaxGoalRounds: 256 } }];
      await loader.load(original);
      expect(loader.resolve("real-goal").status.state).toBe("loaded");
      await expect(loader.replaceProfile({ entries: [{ ...original[0]!, config: { defaultMaxGoalRounds: 128 } }] }))
        .rejects.toThrow("simulated published GoalService replacement failure");
      expect(imports).toBe(3);
      expect(loader.resolve("real-goal").status.state).toBe("loaded");
      expect(loader.resolve("real-goal").entry.config).toEqual({ defaultMaxGoalRounds: 256 });
      expect(context.get("goals")).toBeDefined();
      await loader.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it.skipIf(process.env.OPENBUDDY_REAL_HARNESS_E2E !== "1")("loads published DeepSeek goal host, remote, and client faces", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-real-harness-e2e-"));
    const profileDir = join(root, "profile");
    const profileOptions = { profileDir };
    const packageSpecs = [
      "@deepseek-ai/dsh-goal@0.1.1-rc.2",
      "@deepseek-ai/dsh-client-ui-goal@0.1.1-rc.2",
    ];
    try {
      await ensureOpenBuddyProfile(profileOptions);
      for (const spec of packageSpecs) await installProfilePackage(profileOptions, spec);

      const installed = await listProfilePackages(profileOptions);
      const packageJsonByName = new Map(installed.map((entry) => [entry.name, join(entry.path, "package.json")]));
      const resolvers = createProfileArtifactResolvers({
        packageJsonByName,
        profilePackageJson: join(profileDir, "package.json"),
      });
      const resolveModule = async (specifier: string, packageJson: string) => toModuleUrl(await resolvers.resolveModule(specifier, packageJson));
      const additionalPackages = installed.map((entry) => entry.name);

      const [rendererEntries, remoteEntries, typertEntries] = await Promise.all([
        discoverRendererPluginEntries([], {
          additionalPackages,
          resolvePackageJson: resolvers.resolvePackageJson,
          resolveModule,
        }),
        discoverRemoteManifestEntries({ additionalPackages, resolvePackageJson: resolvers.resolvePackageJson, resolveModule }),
        discoverTypertManifestEntries({ additionalPackages, resolvePackageJson: resolvers.resolvePackageJson, resolveModule }),
      ]);
      const goalClient = rendererEntries.find((entry) => entry.id === "@deepseek-ai/dsh-client-ui-goal");
      expect(goalClient).toMatchObject({
        name: "@deepseek-ai/dsh-client-ui-goal/client",
        moduleUrl: expect.stringContaining("dsh-client-ui-goal"),
      });
      expect(remoteEntries.some((entry) => entry.packageName === "@deepseek-ai/dsh-goal")).toBe(true);
      expect(typertEntries.some((entry) => entry.packageName === "@deepseek-ai/dsh-goal")).toBe(true);
      const bootGraph = composeRendererPluginBootGraph(rendererEntries);
      expect(bootGraph.entries.some((entry) => entry.id === "@deepseek-ai/dsh-client-ui-goal")).toBe(true);

      const remoteModule = await import(/* @vite-ignore */ remoteEntries.find((entry) => entry.packageName === "@deepseek-ai/dsh-goal")!.moduleUrl!);
      const typertModule = await import(/* @vite-ignore */ typertEntries.find((entry) => entry.packageName === "@deepseek-ai/dsh-goal")!.moduleUrl!);
      const remote = serializeRemoteContribution(remoteModule.TYPERT_REMOTE ?? remoteModule.default) as { package: string; descriptors: unknown[] };
      const typert = validateTypertHostContribution("@deepseek-ai/dsh-goal", typertModule.TYPERT ?? typertModule.default);
      expect(remote.package).toBe("@deepseek-ai/dsh-goal");
      expect(remote.descriptors.length).toBeGreaterThan(0);
      expect(typert.invocations.length).toBe(remote.descriptors.length);

      const compatibilityModules = createDeepSeekClientCompatibilityModules({
        createElement: React.createElement,
      });
      delete compatibilityModules["@deepseek-ai/dsh-client-ui-goal/client"];
      delete compatibilityModules["@deepseek-ai/dsh-client-ui-goal"];
      const previousLoader = (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__;
      const registrationTarget: ClientModuleRegistrationTarget = {
        mode: "queue",
        pendingQueue: [],
        load(registration: ClientBundleRegistration) {
          this.pendingQueue.push(registration);
        },
      };
      (globalThis as { __ModuleLoader__?: ClientModuleRegistrationTarget }).__ModuleLoader__ = registrationTarget;
      (window as unknown as { __ModuleLoader__?: ClientModuleRegistrationTarget }).__ModuleLoader__ = registrationTarget;
      try {
        const clientSystem = new ClientModuleSystem({
          entries: rendererEntries,
          staticModules: {
            ...compatibilityModules,
            react: React,
            "react/jsx-runtime": await import("react/jsx-runtime"),
          },
          registrationTarget,
          loadBundle: async (_entry, url) => {
            const source = await readFile(fileURLToPath(url), "utf8");
            new Function("window", "globalThis", "document", "console", source)(window, globalThis, document, console);
          },
        });
        const client = await clientSystem.import(goalClient!.id);
        expect(client).toBeDefined();
        expect(clientSystem.list().some((entry) => entry.id === goalClient!.id)).toBe(true);
      } finally {
        if (previousLoader === undefined) delete (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__;
        else (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = previousLoader;
        delete (window as unknown as { __ModuleLoader__?: unknown }).__ModuleLoader__;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("installs, imports, registers, mounts, reloads, and removes real generated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-generated-artifact-"));
    try {
      const source = join(root, "source");
      const profileDir = join(root, "profile");
      const sourceLib = join(source, "lib");
      await mkdir(sourceLib, { recursive: true });
      await mkdir(join(source, "node_modules"), { recursive: true });
      await mkdir(join(source, "node_modules/undeclared-fixture"), { recursive: true });
      await writeFile(join(source, "node_modules/undeclared-fixture", "package.json"), JSON.stringify({ name: "undeclared-fixture", version: "1.0.0" }));
      await writeFile(join(source, "package.json"), JSON.stringify({
        name: packageName,
        version: "1.0.0",
        type: "module",
        dependencies: { zod: "4.4.3" },
        exports: {
          "./typert": "./lib/typert.host.mjs",
          "./remote": "./lib/typert.remote-client.mjs",
        },
      }));
      await symlink(zodRoot, join(source, "node_modules/zod"), "dir");
      const sourceArtifacts = artifactSource();
      await writeFile(join(sourceLib, "typert.host.mjs"), sourceArtifacts.host);
      await writeFile(join(sourceLib, "typert.remote-client.mjs"), sourceArtifacts.remote);

      await ensureOpenBuddyProfile({ profileDir });
      const installed = await installProfilePackage({ profileDir }, source);
      expect(installed).toMatchObject({ name: packageName, remote: true, typert: true });
      expect((await listProfilePackages({ profileDir })).map((item) => item.name)).toContain(packageName);
      expect(lstatSync(join(installed.path, "node_modules/zod")).isSymbolicLink()).toBe(false);
      expect(() => lstatSync(join(installed.path, "node_modules/undeclared-fixture"))).toThrow();

      const installedPackageJson = join(profileDir, "node_modules/@fixture/generated/package.json");
      const resolvers = createProfileArtifactResolvers({
        packageJsonByName: new Map([[packageName, installedPackageJson]]),
        profilePackageJson: join(profileDir, "package.json"),
      });
      const resolveModule = async (specifier: string, packageJson: string) => toModuleUrl(await resolvers.resolveModule(specifier, packageJson));
      const [remoteEntries, typertEntries] = await Promise.all([
        discoverRemoteManifestEntries({ additionalPackages: [packageName], resolvePackageJson: resolvers.resolvePackageJson, resolveModule }),
        discoverTypertManifestEntries({ additionalPackages: [packageName], resolvePackageJson: resolvers.resolvePackageJson, resolveModule }),
      ]);
      expect(remoteEntries).toHaveLength(1);
      expect(typertEntries).toHaveLength(1);

      const remoteModule = await import(/* @vite-ignore */ remoteEntries[0]!.moduleUrl!);
      const typertModule = await import(/* @vite-ignore */ typertEntries[0]!.moduleUrl!);
      const remoteContribution = serializeRemoteContribution(remoteModule.TYPERT_REMOTE ?? remoteModule.default) as {
        package: string;
        descriptors: Array<Record<string, unknown>>;
      };
      const typertContribution = validateTypertHostContribution(packageName, typertModule.TYPERT ?? typertModule.default);
      expect(remoteContribution.package).toBe(packageName);
      expect(typertContribution.invocations).toHaveLength(1);
      expect((remoteContribution.descriptors[0]!.parameters as Array<Record<string, unknown>>)[0]!.codec).toMatchObject({ mode: "strict" });

      const reloadedRemote = sourceArtifacts.remote.replace("fixture/ping", "fixture/pong").replace('method: "ping"', 'method: "pong"');
      await writeFile(join(profileDir, "node_modules/@fixture/generated/lib/typert.remote-client.mjs"), reloadedRemote);
      const reloadedPath = join(profileDir, "node_modules/@fixture/generated/lib/typert.remote-client.reload.mjs");
      await writeFile(reloadedPath, reloadedRemote);
      const reloadedUrl = pathToFileURL(reloadedPath).href;
      const reloadedModule = await import(/* @vite-ignore */ reloadedUrl);
      expect((reloadedModule.TYPERT_REMOTE ?? reloadedModule.default).descriptors[0].namespace).toBe("fixture");
      expect((reloadedModule.TYPERT_REMOTE ?? reloadedModule.default).descriptors[0].method).toBe("pong");

      const mainContext = new Context();
      const typert = new DeepSeekTypertService(mainContext);
      const dispatcher = new RemoteDispatcher();
      const service = { ping: (request: { value: string }) => ({ value: request.value.toUpperCase() }) };
      const serviceContext = {
        get: (key: string) => key === "fixture" ? service : key === "typert" ? typert : undefined,
      };
      const registration = dispatcher.register(remoteContribution, serviceContext);
      const typertDispose = typert.register(typertContribution);
      await expect(dispatcher.invoke({ package: packageName, namespace: "fixture", method: "ping", args: { request: { value: "pi" } } }, serviceContext))
        .resolves.toEqual({ value: "PI" });
      expect(typert.local.get("fixture/ping")).toBeDefined();

      const rendererContext = createRendererContext(new Context(), {
        apiVersion: 1,
        invoke: async () => ({ ok: true, value: { value: "renderer" } }),
      });
      const clientModules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
      const connection = clientModules["@deepseek-ai/dsh-client-connection/client"] as { apply: (context: Context) => unknown };
      connection.apply(rendererContext);
      const remotes = clientModules["@deepseek-ai/dsh-api-remotes/client"] as { apply: (context: Context) => unknown };
      remotes.apply(rendererContext);
      await rendererContext.start();
      const rendererRemote = rendererContext.get("remote") as {
        $mountLocal: (contribution: unknown) => () => Promise<void>;
        fixture?: { ping?: (request: { value: string }) => Promise<unknown> };
      };
      const rendererDispose = rendererRemote.$mountLocal(remoteContribution);
      await expect(rendererRemote.fixture?.ping?.({ value: "renderer" })).resolves.toMatchObject({ ok: true });

      await rendererDispose();
      await typertDispose();
      registration && dispatcher.unregister(packageName);
      expect(dispatcher.list()).not.toContain("fixture/ping");
      expect(typert.local.get("fixture/ping")).toBeUndefined();
      await mainContext.lifecycle.stop();
      await rendererContext.lifecycle.stop();
      await removeProfilePackage({ profileDir }, packageName);
      expect((await listProfilePackages({ profileDir })).some((item) => item.name === packageName)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
