import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TaskLifecycleService } from "../task-lifecycle-service";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function makeContext(services: Record<string, unknown> = {}) {
  // Route both task stores into a disposable data dir.
  const dir = await mkdtemp(join(tmpdir(), "openbuddy-core-plugin-mount-"));
  process.env.OPENBUDDY_DATA_DIR = dir;
  cleanups.push(async () => { delete process.env.OPENBUDDY_DATA_DIR; });
  const provided = new Map<string, unknown>();
  return {
    provided,
    provide: (name: string, value: unknown) => { provided.set(name, value); },
    get: (name: string) => services[name],
  };
}

describe("openbuddy-core-plugin taskLifecycle mount", () => {
  it("provides the lifecycle service bound to the Pi session catalog and closes it on teardown", async () => {
    const { apply } = await import("../../openbuddy-core-plugin");
    const sessions: Array<{ sessionId: string }> = [{ sessionId: "session-live" }];
    const ctx = await makeContext({ pi: { listSessions: async () => sessions } });
    const dispose = await apply(ctx as never);

    const service = ctx.provided.get("taskLifecycle") as TaskLifecycleService;
    expect(service).toBeDefined();

    const state = await service.createTask({ sessionId: "session-live" });
    expect(state).toMatchObject({ sessionId: "session-live", status: "draft" });
    // Draft is not a recoverable state; queue it before testing recovery.
    await service.transitionTask(state.taskId, "queue");
    expect(await service.recoverTask(state.taskId, 0)).toMatchObject({ kind: "recovered" });

    // Bound session disappears → actionable outcome, not a silent empty result.
    sessions.length = 0;
    expect(await service.recoverTask(state.taskId, 0)).toMatchObject({ kind: "session_missing" });

    // Teardown closes the mounted instance; further access is rejected.
    await dispose();
    await expect(service.createTask({ sessionId: "session-live" })).rejects.toThrow(/closed/);
    expect(ctx.provided.get("task")).toBeDefined();
  });
});