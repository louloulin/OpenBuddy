import { describe, expect, it } from "vitest";
import { PluginRegistry, type PluginRegistryManifest, type PluginRegistrySurface } from "./plugin-registry";

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
    await expect(registry.register({ ...manifest("bad"), entrypoints: { pi: " " } })).rejects.toThrow("entrypoints must be a map of non-empty strings");
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
  });

  it("rejects activating two backends for the same surface", async () => {
    const registry = new PluginRegistry();
    await registry.register(manifest("one"));
    await registry.register(manifest("two"));
    await registry.activate("one");
    await expect(registry.activate("two")).rejects.toThrow("active surface conflict");
  });
});
