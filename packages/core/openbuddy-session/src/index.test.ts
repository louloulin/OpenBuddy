import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Context } from "@openbuddy/cordis";
import { openStorage, SessionCatalog } from "@openbuddy/storage";
import { mountSession, sessionsHandlers } from "./index";

describe.sequential("core-session: Pi session metadata", () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "openbuddy-core-session-"));
    previousHome = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = home;
    const sessionsRoot = join(home, "sessions", "abc-cwd");
    await mkdir(sessionsRoot, { recursive: true });
		await writeFile(join(sessionsRoot, "session-1.jsonl"), `${JSON.stringify({ type: "session", id: "session-1", cwd: "abc-cwd", name: "First session", timestamp: "2026-01-01T00:00:00.000Z" })}\n`, "utf-8");
		await writeFile(join(sessionsRoot, "session-2.jsonl"), `${JSON.stringify({ type: "session", id: "session-2", cwd: "abc-cwd", name: "Other session" })}\n`, "utf-8");
		await writeFile(join(sessionsRoot, "session-3.jsonl"), `${JSON.stringify({ type: "session", id: "session-3", cwd: "/tmp/other-workspace", name: "Remote session" })}\n`, "utf-8");
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  it("lists, pins, archives, binds experts, and persists state", async () => {
    const ctx = new Context();
    const session = mountSession(ctx);
    await ctx.lifecycle.start();
    await new Promise((resolve) => setImmediate(resolve));

		const initial = await sessionsHandlers.listSessions("abc-cwd");
		expect(initial.map((entry) => entry.sessionId).sort()).toEqual(["session-1", "session-2"]);
		expect(initial.find((entry) => entry.sessionId === "session-1")).toMatchObject({ title: "First session", cwd: "abc-cwd" });

    await sessionsHandlers.setPinned("session-2", true);
    const pinned = await sessionsHandlers.listSessions("abc-cwd");
    expect(pinned[0]?.sessionId).toBe("session-2");
    expect(pinned[0]?.pinned).toBe(true);

    // R2.5 — archiving keeps the row in the list with archived=true so the
    // Sidebar's 已归档 group + 恢复 action can recover it.
    await sessionsHandlers.setArchived("session-2", true);
    const afterArchive = await sessionsHandlers.listSessions("abc-cwd");
    expect(afterArchive.map((entry) => entry.sessionId).sort()).toEqual(["session-1", "session-2"]);
    expect(afterArchive.find((entry) => entry.sessionId === "session-2")?.archived).toBe(true);
    expect(afterArchive.find((entry) => entry.sessionId === "session-1")?.archived).toBe(false);
    await sessionsHandlers.setArchived("session-2", false);
    expect((await sessionsHandlers.listSessions("abc-cwd")).find((entry) => entry.sessionId === "session-2")?.archived).toBe(false);

    await sessionsHandlers.setExpert("session-1", {
      expertId: "expert-42",
      expertName: "Research Lead",
      avatarLocal: "/tmp/research.png",
    });
    const bound = (await session.list("abc-cwd")).find((entry) => entry.sessionId === "session-1");
    expect(bound).toMatchObject({
      expertId: "expert-42",
      expertName: "Research Lead",
      expertAvatar: "/tmp/research.png",
    });

    const state = JSON.parse(await readFile(join(home, "openbuddy-state.json"), "utf-8"));
    expect(state.pinned).toContain("session-2");
    expect(state.experts["session-1"].expertId).toBe("expert-42");

    const storage = await openStorage({ filePath: join(home, "openbuddy.sqlite") });
    try {
      expect(new SessionCatalog(storage.driver).get("session-2")).toMatchObject({ pinned: true, archived: false });
      expect(new SessionCatalog(storage.driver).get("session-1")).toMatchObject({ expertId: "expert-42" });
    } finally {
      storage.driver.close();
    }

    await rm(join(home, "openbuddy-state.json"), { force: true });
    const authorityCheck = await openStorage({ filePath: join(home, "openbuddy.sqlite") });
    try {
      expect(new SessionCatalog(authorityCheck.driver).get("session-1")).toMatchObject({ expertId: "expert-42" });
    } finally {
      authorityCheck.driver.close();
    }

		const workspaces = await sessionsHandlers.listWorkspaces();
		expect(workspaces).toEqual(expect.arrayContaining([
			expect.objectContaining({ cwd: "abc-cwd", sessionCount: 2, lastTitle: "Other session" }),
		expect.objectContaining({ cwd: "/tmp/other-workspace", sessionCount: 1, lastTitle: "Remote session" }),
		]));
  });

  it("does not silently fall back to JSON for an unknown SQLite session", async () => {
    const ctx = new Context();
    mountSession(ctx);
    await ctx.lifecycle.start();
    await new Promise((resolve) => setImmediate(resolve));

    await expect(sessionsHandlers.setPinned("missing-session", true)).rejects.toThrow("SQLite session not found");
    await expect(readFile(join(home, "openbuddy-state.json"), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
