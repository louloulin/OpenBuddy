/**
 * Phase 6 e2e — end-to-end test of the new "archived sessions are visible"
 * pipeline.
 *
 * Walks the full data path that the renderer would trigger:
 *   1. JSONL session files are created via SessionManager (pi).
 *   2. `openbuddy-state.json` is seeded with an archived id (legacy
 *      OpenBuddy-only metadata).
 *   3. `listAllPiSessions` discovers all 74-ish sessions on disk.
 *   4. The same filter+map pipeline as `agentHost.listSessions` produces a
 *      payload with the right archived flag per row.
 *   5. Pinning a session toggles its flag in the metadata file (the same
 *      path `setSessionPinned` takes).
 *   6. Unarchiving drops the id from the archived list (the same path
 *      `setSessionArchived(_, false)` takes).
 *
 * This is the regression: before R2.5, step 4 dropped archived rows, so
 * even though 74 sessions lived on disk, the renderer only saw 3.
 */
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// Mirror of agent-host.ts::listSessions. If you change the production logic,
// update this mirror AND the test in list-sessions-archived.test.ts.
async function productionListSessions(
  cwd: string,
  sessionsRoot: string,
  stateFile: string,
): Promise<Array<{ id: string; archived: boolean; pinned: boolean }>> {
  const allSessions = await SessionManager.listAll(sessionsRoot);
  let metadata: { archived?: string[]; pinned?: string[] } = {};
  try {
    metadata = JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    /* first run */
  }
  const archived = new Set(metadata.archived ?? []);
  const pinned = new Set(metadata.pinned ?? []);
  const scoped = await SessionManager.list(cwd, sessionsRoot);
  const merged = [
    ...new Map(
      [...scoped, ...allSessions.filter((s) => resolve(s.cwd ?? cwd) === resolve(cwd))]
        .map((s) => [s.path, s]),
    ).values(),
  ];
  return merged
    .filter(() => true) // R2.5: no more `!archived.has(...)` filter
    .map((s) => ({ id: s.id, archived: archived.has(s.id), pinned: pinned.has(s.id) }))
    .sort((a, b) => {
      const archivedRank = Number(a.archived) - Number(b.archived);
      if (archivedRank !== 0) return archivedRank;
      const pin = Number(b.pinned) - Number(a.pinned);
      if (pin !== 0) return pin;
      return 0;
    });
}

async function setArchived(
  stateFile: string,
  sessionId: string,
  archived: boolean,
): Promise<void> {
  let meta: { archived?: string[]; pinned?: string[] } = {};
  try { meta = JSON.parse(await readFile(stateFile, "utf8")); } catch { /* first run */ }
  meta.archived = (meta.archived ?? []).filter((id) => id !== sessionId);
  if (archived) meta.archived = [...(meta.archived ?? []), sessionId];
  await writeFile(stateFile, JSON.stringify(meta, null, 2));
}

describe("listSessions end-to-end (R2.5)", () => {
  let tempDir: string;
  let sessionsRoot: string;
  let stateFile: string;
  const cwd = "/tmp/openbuddy-e2e-list";

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ob-e2e-list-"));
    sessionsRoot = join(tempDir, "sessions");
    stateFile = join(tempDir, "openbuddy-state.json");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("10 sessions with 7 archived all surface; the renderer can sort them", async () => {
    // Seed 10 sessions, all in the same cwd. SessionManager buffers
    // entries in memory until an assistant message is appended, so each
    // pair of appendMessage calls below materialises one JSONL file.
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const mgr = SessionManager.create(cwd, sessionsRoot);
      mgr.appendMessage({
        role: "user",
        content: `q${i}`,
        timestamp: new Date().toISOString(),
      } as never);
      mgr.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: `a${i}` }],
        timestamp: new Date().toISOString(),
      } as never);
      ids.push(mgr.getSessionId());
    }
    // Mark 7 of them as archived.
    await writeFile(stateFile, JSON.stringify({
      pinned: [],
      archived: ids.slice(0, 7),
      experts: {},
    }));

    const list = await productionListSessions(cwd, sessionsRoot, stateFile);
    expect(list).toHaveLength(10);
    const archivedRows = list.filter((row) => row.archived);
    const liveRows = list.filter((row) => !row.archived);
    expect(archivedRows).toHaveLength(7);
    expect(liveRows).toHaveLength(3);
    // The sort places archived at the END so the live list stays on top.
    // First 3 rows are the live (non-archived) sessions; next 7 are
    // archived.
    expect(list.slice(0, 3).every((row) => !row.archived)).toBe(true);
    expect(list.slice(3).every((row) => row.archived)).toBe(true);
  });

  test("unarchiving removes the id from the archived list on the next list call", async () => {
    // Use the leftover state file from the previous test (7 archived, 3 live).
    const before = await productionListSessions(cwd, sessionsRoot, stateFile);
    const target = before.find((row) => row.archived);
    expect(target).toBeDefined();
    if (!target) return;

    // Same path setSessionArchived(_, false) takes in agent-host.ts.
    await setArchived(stateFile, target.id, false);

    const after = await productionListSessions(cwd, sessionsRoot, stateFile);
    const restored = after.find((row) => row.id === target.id);
    expect(restored?.archived).toBe(false);
    // The live group grows by one; archived shrinks by one.
    expect(after.filter((row) => !row.archived).length).toBe(4);
    expect(after.filter((row) => row.archived).length).toBe(6);
  });

  test("pinning surfaces in the pinned flag without dropping archived rows", async () => {
    const before = await productionListSessions(cwd, sessionsRoot, stateFile);
    const target = before.find((row) => !row.archived);
    expect(target).toBeDefined();
    if (!target) return;

    // Same path setSessionPinned(_, true) takes.
    let meta: { archived?: string[]; pinned?: string[] } = JSON.parse(
      await readFile(stateFile, "utf8"),
    );
    meta.pinned = [...(meta.pinned ?? []), target.id];
    await writeFile(stateFile, JSON.stringify(meta, null, 2));

    const after = await productionListSessions(cwd, sessionsRoot, stateFile);
    const pinned = after.find((row) => row.id === target.id);
    expect(pinned?.pinned).toBe(true);
    // Archived count unchanged.
    expect(after.filter((row) => row.archived).length).toBe(6);
  });
});

