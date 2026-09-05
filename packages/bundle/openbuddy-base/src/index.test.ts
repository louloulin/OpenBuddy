import { describe, expect, it } from "vitest";
import { Context } from "@openbuddy/cordis";
import { HarnessPluginLoader } from "@openbuddy/plugin-host";
import { RendererPluginLoader, createRendererContext } from "@openbuddy/renderer-host";
import {
  createOpenBuddyCoreProfile,
  createOpenBuddyProfile,
  createOpenBuddyRendererProfile,
  openBuddyBaseEntries,
  openBuddyCapabilityEntries,
  openBuddyCapabilityPluginIndex,
  openBuddyCapabilityPlugins,
} from "./index";

describe("openbuddy-bundle-base", () => {
  it("exposes the legacy single-entry profile for backward compatibility", () => {
    expect(openBuddyBaseEntries).toEqual([{ id: "openbuddy-core", name: "openbuddy:core" }]);
    expect(createOpenBuddyCoreProfile().entries).toEqual(openBuddyBaseEntries);
  });

  it("lists every capability as its own profile entry", () => {
    expect(openBuddyCapabilityEntries.length).toBe(openBuddyCapabilityPlugins.length);
    const ids = new Set(openBuddyCapabilityEntries.map((entry) => entry.id));
    for (const expected of [
      "openbuddy-session",
      "openbuddy-authorization",
      "openbuddy-mcp-client",
      "openbuddy-email",
      "openbuddy-permission",
      "openbuddy-calendar",
      "openbuddy-fs-local",
      "openbuddy-team",
      "openbuddy-collaboration",
    ]) {
      expect(ids.has(expected)).toBe(true);
    }
  });

  it("indexes every plugin by id for the loader's importer", () => {
    expect(openBuddyCapabilityPluginIndex.size).toBe(openBuddyCapabilityPlugins.length);
    for (const plugin of openBuddyCapabilityPlugins) {
      const looked = openBuddyCapabilityPluginIndex.get(plugin.id);
      expect(looked).toBe(plugin);
    }
  });

  it("createOpenBuddyProfile defaults to the per-capability entries", () => {
    const profile = createOpenBuddyProfile();
    expect(profile.entries).toEqual(openBuddyCapabilityEntries);
  });

  it("loads the per-capability profile end-to-end through HarnessPluginLoader", async () => {
    const context = new Context();
      context.provide("agentHost", { ready: true });
      context.provide("collaborationRuntimeBridge", { mount: () => () => undefined, getRuntime: () => ({ snapshot: () => ({}), proposeTask: () => ({}), networkSnapshot: () => ({}) }) });
    context.provide("authorization", {
      registerFlow: () => () => undefined,
      begin: async () => ({ status: "authorized" as const }),
      cancel: () => false,
    });
    const registeredTools: string[] = [];
    context.provide("pi", {
      tools: {
        registerTool: (tool: { name: string }) => {
          registeredTools.push(tool.name);
          return () => {
            const index = registeredTools.indexOf(tool.name);
            if (index >= 0) registeredTools.splice(index, 1);
          };
        },
      },
    });
    context.provide("mcpResources", {
      getCwd: () => "/workspace",
      readConfig: async () => ({ mcpServers: {} }),
      readCredential: async () => undefined,
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => {
        const plugin = openBuddyCapabilityPluginIndex.get(specifier);
        if (!plugin) throw new Error(`test-importer: unknown specifier ${specifier}`);
        return plugin;
      },
      baseUrl: import.meta.url,
      logger: () => undefined,
    });
    await loader.loadProfile(createOpenBuddyProfile());
    const loaded = loader.list().filter((entry) => entry.state === "loaded");
    expect(loaded.length).toBe(openBuddyCapabilityPlugins.length);
    for (const status of loaded) {
      expect(status.error).toBeUndefined();
    }
    // Stage C-4: openbuddy-memory removed (memory_list/memory_get/memory_save
    // gone — memory is owned by `pi-memory` / `@jackice/pi-memory-rust`
    // via passthrough). Stage G-1c: openbuddy-automation removed
    // (automation_* tools gone — owned by pi-goal-list-loop-audit).
    expect(registeredTools).toEqual(expect.arrayContaining([
      "calendar_list",
      "calendar_create",
      "team_create",
      "team_status",
      "team_delete",
      "buddy_collaboration_snapshot",
      "buddy_collaboration_manifest",
      "buddy_task_propose",
      "buddy_network_snapshot",
      "buddy_side_effect_intent",
      "buddy_collaboration_propose",
    ]));
  });

  it("loads collaboration as an independent plugin and removes its Pi tools on dispose", async () => {
    const context = new Context();
    context.provide("agentHost", { ready: true });
    const registered = new Map<string, () => void>();
    context.provide("collaborationRuntimeBridge", {
      mount: () => () => undefined,
      getRuntime: () => ({ snapshot: () => ({ mode: "local-first" }), proposeTask: () => ({ status: "proposed" }), networkSnapshot: () => ({ mode: "local-sandbox", deliveries: [] }), proposeCollaboration: () => ({ status: "proposed" }) }),
    });
    context.provide("pi", { tools: { registerTool: (tool: { name: string }) => { const dispose = () => registered.delete(tool.name); registered.set(tool.name, dispose); return dispose; } } });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => openBuddyCapabilityPluginIndex.get(specifier) ?? null,
      baseUrl: import.meta.url,
      logger: () => undefined,
    });
    await loader.loadProfile({ entries: [{ id: "openbuddy-collaboration", name: "openbuddy-collaboration", inject: ["agentHost", "collaborationRuntimeBridge"] }] });
		expect([...registered.keys()]).toEqual(["buddy_collaboration_manifest", "buddy_collaboration_snapshot", "buddy_task_propose", "buddy_network_snapshot", "buddy_side_effect_intent", "buddy_collaboration_propose", "buddy_workflow_propose", "buddy_network_propose", "buddy_network_negotiate", "buddy_network_offer"]);
    await loader.dispose();
    expect(registered.size).toBe(0);
  });

  it("respects disabled patches so a capability can be opted out", async () => {
    const context = new Context();
    context.provide("agentHost", { ready: true });
    context.provide("collaborationRuntimeBridge", { mount: () => () => undefined, getRuntime: () => ({ snapshot: () => ({}), proposeTask: () => ({}), networkSnapshot: () => ({}) }) });
    context.provide("authorization", {
      registerFlow: () => () => undefined,
      begin: async () => ({ status: "authorized" as const }),
      cancel: () => false,
    });
    context.provide("pi", { tools: { registerTool: () => () => undefined } });
    context.provide("mcpResources", {
      getCwd: () => "/workspace",
      readConfig: async () => ({ mcpServers: {} }),
      readCredential: async () => undefined,
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => openBuddyCapabilityPluginIndex.get(specifier) ?? null,
      baseUrl: import.meta.url,
      logger: () => undefined,
    });
    const profile = createOpenBuddyProfile(undefined, [[{ id: "openbuddy-email", disabled: true }]]);
    await loader.loadProfile(profile);
    const email = loader.list().find((entry) => entry.id === "openbuddy-email");
    expect(email?.state).toBe("disabled");
    expect(loader.list().filter((entry) => entry.state === "loaded").length).toBe(openBuddyCapabilityPlugins.length - 1);
  });
});

it("exposes the same bundle with a renderer-side profile", async () => {
  const context = createRendererContext(new Context());
  const loader = new RendererPluginLoader(context, async (specifier) => {
    const rendererPlugins = await import("./renderer-plugins");
    const assistantPlugins = await import("./renderer-assistant-contributions");
    const crossKindPlugins = await import("./renderer-contributions");
    const plugin = rendererPlugins.openBuddyRendererPluginIndex.get(specifier)
      ?? assistantPlugins.openBuddyAssistantContributionPluginIndex.get(specifier)
      ?? crossKindPlugins.openBuddyRendererContributionPluginIndex.get(specifier);
    if (!plugin) throw new Error(`unknown renderer plugin ${specifier}`);
    return plugin;
  });
  await loader.loadProfile(createOpenBuddyRendererProfile());
  const expectedLoaded = ["loaded", "loaded", "loaded", "loaded", "loaded", "loaded", "loaded", "loaded", "loaded", "loaded", "loaded"].sort();
  expect(loader.list().map((entry) => entry.state).sort()).toEqual(expectedLoaded);
  expect((context.get("rendererContributions") as { list: () => unknown[] }).list()).toHaveLength(11);
});

it("declares the DeepSeek renderer shell in dependency order", async () => {
  const { openBuddyDeepSeekRendererEntries } = await import("./renderer");
  const ids = openBuddyDeepSeekRendererEntries.map((entry) => entry.id);
  expect(ids.indexOf("openbuddy-dsh-client-ui-commands")).toBeGreaterThan(ids.indexOf("openbuddy-dsh-client-connection"));
  expect(ids.indexOf("openbuddy-dsh-client-ui-layout")).toBeGreaterThan(ids.indexOf("openbuddy-dsh-client-ui-slots"));
  expect(ids.indexOf("openbuddy-dsh-client-ui-sidebar")).toBeGreaterThan(ids.indexOf("openbuddy-dsh-client-ui-layout"));
  expect(ids.indexOf("openbuddy-dsh-client-ui-model-selection")).toBeGreaterThan(ids.indexOf("openbuddy-dsh-client-ui-commands"));
  expect(ids).toEqual(expect.arrayContaining([
    "openbuddy-dsh-client-runtime",
    "openbuddy-dsh-client-ui-workspace",
    "openbuddy-dsh-client-ui-attachment",
    "openbuddy-dsh-client-ui-directory-picker-native",
    "openbuddy-dsh-client-ui-directory-picker-browse",
  ]));
});
