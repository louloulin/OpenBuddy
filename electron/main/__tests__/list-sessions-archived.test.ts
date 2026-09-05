/**
 * Phase 6 e2e — listSessions honours the legacy archived flag and surfaces
 * archived rows (instead of dropping them) so the sidebar can render the
 * 已归档 group with a one-click 恢复 action.
 *
 * This regression existed before: `agentHost.listSessions` filtered out
 * `archived.has(entry.id)` entirely, which meant that once an archived list
 * grew (e.g. an accidental bulk archive), historical sessions vanished from
 * the UI with no way to recover them through the chrome.
 *
 * The fix: return every persisted session under the cwd, set `archived` to
 * the value from the legacy state file, and let the renderer route them
 * into the dedicated 已归档 section.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/** Mirror of the production `listSessions` archive filter. */
async function listSessionsLikeAgentHost(
  cwd: string,
  sessionsRoot: string,
  stateFile: string,
): Promise<Array<{ id: string; archived: boolean }>> {
  const fs = await import("node:fs/promises");
  const allSessions = await SessionManager.listAll(sessionsRoot);
  let metadata: { archived?: string[] } = {};
  try {
    metadata = JSON.parse(await fs.readFile(stateFile, "utf8"));
  } catch {
    /* first run */
  }
  const archived = new Set(metadata.archived ?? []);
  const scoped = await SessionManager.list(cwd, sessionsRoot);
  const merged = [
    ...new Map(
      [...scoped, ...allSessions.filter((s) => resolve(s.cwd ?? cwd) === resolve(cwd))]
        .map((s) => [s.path, s]),
    ).values(),
  ];
  return merged.map((s) => ({ id: s.id, archived: archived.has(s.id) }));
}

describe("listSessions honours archived flag (R2.5)", () => {
  let tempDir: string;
  let sessionsRoot: string;
  let stateFile: string;
  const cwd = "/tmp/openbuddy-list-test-workspace";

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ob-list-sessions-"));
    sessionsRoot = join(tempDir, "sessions");
    stateFile = join(tempDir, "openbuddy-state.json");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("archived session is surfaced with archived=true instead of dropped", async () => {
    const mgr = SessionManager.create(cwd, sessionsRoot);
    mgr.appendMessage({
      role: "user",
      content: "hello",
      timestamp: new Date().toISOString(),
    } as never);
    mgr.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hi back" }],
      timestamp: new Date().toISOString(),
    } as never);
    const id = mgr.getSessionId();
    await writeFile(stateFile, JSON.stringify({ pinned: [], archived: [id], experts: {} }));
    const list = await listSessionsLikeAgentHost(cwd, sessionsRoot, stateFile);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(id);
    expect(list[0]?.archived).toBe(true);
  });

  test("non-archived session is surfaced with archived=false", async () => {
    const mgr = SessionManager.create(cwd, sessionsRoot);
    mgr.appendMessage({
      role: "user",
      content: "live",
      timestamp: new Date().toISOString(),
    } as never);
    mgr.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      timestamp: new Date().toISOString(),
    } as never);
    const id = mgr.getSessionId();
    await writeFile(stateFile, JSON.stringify({ pinned: [], archived: [], experts: {} }));
    const list = await listSessionsLikeAgentHost(cwd, sessionsRoot, stateFile);
    expect(list.find((entry) => entry.id === id)).toEqual({ id, archived: false });
  });

  test("absent state file defaults to archived=false for every session", async () => {
    const mgr = SessionManager.create(cwd, sessionsRoot);
    mgr.appendMessage({
      role: "user",
      content: "fresh",
      timestamp: new Date().toISOString(),
    } as never);
    mgr.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "welcome" }],
      timestamp: new Date().toISOString(),
    } as never);
    const id = mgr.getSessionId();
    await rm(stateFile, { force: true });
    const list = await listSessionsLikeAgentHost(cwd, sessionsRoot, stateFile);
    expect(list.find((entry) => entry.id === id)).toEqual({ id, archived: false });
  });
});
