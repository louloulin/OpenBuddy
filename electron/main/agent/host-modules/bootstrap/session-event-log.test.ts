import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { on: () => undefined, getPath: () => "/tmp/openbuddy-bootstrap-session-event-log-test" },
}));

import { bootstrapSessionEventLog } from "./session-event-log";
import type { AgentHostState } from "../_state-shape";

/** Build a fresh AgentHostState stub for one test. */
function makeStubState(): AgentHostState {
  return {
    sessionEventLog: null,
    cwd: null,
    eventSequence: 0,
    sessionSequences: new Map(),
  } as unknown as AgentHostState;
}

// 这些用例真的去开一个 SQLite SessionEventLog(含 schema 迁移),单次 3-7s。
// vitest 默认 5s/test 的全量并行跑法会把它们判成超时(单独跑则通过),
// 所以这里显式放宽,而不是把它当成真实失败。
describe("host-modules/bootstrap/session-event-log", { timeout: 30_000 }, () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "openbuddy-bootstrap-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  });

  it("populates state.sessionEventLog / cwd / eventSequence / sessionSequences", async () => {
    const state = makeStubState();
    expect(state.sessionEventLog).toBeNull();
    expect(state.cwd).toBeNull();
    expect(state.eventSequence).toBe(0);
    expect(state.sessionSequences.size).toBe(0);

    const log = await bootstrapSessionEventLog(state, cwd);

    expect(log).toBe(state.sessionEventLog);
    expect(state.cwd).toBe(cwd);
    expect(state.sessionSequences).toBeInstanceOf(Map);
    expect(state.sessionSequences.size).toBe(0);
    expect(state.eventSequence).toBe(log.lastSequence());
  });

  it("does not mutate the caller's Map identity for sessionSequences", async () => {
    // Verifies the function creates a fresh Map rather than reusing one.
    const originalMap = new Map<string, number>();
    originalMap.set("stale", 1);
    const state = makeStubState();
    state.sessionSequences = originalMap;

    await bootstrapSessionEventLog(state, cwd);

    expect(state.sessionSequences).not.toBe(originalMap);
    expect(state.sessionSequences.size).toBe(0);
    // originalMap is untouched — caller can still read from it.
    expect(originalMap.size).toBe(1);
  });

  it("returns a fresh SessionEventLog on each call (no module-level caching)", async () => {
    const state = makeStubState();
    const log1 = await bootstrapSessionEventLog(state, cwd);
    const log2 = await bootstrapSessionEventLog(state, cwd);
    expect(log1).not.toBe(log2);
    expect(state.sessionEventLog).toBe(log2);
  });
});
