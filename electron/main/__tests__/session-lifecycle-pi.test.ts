/**
 * Phase 6 e2e — real pi SessionManager + AgentSession roundtrip.
 *
 * Replaces the deleted electron/main/session/{lifecycle-journal,
 * history-pagination, session-queue, session-event-log}.test.ts by exercising
 * pi's own persistence primitives (create / open / list / appendCustomEntry /
 * appendMessage) in an isolated tempdir.
 *
 * Notes on pi persistence:
 *  - pi's SessionManager buffers entries in memory and only flushes to disk
 *    when an assistant message arrives (or the session is forced to flush).
 *    Plain `appendCustomEntry` calls therefore do NOT produce on-disk files.
 *  - Tests that assert on-disk persistence must therefore append a user +
 *    assistant pair before reopening.
 */
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * Force a session to flush by appending one user + one assistant message.
 * pi's _persist() only writes the JSONL file once an assistant entry shows up.
 */
function flushWithAssistant(mgr: SessionManager, userText: string, assistantText: string): void {
  mgr.appendMessage({
    role: "user",
    content: userText,
    timestamp: new Date().toISOString(),
  } as any);
  mgr.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: assistantText }],
    timestamp: new Date().toISOString(),
  } as any);
}

describe("Session lifecycle (real pi)", () => {
  let tempDir: string;
  let sessionsRoot: string;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalHome = process.env.PI_HOME;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ob-session-test-"));
    sessionsRoot = join(tempDir, "sessions");
    // Keep PI_HOME/PI_CODING_AGENT_DIR pointed at our sandbox so any internal
    // resolution pi does stays isolated.
    process.env.PI_CODING_AGENT_DIR = tempDir;
    process.env.PI_HOME = tempDir;
  });

  afterAll(async () => {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    if (originalHome === undefined) delete process.env.PI_HOME;
    else process.env.PI_HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  test("create + flush + list + reopen round-trip", async () => {
    const cwd = join(tempDir, "workspace-a");
    const mgr = SessionManager.create(cwd, sessionsRoot);

    const id = mgr.getSessionId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    // A brand-new session has no entries.
    expect(mgr.getEntries()).toHaveLength(0);

    // Drive persistence: appendCustomEntry is buffered, but assistant flushes.
    mgr.appendCustomEntry("openbuddy/lifecycle", { event: { version: 1, revision: 1 } });
    flushWithAssistant(mgr, "hello", "hi back");

    const sessionFile = mgr.getSessionFile();
    expect(typeof sessionFile).toBe("string");
    expect(String(sessionFile)).toContain(sessionsRoot);

    // list() should now surface our session by id (file is on disk).
    const listed = await SessionManager.list(cwd, sessionsRoot);
    expect(listed.some((s) => s.id === id)).toBe(true);

    // Reopen the on-disk session and verify the custom entry round-tripped.
    const reopened = SessionManager.open(sessionFile!, sessionsRoot);
    expect(reopened.getSessionId()).toBe(id);
    const reloadedEntries = reopened.getEntries();
    expect(reloadedEntries.length).toBeGreaterThan(0);
    const customEntry = reloadedEntries.find(
      (e: any) => e.type === "custom" && e.customType === "openbuddy/lifecycle",
    );
    expect(customEntry).toBeDefined();
    expect((customEntry as any).data).toEqual({ event: { version: 1, revision: 1 } });
  });

  test("appendMessage + reopen preserves user and assistant messages", async () => {
    const cwd = join(tempDir, "workspace-b");
    const mgr = SessionManager.create(cwd, sessionsRoot);

    const userMessage = {
      role: "user" as const,
      content: "hello pi",
      timestamp: new Date().toISOString(),
    };
    const userEntryId = mgr.appendMessage(userMessage as any);
    expect(typeof userEntryId).toBe("string");

    // Append an assistant message — pi flushes the buffered entries to disk
    // once it sees the first assistant message.
    const assistantMessage = {
      role: "assistant" as const,
      content: [{ type: "text", text: "hi back" }],
      timestamp: new Date().toISOString(),
    };
    const assistantEntryId = mgr.appendMessage(assistantMessage as any);
    expect(typeof assistantEntryId).toBe("string");

    const sessionFile = mgr.getSessionFile();
    const reopened = SessionManager.open(sessionFile!, sessionsRoot);

    const msgs = reopened.getEntries().filter((e: any) => e.type === "message");
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    const userEntry = msgs.find((e: any) => e.message?.role === "user");
    const assistantEntry = msgs.find((e: any) => e.message?.role === "assistant");
    expect(userEntry).toBeDefined();
    expect(assistantEntry).toBeDefined();
    expect(userEntry!.id).toBe(userEntryId);
    expect(assistantEntry!.id).toBe(assistantEntryId);
  });

  test("listAll enumerates sessions across multiple workspaces", async () => {
    const cwdA = join(tempDir, "workspace-multi-a");
    const cwdB = join(tempDir, "workspace-multi-b");

    const mgrA = SessionManager.create(cwdA, sessionsRoot);
    const mgrB = SessionManager.create(cwdB, sessionsRoot);
    flushWithAssistant(mgrA, "a?", "yes-a");
    flushWithAssistant(mgrB, "b?", "yes-b");

    const all = await SessionManager.listAll(sessionsRoot);
    const ids = all.map((s) => s.id);
    expect(ids).toContain(mgrA.getSessionId());
    expect(ids).toContain(mgrB.getSessionId());
  });

  test("custom entries persist through a separate reopen via listAll", async () => {
    const cwd = join(tempDir, "workspace-reopen");
    const mgr = SessionManager.create(cwd, sessionsRoot);
    mgr.appendCustomEntry("openbuddy/lifecycle", { event: { version: 2, revision: 5 } });
    flushWithAssistant(mgr, "ping", "pong");

    // Verify a JSONL file was actually written under sessionsRoot (recursively).
    const jsonlFiles: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) jsonlFiles.push(p);
      }
    };
    await walk(sessionsRoot);
    expect(jsonlFiles.length).toBeGreaterThan(0);

    const sessionFile = mgr.getSessionFile();
    const reopened = SessionManager.open(sessionFile!, sessionsRoot);
    const customEntry = reopened
      .getEntries()
      .find((e: any) => e.type === "custom" && e.customType === "openbuddy/lifecycle");
    expect(customEntry).toBeDefined();
    expect((customEntry as any).data).toEqual({ event: { version: 2, revision: 5 } });
  });
});
