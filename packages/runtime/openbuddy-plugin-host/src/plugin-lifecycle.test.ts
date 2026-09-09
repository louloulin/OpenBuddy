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
    expect(result.receipts).toEqual([]);
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
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]).toMatchObject({ pluginId: "fixture", status: "committed" });
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
    expect(result.receipts).toEqual([]);
    expect(result.transaction.error).toBe("dispose failed");
    expect(registry.get("fixture")?.state).toBe("active");
    expect(rollback).toEqual(["rollback"]);
    expect(coordinator.getDiagnostics().at(-1)).toMatchObject({ phase: "dispose", message: "dispose failed" });
  });

  it("rolls back every already-disposed dependent when a dependency teardown fails", async () => {
    const registry = new PluginRegistry();
    const coordinator = new PluginLifecycleCoordinator(registry);
    const calls: string[] = [];
    await coordinator.stage(manifest, { stage: () => { calls.push("stage-base"); } });
    await coordinator.activate("fixture");
    const dependent: PluginRegistryManifest = { ...manifest, id: "dependent", surfaces: ["renderer"], dependencies: [{ id: "fixture", range: "^1" }] };
    await coordinator.stage(dependent, { stage: () => { calls.push("stage-dependent"); }, dispose: () => { calls.push("dispose-dependent"); throw new Error("dependent dispose failed"); }, rollback: () => { calls.push("rollback-dependent"); } });
    await coordinator.activate("dependent");
    const result = await coordinator.disable("fixture");
    expect(result.transaction.status).toBe("rolled_back");
    expect(result.receipts).toEqual([]);
    expect(registry.get("fixture")?.state).toBe("active");
    expect(registry.get("dependent")?.state).toBe("active");
    expect(calls).toEqual(["stage-base", "stage-dependent", "dispose-dependent", "rollback-dependent"]);
  });
  it("commits dependency disable receipts in dependent-first order", async () => {
    const registry = new PluginRegistry();
    const coordinator = new PluginLifecycleCoordinator(registry);
    const base: PluginRegistryManifest = { ...manifest, id: "base" };
    const dependent: PluginRegistryManifest = { ...manifest, id: "dependent", surfaces: ["renderer"], dependencies: [{ id: "base", range: "^1" }] };
    await coordinator.stage(base);
    await coordinator.activate("base");
    await coordinator.stage(dependent);
    await coordinator.activate("dependent");

    const result = await coordinator.disable("base");
    expect(result.receipts.map((receipt) => receipt.pluginId)).toEqual(["dependent", "base"]);
    expect(result.receipts.every((receipt) => receipt.status === "committed")).toBe(true);
    expect(registry.get("base")?.state).toBe("disabled");
    expect(registry.get("dependent")?.state).toBe("disabled");
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
