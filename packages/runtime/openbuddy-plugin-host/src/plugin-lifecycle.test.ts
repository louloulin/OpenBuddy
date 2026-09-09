import { describe, expect, it } from "vitest";
import { PluginLifecycleCoordinator } from "./plugin-lifecycle";
import { PluginRegistry, type PluginRegistryManifest } from "./plugin-registry";

const manifest: PluginRegistryManifest = { schema: "openbuddy.plugin.v1", id: "fixture", version: "1.0.0", apiVersion: "1", surfaces: ["pi"] };

describe("PluginLifecycleCoordinator", () => {
  it("rolls back failed staging and exposes diagnostics/readiness", async () => {
    const registry = new PluginRegistry({ transactionId: () => "tx-1" });
    const coordinator = new PluginLifecycleCoordinator(registry);
    const rollback: string[] = [];
    const result = await coordinator.stage(manifest, {
      stage: () => { throw new Error("fixture stage failed"); },
      rollback: () => { rollback.push("rolled-back"); },
    });
    expect(result.transaction.status).toBe("rolled_back");
    expect(registry.get("fixture")?.state).toBe("failed");
    expect(coordinator.getReadiness().phase).toBe("failed");
    expect(rollback).toEqual(["rolled-back"]);
    expect(coordinator.getDiagnostics()[0].phase).toBe("stage");
    expect(coordinator.getReadiness().generation).toBe(2);
  });

  it("does not apply stale fixture events after generation advances", async () => {
    const registry = new PluginRegistry();
    const coordinator = new PluginLifecycleCoordinator(registry);
    await coordinator.stage(manifest);
    const received: string[] = [];
    const captured = coordinator.getReadiness().generation;
    await coordinator.activate("fixture");
    if (captured === coordinator.getReadiness().generation) received.push("stale");
    expect(received).toEqual([]);
  });

  it("disables through the adapter before committing the registry state", async () => {
    const registry = new PluginRegistry();
    const coordinator = new PluginLifecycleCoordinator(registry);
    const calls: string[] = [];
    await coordinator.stage(manifest, { stage: () => { calls.push("stage"); }, dispose: () => { calls.push("dispose"); } });
    const result = await coordinator.disable("fixture");
    expect(result.transaction.kind).toBe("disable");
    expect(registry.get("fixture")?.state).toBe("disabled");
    expect(calls).toEqual(["stage", "dispose"]);
  });

  it("keeps an active plugin and rolls back when dispose fails", async () => {
    const registry = new PluginRegistry();
    const coordinator = new PluginLifecycleCoordinator(registry);
    const rollback: string[] = [];
    await coordinator.stage(manifest, { stage: () => undefined, dispose: () => { throw new Error("dispose failed"); }, rollback: () => { rollback.push("rollback"); } });
    await coordinator.activate("fixture");
    const result = await coordinator.disable("fixture");
    expect(result.transaction.status).toBe("rolled_back");
    expect(result.transaction.error).toBe("dispose failed");
    expect(registry.get("fixture")?.state).toBe("active");
    expect(rollback).toEqual(["rollback"]);
    expect(coordinator.getDiagnostics().at(-1)).toMatchObject({ phase: "dispose", message: "dispose failed" });
  });

  it("filters an explicitly replayed stale generation event", async () => {
    const registry = new PluginRegistry();
    const received: number[] = [];
    registry.subscribeCurrent((event) => received.push(event.generation));
    await registry.register(manifest);
    await registry.activate("fixture");
    registry.publish({ kind: "activate", pluginId: "fixture", generation: 1, transactionId: "stale", state: "active" });
    registry.publish({ kind: "activate", pluginId: "fixture", generation: 2, transactionId: "current", state: "active" });
    expect(received).toEqual([1, 2, 2]);
  });

});
