import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CalendarCatalog } from "../index";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("CalendarCatalog", () => {
  it("imports legacy JSON once, persists updates, and writes a compatibility mirror", async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "openbuddy-calendar-storage-"));
    roots.push(root);
    const legacyPath = join(root, "openbuddy-calendar.json");
    const databasePath = join(root, "openbuddy.sqlite");
    const event = { id: "cal-1", title: "迁移", start: "2026-08-30T02:00:00.000Z", end: "2026-08-30T03:00:00.000Z", allDay: false, status: "confirmed" as const, roomId: "room-a", contextRefs: ["project:a"], attendees: [], createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" };
    await writeFile(legacyPath, JSON.stringify({ events: [event] }));
    const first = new CalendarCatalog({ databasePath, legacyPath, mirrorPath: legacyPath });
    await expect(first.list({ contextRef: "project:a" })).resolves.toEqual([event]);
    await first.close();
    const second = new CalendarCatalog({ databasePath, legacyPath, mirrorPath: legacyPath });
    await second.upsert({ ...event, title: "SQLite 权威" });
    await second.close();
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toMatchObject({ events: [{ title: "SQLite 权威" }] });
    const third = new CalendarCatalog({ databasePath, legacyPath });
    await expect(third.list()).resolves.toMatchObject([{ title: "SQLite 权威" }]);
    expect(await third.remove("cal-1", "room-a")).toBe(true);
    expect(await third.remove("cal-1")).toBe(false);
    await third.close();
  });

  it("surfaces malformed legacy documents without marking the import complete", async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "openbuddy-calendar-legacy-error-"));
    roots.push(root);
    const legacyPath = join(root, "openbuddy-calendar.json");
    const databasePath = join(root, "openbuddy.sqlite");
    await writeFile(legacyPath, JSON.stringify({ events: { invalid: true } }));
    const catalog = new CalendarCatalog({ databasePath, legacyPath });
    await expect(catalog.list()).rejects.toThrow("calendar legacy import failed");
    await catalog.close();
  });
});
