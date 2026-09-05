import { describe, expect, it } from "vitest";
import { Context } from "@openbuddy/cordis";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { HarnessPluginLoader } from "@openbuddy/plugin-host";
import { PresetSessionRuntime } from "./preset-session-runtime";
import { resolveAgentPresetSelection, sessionHasConversation } from "./agent-preset-selection";

describe("agent preset session selection", () => {
  it("resolves the newest selection and only allows blank sessions to switch", () => {
    expect(resolveAgentPresetSelection([
      { type: "custom", customType: "openbuddy/agent-preset", data: { id: "standard" } },
      { type: "custom", customType: "agent-preset/selected", data: { agentPreset: "coding" } },
    ])).toBe("coding");
    expect(sessionHasConversation([{ type: "custom" }])).toBe(false);
    expect(sessionHasConversation([{ type: "message", message: { role: "user" } }])).toBe(true);
  });
});

describe("PresetSessionRuntime", () => {
  it("mounts tools and prompt sections in a session-local composition", async () => {
    const hostContext = new Context();
    const hostTool = { name: "host_tool" } as unknown as ToolDefinition;
    const localTool = { name: "preset_tool" } as unknown as ToolDefinition;
    const hostTools = new Map([[hostTool.name, hostTool]]);
    hostContext.set("piResources", {
      listAgentPresets: async () => [{ id: "coding", path: "/tmp/coding/agent.cordis.yml" }],
      readAgentPreset: async () => "",
      writeAgentPresetDefault: async () => ({}),
    });
    const hostRegistry = {
      registerTool: (tool: ToolDefinition) => { hostTools.set(tool.name, tool); return () => { hostTools.delete(tool.name); }; },
      list: () => [...hostTools.values()],
    };
    const hostLoader = new HarnessPluginLoader({
      context: hostContext,
      importer: async () => ({
        apply: (ctx: Context) => {
          const registry = ctx.get("toolRegistry") as { registerTool: (tool: ToolDefinition) => () => void };
          const prompt = ctx.get("systemPrompt") as { section: (section: { name: string; order: number; text: string }) => () => void };
          const removeTool = registry.registerTool(localTool);
          const removePrompt = prompt.section({ name: "preset", order: 1, text: "Preset instructions" });
          return () => { removePrompt(); removeTool(); };
        },
      }),
    });
    const runtime = new PresetSessionRuntime({
      hostContext,
      hostLoader,
      toolRegistry: hostRegistry,
      cwd: "/tmp/project",
    });

    await runtime.mount({
      id: "coding",
      path: "/tmp/coding/agent.cordis.yml",
      source: "- id: preset-plugin\n  name: preset-plugin\n",
    });
    expect(runtime.tools.map((tool) => tool.name)).toEqual(["host_tool", "preset_tool"]);
    expect(runtime.renderSystemPrompt()).toContain("Preset instructions");
    expect(hostRegistry.list().map((tool) => tool.name)).toEqual(["host_tool"]);

    await runtime.dispose();
    expect(runtime.tools.map((tool) => tool.name)).toEqual(["host_tool"]);
    expect(runtime.renderSystemPrompt()).toBe("");
  });
});
