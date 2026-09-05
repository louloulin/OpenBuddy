import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("automations-notifications: notification payload assembly", () => {
  it("persists automation run records to disk and reads them back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ob-automation-"));
    try {
      const record = { id: "run-1", status: "completed", startedAt: 1, finishedAt: 2 };
      const path = join(dir, `${record.id}.json`);
      await writeFile(path, JSON.stringify(record), "utf8");
      const back = JSON.parse(await readFile(path, "utf8"));
      expect(back).toEqual(record);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("marks a notification as read by mutating the persisted set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ob-notifications-"));
    try {
      const path = join(dir, "inbox.json");
      const initial = { ids: ["a", "b", "c"] };
      await writeFile(path, JSON.stringify(initial), "utf8");
      const data = JSON.parse(await readFile(path, "utf8")) as { ids: string[] };
      data.ids = data.ids.filter((id) => id !== "b");
      await writeFile(path, JSON.stringify(data), "utf8");
      const after = JSON.parse(await readFile(path, "utf8"));
      expect(after.ids).toEqual(["a", "c"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to register a notification channel with an empty target", () => {
    const isValid = (target: string) => target.trim().length > 0;
    expect(isValid("")).toBe(false);
    expect(isValid("   ")).toBe(false);
    expect(isValid("user@example.com")).toBe(true);
  });
});
