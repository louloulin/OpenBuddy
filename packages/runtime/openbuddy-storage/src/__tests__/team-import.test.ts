import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyFilesAdapter } from "../adapters/legacy-files";
import { DEFAULT_MIGRATIONS, MigrationRunner } from "../sqlite/migration";
import { SqliteDriver } from "../sqlite/driver";

let root = "";
let driver: SqliteDriver | undefined;
afterEach(async () => { driver?.close(); driver = undefined; await rm(root, { recursive: true, force: true }); root = ""; });

describe("legacy team projection", () => {
  it("imports openbuddy-teams.json into team and member tables", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-team-import-"));
    driver = new SqliteDriver({ filePath: join(root, "openbuddy.sqlite") });
    await new MigrationRunner({ steps: DEFAULT_MIGRATIONS }).run(driver);
    const path = join(root, "openbuddy-teams.json");
    await writeFile(path, JSON.stringify({ "team-1": {
      id: "team-1", goal: "Research", size: "small", status: "active", createdAt: 1,
      members: [{ id: "member-1", role: "planner", status: "idle" }],
    } }));
    const report = await new LegacyFilesAdapter(driver).importTeams(path);
    expect(report).toMatchObject({ imported: 1, skipped: 0, parseErrors: 0 });
    expect(driver.database.prepare("SELECT goal, status FROM teams WHERE team_id = 'team-1'").get()).toMatchObject({ goal: "Research", status: "active" });
    expect(driver.database.prepare("SELECT role FROM team_members WHERE team_id = 'team-1'").get()).toMatchObject({ role: "planner" });
  });
});
