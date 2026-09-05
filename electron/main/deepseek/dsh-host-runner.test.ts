import { describe, expect, it, vi } from "vitest";
import { createDshHostRunner } from "./dsh-host-runner";

describe("DeepSeek host runner", () => {
  it("forwards inventory and unwraps nested invocation requests", async () => {
    const inventory = vi.fn(() => ({ packages: [{ id: "plugin" }] }));
    const invoke = vi.fn(async (request: unknown) => request);
    const runner = createDshHostRunner({
      inventory,
      invoke,
      stop: vi.fn(),
      undefine: vi.fn(),
    });

    expect(runner.inventory()).toEqual({ packages: [{ id: "plugin" }] });
    await expect(runner.invoke({ request: { namespace: "demo", method: "ping", args: [1] } })).resolves.toEqual({
      namespace: "demo",
      method: "ping",
      args: [1],
    });
    expect(invoke).toHaveBeenCalledWith({ namespace: "demo", method: "ping", args: [1] });
  });

  it("accepts panel task and definition shapes and rejects missing ids", async () => {
    const stop = vi.fn(async (id: string) => ({ ok: true, id }));
    const undefine = vi.fn(async (id: string) => ({ ok: true, id }));
    const runner = createDshHostRunner({ inventory: () => ({}), invoke: async () => undefined, stop, undefine });

    await expect(runner.stopFromPanel({ taskId: "task-1" })).resolves.toEqual({ ok: true, id: "task-1" });
    await expect(runner.undefineFromPanel({ request: { package: "pkg-1" } })).resolves.toEqual({ ok: true, id: "pkg-1" });
    await expect(runner.stopFromPanel({})).rejects.toThrow("task id is required");
    await expect(runner.undefineFromPanel(null)).rejects.toThrow("definition id is required");
  });
});
