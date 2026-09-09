import { describe, expect, it } from "vitest";
import { PluginRegistry, satisfiesPluginDependencyRange, type PluginRegistryManifest, type PluginRegistrySurface } from "./plugin-registry";

const manifest = (id: string, surfaces: PluginRegistrySurface[] = ["pi"]): PluginRegistryManifest => ({
  schema: "openbuddy.plugin.v1", id, version: "1.0.0", apiVersion: "1", surfaces,
});

describe("PluginRegistry", () => {
  it("serializes mutations and fences each committed state with a generation", async () => {
    const registry = new PluginRegistry({ transactionId: (() => { let i = 0; return () => `tx-${++i}`; })() });
    const [registered, second] = await Promise.all([
      registry.register(manifest("one")),
      registry.register(manifest("two", ["renderer"])),
    ]);
    const activated = await registry.activate("one");
    expect(registered.status).toBe("committed");
    expect(activated.generation).toBeGreaterThan(registered.generation);
    expect(second.generation).toBeGreaterThan(registered.generation);
    expect(registry.get("one")?.state).toBe("active");
  });

  it("matches supported dependency ranges", () => {
    expect(satisfiesPluginDependencyRange("1.4.2", "^1.2.0")).toBe(true);
    expect(satisfiesPluginDependencyRange("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfiesPluginDependencyRange("1.4.2", "~1.4.0")).toBe(true);
    expect(satisfiesPluginDependencyRange("1.5.0", "~1.4.0")).toBe(false);
    expect(satisfiesPluginDependencyRange("1.4.2", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesPluginDependencyRange("1.4.2", "not-a-range")).toBe(false);
  });

  it("rejects missing required dependencies and duplicate registration", async () => {
    const registry = new PluginRegistry();
    await expect(registry.register({ ...manifest("dependent"), dependencies: [{ id: "missing", range: "^1", optional: false }] })).rejects.toThrow("dependency missing");
    await registry.register(manifest("one"));
    await expect(registry.register(manifest("one"))).rejects.toThrow("already registered");
  });

  it("rejects malformed nested manifest fields and protects registered manifests", async () => {
    const registry = new PluginRegistry();
    await expect(registry.register({ ...manifest("bad"), dependencies: [{ id: "dep", range: "^1" }, { id: "dep", range: "^1" }] })).rejects.toThrow("duplicate dependency");
    await expect(registry.register({ ...manifest("bad"), permissions: "shell" as never })).rejects.toThrow("permissions must be a non-empty string array");
    await expect(registry.register({ ...manifest("bad"), permissions: ["shell", " "] })).rejects.toThrow("permissions must be a non-empty string array");
    await expect(registry.register({ ...manifest("bad"), permissions: [] })).rejects.toThrow("permissions must be a non-empty string array");
    await expect(registry.register({ ...manifest("bad"), entrypoints: { pi: " " } })).rejects.toThrow("entrypoints must be a map of non-empty strings");
    await expect(registry.register({ ...manifest("bad"), entrypoints: {} })).rejects.toThrow("entrypoints must be a map of non-empty strings");
    await registry.register(manifest("dep"));
    await registry.activate("dep");
    const nested = { ...manifest("nested"), dependencies: [{ id: "dep", range: "^1" }] };
    await registry.register(nested);
    (nested.surfaces as PluginRegistrySurface[]).push("renderer");
    nested.dependencies![0].id = "mutated";
    const stored = registry.get("nested")?.manifest;
    expect(stored?.surfaces).toEqual(["pi"]);
    expect(stored?.dependencies?.[0].id).toBe("dep");
    (stored?.surfaces as PluginRegistrySurface[] | undefined)?.push("renderer");
    expect(registry.get("nested")?.manifest.surfaces).toEqual(["pi"]);

    const incompatible = new PluginRegistry();
    await incompatible.register({ ...manifest("dependency"), version: "2.0.0" });
    await incompatible.activate("dependency");
    await incompatible.register({ ...manifest("consumer"), dependencies: [{ id: "dependency", range: "^1.0.0" }] });
    await expect(incompatible.activate("consumer")).rejects.toThrow("does not satisfy ^1.0.0");
  });

  it("projects inventory and emits generation-fenced lifecycle events", async () => {
    const registry = new PluginRegistry({ transactionId: (() => { let i = 0; return () => `tx-${++i}`; })() });
    const events: string[] = [];
    registry.subscribe((event) => events.push(`${event.kind}:${event.pluginId}:${event.generation}:${event.state}`));
    await registry.register({ ...manifest("managed"), source: "profile", managed: true });
    await registry.activate("managed");
    await registry.disable("managed");
    expect(registry.inventory()[0]).toMatchObject({ id: "managed", version: "1.0.0", source: "profile", managed: true, state: "disabled", health: "healthy", disabledReason: "user" });
    await registry.activate("managed");
    expect(registry.inventory()[0]).toMatchObject({ state: "active" });
    expect(registry.inventory()[0]).not.toHaveProperty("disabledReason");
    expect(events).toEqual(["register:managed:1:staged", "activate:managed:2:active", "disable:managed:3:disabled", "activate:managed:4:active"]);
  });
  it("rejects activating two plugins that claim one canonical capability", async () => {
    const registry = new PluginRegistry();
    await registry.register({ ...manifest("one"), capabilities: ["web"] });
    await registry.register({ ...manifest("two", ["renderer"]), capabilities: ["web"] });
    await registry.activate("one");
    await expect(registry.activate("two")).rejects.toThrow("active surface conflict: web");
  });

  it("rejects malformed capability declarations", async () => {
    const registry = new PluginRegistry();
    await expect(registry.register({ ...manifest("bad"), capabilities: "web" as never })).rejects.toThrow("capabilities must be a non-empty string array");
    await expect(registry.register({ ...manifest("bad"), capabilities: ["web", " "] })).rejects.toThrow("capabilities must be a non-empty string array");
    await expect(registry.register({ ...manifest("bad"), capabilities: ["web", "web"] })).rejects.toThrow("duplicate capabilities");
  });
});
