import { describe, expect, it, vi } from "vitest";
import { createWorkflowWorkerHost, type WorkflowWorkerMeta } from "./workflow-worker";

const meta: WorkflowWorkerMeta = {
  name: "worker-contract",
  description: "exercise the Pi-backed workflow seam",
};

function createHost(
  runMember: (input: Parameters<NonNullable<Parameters<typeof createWorkflowWorkerHost>[0]["runner"]["runMember"]>>[0], signal: AbortSignal) => Promise<unknown>,
  emit = vi.fn(),
) {
  return {
    host: createWorkflowWorkerHost({ runner: { runMember }, emit, disposeGraceMs: 250 }),
    emit,
  };
}

describe("workflow worker host", () => {
  it("executes workflow primitives and forwards structured agent options", async () => {
    const calls: unknown[] = [];
    const { host, emit } = createHost(async (input) => {
      calls.push(input);
      return JSON.stringify({ answer: 42 });
    });
    const run = host.start({
      type: "start",
      id: "workflow-1",
      script: `
        phase("Plan");
        log("starting");
        const result = await agent("calculate", {
          label: "calculator",
          provider: "deepseek",
          model: "deepseek-chat",
          schema: { type: "object", properties: { answer: { type: "number" } } }
        });
        const values = await parallel([async () => result.answer, async () => args.offset]);
        return { values, result };
      `,
      meta,
      args: { offset: 7 },
      limits: { maxTotalAgents: 4, maxItems: 8, syncTimeoutMs: 5000 },
    });

    await expect(run.result).resolves.toEqual({
      value: { values: [42, 7], result: { answer: 42 } },
      stopReason: "completed",
      agentsStarted: 1,
    });
    expect(calls).toEqual([expect.objectContaining({
      teamId: "workflow-1",
      memberId: "workflow-1-1",
      role: "calculator",
      goal: "calculate",
      provider: "deepseek",
      model: "deepseek-chat",
      schema: { type: "object", properties: { answer: { type: "number" } } },
    })]);
    expect(emit).toHaveBeenCalledWith("workflow/phase", expect.anything(), "Plan");
    expect(emit).toHaveBeenCalledWith("workflow/log", expect.anything(), "starting");
    await run.dispose();
    await host.dispose();
  });

  it("settles errors without rejecting and enforces the item cap", async () => {
    const { host } = createHost(async () => "unused");
    const run = host.start({
      type: "start",
      id: "workflow-2",
      script: "return await parallel(Array.from({ length: 3 }, () => async () => 1))",
      meta,
      limits: { maxTotalAgents: 2, maxItems: 2, syncTimeoutMs: 5000 },
    });
    await expect(run.result).resolves.toMatchObject({ stopReason: "error", error: expect.stringContaining("item cap") });
    await run.dispose();
    await host.dispose();
  });

  it("cancels pending agents and emits one end event for every started agent", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const { host, emit } = createHost(async (_input, signal) => {
      started();
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("child aborted")), { once: true });
      });
    });
    const run = host.start({
      type: "start",
      id: "workflow-3",
      script: "return await agent('wait')",
      meta,
      limits: { maxTotalAgents: 2, maxItems: 2, syncTimeoutMs: 5000 },
    });
    await startedPromise;
    run.cancel("user stopped");
    await expect(run.result).resolves.toMatchObject({ stopReason: "cancelled", error: "user stopped", agentsStarted: 1 });

    const starts = emit.mock.calls.filter(([event]) => event === "workflow/agent-start");
    const ends = emit.mock.calls.filter(([event]) => event === "workflow/agent-end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(ends[0]?.[2]).toMatchObject({ seq: 1, outcome: "cancelled" });
    await run.dispose();
    await host.dispose();
  });

  it("does not clone the host AbortSignal into the worker", async () => {
    const controller = new AbortController();
    const { host } = createHost(async () => "ok");
    const run = host.start({
      type: "start",
      id: "workflow-4",
      script: "return 1",
      meta,
      signal: controller.signal,
      limits: { maxTotalAgents: 1, maxItems: 1, syncTimeoutMs: 5000 },
    });
    await expect(run.result).resolves.toMatchObject({ value: 1, stopReason: "completed" });
    await run.dispose();
    await host.dispose();
  });
});
