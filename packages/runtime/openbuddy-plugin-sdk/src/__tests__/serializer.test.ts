import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  drainPendingDiagnostics,
  identityPathResolver,
  isSerializedPlugin,
  manifestToExtensionFactory,
  serializePluginManifest,
  setDiagnosticSink,
} from "../serializer";
import { parsePluginManifest } from "../manifest";

interface ApiRecorder {
  api: ExtensionAPI;
  toolNames: string[];
  commandNames: string[];
  events: string[];
}

function makeApi(): ApiRecorder {
  const toolNames: string[] = [];
  const commandNames: string[] = [];
  const events: string[] = [];
  const handlerFor = () => events;
  const api = {
    on(event: string) {
      events.push(event);
      return undefined;
    },
    registerTool(tool: { name: string }) {
      toolNames.push(tool.name);
    },
    registerCommand(name: string) {
      commandNames.push(name);
    },
  } as unknown as ExtensionAPI;
  return { api, toolNames, commandNames, events };
}

describe("manifestToExtensionFactory", () => {
  it("builds a factory that registers handlers, tools, and commands", () => {
    const manifest = parsePluginManifest({
      name: "sample",
      version: "1.0.0",
      pi: {
        handlers: {
          session_start: "./handlers/session-start.js",
          session_before_compact: "./handlers/before-compact.js",
        },
        tools: ["./tools/index.js"],
        commands: ["./commands/hello.js"],
      },
    });
    const serialized = manifestToExtensionFactory(manifest, "/abs/sample/plugin.json");
    expect(serialized.tracks).toEqual(["pi"]);
    expect(isSerializedPlugin(serialized)).toBe(true);

    const recorder = makeApi();
    serialized.factory(recorder.api);

    expect(recorder.events.sort()).toEqual([
      "session_before_compact",
      "session_start",
    ]);
    expect(recorder.toolNames).toHaveLength(1);
    expect(recorder.commandNames).toHaveLength(1);
  });

  it("uses the inline factory escape hatch when declared", () => {
    const inline = vi.fn();
    const manifest = parsePluginManifest({
      name: "inline",
      version: "1.0.0",
      pi: { factory: inline as unknown as never },
    });
    const serialized = manifestToExtensionFactory(manifest, "/abs/inline/plugin.json");
    expect(serialized.factory).toBe(inline);
  });

  it("preserves the supplied path resolver identity", () => {
    const seen: string[] = [];
    const resolver = {
      resolve(path: string): string {
        seen.push(path);
        return `resolved::${path}`;
      },
    };
    const manifest = parsePluginManifest({
      name: "resolver",
      version: "1.0.0",
      pi: { tools: ["./tools/index.js"] },
    });
    const serialized = manifestToExtensionFactory(manifest, "/abs/r/plugin.json", resolver);
    const recorder = makeApi();
    serialized.factory(recorder.api);
    expect(seen).toEqual(["./tools/index.js"]);
    expect(recorder.toolNames[0]?.includes("resolved")).toBe(true);
  });

  it("captures diagnostics when the manifest declares an unknown event", () => {
    const sink = vi.fn();
    setDiagnosticSink(sink);
    // Build a synthetic serialized manifest so we can bypass zod's
    // strict event allow-list. The serializer treats any string key as
    // a forward-compatible event name and surfaces unknown events to
    // the diagnostic sink.
    const serialized = manifestToExtensionFactory(
      {
        name: "unknown-event",
        version: "1.0.0",
        pi: { handlers: { definitely_not_a_pi_event: "./a.js" } },
      },
      "/abs/u/plugin.json",
    );
    const recorder = makeApi();
    serialized.factory(recorder.api);
    expect(sink).toHaveBeenCalledWith(expect.stringContaining("definitely_not_a_pi_event"));
    expect(drainPendingDiagnostics()).toHaveLength(0);
  });

  it("surfaces a diagnostic for empty pi tracks", () => {
    const manifest = parsePluginManifest({
      name: "empty-pi",
      version: "1.0.0",
      ui: { x: { type: "status-bar", id: "y", getText: "./a.js" } },
    });
    // We need a pi track to be detected by the serializer (so the
    // empty check fires) but with no actual contents. Bypass the
    // strict parser by feeding a synthetic manifest directly.
    const serialized = manifestToExtensionFactory(
      {
        name: "empty-pi",
        version: "1.0.0",
        pi: { handlers: {}, tools: [], commands: [] },
      },
      "/abs/empty/plugin.json",
    );
    expect(serialized.diagnostics.length).toBe(1);
    expect(serialized.diagnostics[0]?.includes("no handlers, tools, commands, or factory")).toBe(true);
  });

  it("emits a no-op factory when no pi track is present", () => {
    const manifest = parsePluginManifest({
      name: "ui-only",
      version: "1.0.0",
      ui: { x: { type: "status-bar", id: "y", getText: "./a.js" } },
    });
    const serialized = manifestToExtensionFactory(manifest, "/abs/ui/plugin.json");
    expect(serialized.tracks).toContain("ui");
    expect(typeof serialized.factory).toBe("function");
    const recorder = makeApi();
    serialized.factory(recorder.api);
    expect(recorder.events).toEqual([]);
  });
});

describe("serializePluginManifest", () => {
  it("combines parsing + serialization in a single call", () => {
    const serialized = serializePluginManifest(
      {
        name: "combo",
        version: "1.0.0",
        pi: { commands: ["./cmd.js"] },
      },
      "/abs/combo/plugin.json",
    );
    expect(serialized.tracks).toEqual(["pi"]);
    expect(serialized.diagnostics).toEqual([]);
  });
});

describe("identityPathResolver", () => {
  it("returns its input unchanged", () => {
    expect(identityPathResolver.resolve("./foo.js")).toBe("./foo.js");
  });
});
