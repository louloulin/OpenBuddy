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
    expect(rollback).toEqual(["rolled-back"]);
    expect(coordinator.getDiagnostics()[0].phase).toBe("stage");
    expect(coordinator.getReadiness().generation).toBe(1);
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
});
