// @vitest-environment node
//
// NOTE: kept under `src/lib/__tests__/` (not `electron/main/__tests__/`)
// because the root vitest `include` only collects `src/**` and
// `packages/**` — electron-main tests are not discovered by `pnpm test`.
/**
 * Regression test for the `agentHost.sessionFile` facade contract.
 *
 * Bug (found via real-Electron verification of the Plan5 message-level
 * rewind entry): `agent-host.ts` bound the *synchronous* string-returning
 * `sessionFile()` primitive straight onto the facade, whose contract is
 * `Promise<{ ok, path?, sizeBytes?, error? }>`. Because `rewind_points`
 * (and the file-based `session_fork` path) read `.path`, every call saw
 * `undefined` and threw "session file path unavailable" — so the
 * per-message rewind button rendered permanently disabled.
 *
 * These tests pin the shape so a future "simplification" back to the raw
 * primitive fails loudly here instead of silently in the renderer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installSessionStore, sessionFile, sessionFileResult } from "../../../electron/main/agent/host-modules/session-store";
import type { AgentHostState } from "../../../electron/main/agent/host-modules/_state-shape";

function stubState(session: unknown): AgentHostState {
  return { session } as unknown as AgentHostState;
}

function liveSession(sessionId: string, file: string | null) {
  return {
    sessionId,
    sessionManager: { getSessionFile: () => file },
  };
}

/** installSessionStore is idempotent-by-assignment; only `state` matters here. */
function install(state: AgentHostState): void {
  installSessionStore({
    state,
    piSessionDir: (cwd: string) => `/pi/${cwd}`,
    emitPluginEvent: () => undefined,
    emitRendererEvent: () => undefined,
    enqueueLifecycle: async (op) => op(),
    initialize: async () => undefined,
    rebindSession: async () => undefined,
    dispose: async () => undefined,
    lifecycleAppendQueues: new Map(),
    listAllPiSessions: async () => [],
    persistedSessionPath: async () => undefined,
    piRuntimeCoordinator: { reload: async () => undefined },
  });
}

describe("sessionFileResult (facade shape for agentHost.sessionFile)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ob-session-file-"));
  });

  it("returns { ok:true, path, sizeBytes } for a live session", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(file, '{"type":"message"}\n', "utf8");
    install(stubState(liveSession("s-1", file)));

    const result = await sessionFileResult("s-1");
    expect(result.ok).toBe(true);
    expect(result.path).toBe(file);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("exposes `.path` — the exact field rewind_points / session_fork read", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(file, "x", "utf8");
    install(stubState(liveSession("s-2", file)));

    const result = (await sessionFileResult("s-2")) as { path?: string };
    expect(typeof result.path).toBe("string");
    expect(result.path).not.toBeUndefined();
  });

  it("still reports the path when the file cannot be stat-ed", async () => {
    install(stubState(liveSession("s-3", join(dir, "missing.jsonl"))));
    const result = await sessionFileResult("s-3");
    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(dir, "missing.jsonl"));
    expect(result.sizeBytes).toBeUndefined();
  });

  it("returns { ok:false, error } instead of throwing for an unloaded session", async () => {
    install(stubState(null));
    const result = await sessionFileResult("nope");
    expect(result.ok).toBe(false);
    expect(result.path).toBeUndefined();
    expect(result.error).toMatch(/not loaded/i);
  });

  it("returns { ok:false, error } when the session has no persisted file", async () => {
    install(stubState(liveSession("s-4", null)));
    const result = await sessionFileResult("s-4");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no persisted file/i);
  });

  it("the raw primitive still throws (documenting why the adapter exists)", () => {
    install(stubState(null));
    expect(() => sessionFile("nope")).toThrow(/not loaded/i);
  });
});
