import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Context } from "@openbuddy/cordis";
import { mountTeam, type TeamRunner } from "./index";
import { openStorage, TeamCatalog } from "@openbuddy/storage";

describe("team service", () => {
  it("runs members through the injected Pi runner and persists results", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-team-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = home;
    try {
      const ctx = new Context();
      const calls: string[] = [];
      ctx.provide("teamTenantContext", { getActiveTenantId: () => "tenant-a", canUseTeamWorkspace: () => true });
      const runner: TeamRunner = { runMember: async ({ role }) => { calls.push(role); return `result:${role}`; } };
      ctx.provide("teamRunner", runner);
      const team = mountTeam(ctx);
      const created = await team.create("inspect the repository", "small");
      await vi.waitFor(async () => {
          const status = await team.status(created.id);
          expect(status?.status).toBe("completed");
      }, { timeout: 2_000, interval: 10 });
      const status = await team.status(created.id);
      expect(calls).toHaveLength(2);
      expect(status?.status).toBe("completed");
      expect(status?.members.every((member) => member.status === "done")).toBe(true);
      expect(await readFile(join(home, "openbuddy-teams.json"), "utf8")).toContain("result:");
      const storage = await openStorage({ filePath: join(home, "openbuddy.sqlite") });
      try {
        expect(await new TeamCatalog({ databasePath: join(home, "openbuddy.sqlite"), legacyPath: join(home, "openbuddy-teams.json") }).get(created.id)).toMatchObject({ id: created.id, status: "completed" });
      } finally {
        storage.driver.close();
      }
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });

  it("isolates team records by the trusted active tenant", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-team-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = home;
    let activeTenantId = "tenant-a";
    try {
      const ctx = new Context();
      ctx.provide("teamTenantContext", { getActiveTenantId: () => activeTenantId, canUseTeamWorkspace: () => true });
      const team = mountTeam(ctx);
      const created = await team.create("tenant-scoped goal", "small");

      expect(created.tenantId).toBe("tenant-a");
      expect((await team.status(created.id))?.tenantId).toBe("tenant-a");

      activeTenantId = "tenant-b";
      expect(await team.status(created.id)).toBeUndefined();
      expect(await team.deleteTeam(created.id)).toBe(false);

      activeTenantId = "tenant-a";
      expect(await team.deleteTeam(created.id)).toBe(true);
      expect((await team.status(created.id))?.status).toBe("deleted");
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });

  it("rejects team access without a trusted tenant", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-team-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = home;
    try {
      const ctx = new Context();
      ctx.provide("teamTenantContext", { getActiveTenantId: () => undefined, canUseTeamWorkspace: () => true });
      const team = mountTeam(ctx);
      await expect(team.create("must be denied", "small")).rejects.toThrow("未选择有效租户");
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });

  it("enforces resource actions through the tenant authorization boundary", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-team-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = home;
    const calls: string[] = [];
    try {
      const ctx = new Context();
      ctx.provide("teamTenantContext", {
        getActiveTenantId: () => "tenant-a",
        canUseTeamWorkspace: () => true,
        authorizeResource: async (request: { action: string; resourceId?: string }) => {
          calls.push(`${request.action}:${request.resourceId ?? "collection"}`);
          return request.action !== "create";
        },
      });
      const team = mountTeam(ctx);
      await expect(team.create("denied goal", "small")).rejects.toThrow("团队资源权限");
      expect(calls).toEqual(["create:collection"]);
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });

  it("keeps legacy local teams in the local tenant", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-team-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = home;
    try {
      const ctx = new Context();
      const team = mountTeam(ctx);
      const created = await team.create("local goal", "small");
      expect(created.tenantId).toBe("local");
      expect((await team.status(created.id))?.tenantId).toBe("local");
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });
});
