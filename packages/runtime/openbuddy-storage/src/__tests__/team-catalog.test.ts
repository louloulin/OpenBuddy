import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamCatalog } from "../sqlite/team-catalog";

describe("TeamCatalog", () => {
  let root = "";
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "openbuddy-team-catalog-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("imports legacy teams and keeps member status in SQLite", async () => {
    const legacyPath = join(root, "openbuddy-teams.json");
    const databasePath = join(root, "openbuddy.sqlite");
    await writeFile(legacyPath, JSON.stringify({
      "team-1": {
        id: "team-1", goal: "ship", size: "small", status: "active", createdAt: 1,
        members: [{ id: "member-1", role: "planner", status: "idle" }],
      },
    }));
    const first = new TeamCatalog({ databasePath, legacyPath });
    expect(await first.get("team-1")).toMatchObject({ id: "team-1", members: [{ id: "member-1", status: "idle" }] });
    await first.upsert({ id: "team-1", goal: "ship", size: "small", status: "completed", createdAt: 1, members: [{ id: "member-1", role: "planner", status: "done", output: "ok" }] });
    await first.close();
    const second = new TeamCatalog({ databasePath, legacyPath });
    expect(await second.get("team-1")).toMatchObject({ status: "completed", members: [{ status: "done", output: "ok" }] });
    await second.close();
  });
});
