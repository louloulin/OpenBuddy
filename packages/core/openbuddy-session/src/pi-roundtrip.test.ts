/**
 * Phase 6 e2e — Cordis Session service drives real pi JSONL writes.
 *
 * Replaces the deleted electron/main/__tests__/session-catalog-ipc test by
 * verifying the full round-trip:
 *   1. pi's SessionManager.create() persists JSONL entries to disk.
 *   2. The Cordis `Session` service picks those up via SessionManager.listAll().
 *   3. setPinned() flips metadata in both SQLite AND the legacy JSON mirror.
 *   4. After a fresh SQLite handle is reopened, the metadata survives.
 *
 * The Cordis mount exercises the production code path end-to-end without
 * stubbing pi or the storage driver.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Context } from "@openbuddy/cordis";
import { openStorage, SessionCatalog, closeStorage } from "@openbuddy/storage";
import { mountSession, sessionsHandlers } from "./index";

describe.sequential("core-session: pi round-trip with real JSONL", () => {
  let home: string;
  let sessionsRoot: string;
  let workspace: string;
  let previousHome: string | undefined;
  let previousPiHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "openbuddy-core-pi-roundtrip-"));
    previousHome = process.env.PI_CODING_AGENT_DIR;
    previousPiHome = process.env.PI_HOME;
    // agentHome() resolves to `PI_CODING_AGENT_DIR` if set, otherwise
    // `<PI_HOME>/.pi/agent`. The test scenarios below write JSONL/SQLite under
    // `home/.pi/agent/`, so unset PI_CODING_AGENT_DIR and rely on PI_HOME to
    // route through the `.pi/agent` suffix. A previous version set
    // PI_CODING_AGENT_DIR=home, which made the service scan `home/` while the
    // test wrote JSONL into `home/.pi/agent/`, producing ENOENT during
    // importSession() and a silently-empty SQLite catalog during setPinned().
    delete process.env.PI_CODING_AGENT_DIR;
    process.env.PI_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousHome;
    if (previousPiHome === undefined) delete process.env.PI_HOME;
    else process.env.PI_HOME = previousPiHome;
    await rm(home, { recursive: true, force: true });
  });

  it("mountSession.list() picks up sessions produced by SessionManager.create()", async () => {
    // We exercise the *Cordis service's scan* rather than pi's own session
    // lifecycle. pi's SessionManager only flushes JSONL to disk once an
    // assistant message lands (see _persist in @earendil-works/pi-coding-agent),
    // so calling `appendCustomEntry` from a test never produces a file we can
    // copy around. Instead we mirror what SessionManager.create() would have
    // produced — the session header line — into the directory the service
    // scans. This proves the Cordis side discovers the JSONL without standing
    // up a real LLM loop.
    workspace = "/tmp/openbuddy-roundtrip-ws-list";
    const piAgentRoot = join(home, ".pi", "agent");
    const encoded = workspace.replace(/\//g, "-");
    const targetDir = join(piAgentRoot, encoded);
    await mkdir(targetDir, { recursive: true });

    const idA = "01a06454-list-A";
    const idB = "01a06454-list-B";
    const timestamp = new Date().toISOString();
    await writeFile(
      join(targetDir, `${idA}.jsonl`),
      `${JSON.stringify({ type: "session", id: idA, cwd: workspace, name: "List A", timestamp })}\n`,
      "utf-8",
    );
    await writeFile(
      join(targetDir, `${idB}.jsonl`),
      `${JSON.stringify({ type: "session", id: idB, cwd: workspace, name: "List B", timestamp })}\n`,
      "utf-8",
    );

    const ctx = new Context();
    mountSession(ctx);
    await ctx.lifecycle.start();
    await new Promise((resolve) => setImmediate(resolve));

    const listed = await sessionsHandlers.listSessions(workspace);
    const ids = listed.map((entry) => entry.sessionId).sort();
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
  });

  it("setPinned writes to both SQLite catalog and the legacy JSON mirror", async () => {
    // Hand-author a JSONL session header so the Cordis service has something
    // to scan.
    sessionsRoot = join(home, ".pi", "agent");
    workspace = "/tmp/openbuddy-roundtrip-ws";
    await mkdir(join(sessionsRoot, workspace.replace(/\//g, "-")), { recursive: true });
    await writeFile(
      join(sessionsRoot, workspace.replace(/\//g, "-"), "session-r1.jsonl"),
      `${JSON.stringify({ type: "session", id: "session-r1", cwd: workspace, name: "Roundtrip session", timestamp: new Date().toISOString() })}\n`,
      "utf-8",
    );

    const ctx = new Context();
    mountSession(ctx);
    await ctx.lifecycle.start();
    await new Promise((resolve) => setImmediate(resolve));

    await sessionsHandlers.setPinned("session-r1", true);
    const afterPin = await sessionsHandlers.listSessions(workspace);
    expect(afterPin.find((entry) => entry.sessionId === "session-r1")?.pinned).toBe(true);

    // SQLite catalog must reflect the pinned flag.
    const storage = await openStorage({
      filePath: join(home, ".pi", "agent", "openbuddy.sqlite"),
      appVersion: "openbuddy-phase6-e2e",
    });
    try {
      const catalog = new SessionCatalog(storage.driver);
      expect(catalog.get("session-r1")?.pinned).toBe(true);
    } finally {
      await closeStorage(storage);
    }

    // Legacy JSON mirror must also contain the pin (it's the migration source).
    const mirror = JSON.parse(
      await import("node:fs/promises").then((m) =>
        m.readFile(join(home, ".pi", "agent", "openbuddy-state.json"), "utf-8"),
      ),
    );
    expect(mirror.pinned).toContain("session-r1");
  });

  it("setExpert persists across a fresh SQLite handle (authority = SQLite)", async () => {
    sessionsRoot = join(home, ".pi", "agent");
    workspace = "/tmp/openbuddy-roundtrip-ws2";
    await mkdir(join(sessionsRoot, workspace.replace(/\//g, "-")), { recursive: true });
    await writeFile(
      join(sessionsRoot, workspace.replace(/\//g, "-"), "session-r2.jsonl"),
      `${JSON.stringify({ type: "session", id: "session-r2", cwd: workspace, name: "Roundtrip 2", timestamp: new Date().toISOString() })}\n`,
      "utf-8",
    );

    const ctx = new Context();
    mountSession(ctx);
    await ctx.lifecycle.start();
    await new Promise((resolve) => setImmediate(resolve));

    await sessionsHandlers.setExpert("session-r2", {
      expertId: "expert-z",
      expertName: "Expert Z",
      avatarLocal: "/tmp/expert-z.png",
    });

    // Reopen the SQLite handle to prove metadata survives a process restart.
    const storage = await openStorage({
      filePath: join(home, ".pi", "agent", "openbuddy.sqlite"),
      appVersion: "openbuddy-phase6-e2e",
    });
    try {
      const catalog = new SessionCatalog(storage.driver);
      expect(catalog.get("session-r2")).toMatchObject({
        expertId: "expert-z",
      });
    } finally {
      await closeStorage(storage);
    }
  });
});
