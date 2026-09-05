import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyFilesAdapter } from "../adapters/legacy-files";
import { DEFAULT_MIGRATIONS, MigrationRunner } from "../sqlite/migration";
import { SqliteDriver } from "../sqlite/driver";
import { MemoryIndex } from "../sqlite/memory";
import { SettingsRegistry } from "../sqlite/settings";
import { SettingsDocumentStore } from "../sqlite/settings-document";

let root = "";
let driver: SqliteDriver | undefined;
afterEach(async () => { driver?.close(); driver = undefined; await rm(root, { recursive: true, force: true }); root = ""; });

async function open(): Promise<LegacyFilesAdapter> {
  root = await mkdtemp(join(tmpdir(), "openbuddy-legacy-files-"));
  driver = new SqliteDriver({ filePath: join(root, "openbuddy.sqlite") });
  await new MigrationRunner({ steps: DEFAULT_MIGRATIONS }).run(driver);
  return new LegacyFilesAdapter(driver, () => "2026-08-30T02:00:00.000Z");
}

describe("LegacyFilesAdapter", () => {
  it("imports and persists namespaced settings through the SQLite document store", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-settings-document-"));
    driver = new SqliteDriver({ filePath: join(root, "openbuddy.sqlite") });
    await new MigrationRunner({ steps: DEFAULT_MIGRATIONS }).run(driver);
    const path = join(root, "dsh-settings.json");
    await writeFile(path, JSON.stringify({ agent: { model: "deepseek-chat" } }));
    const store = new SettingsDocumentStore(driver);
    await store.importLegacy(path);
    expect(store.get("agent")).toEqual({ model: "deepseek-chat" });
    store.set("agent", { model: "deepseek-reasoner" });
    expect(new SettingsDocumentStore(driver).get("agent")).toEqual({ model: "deepseek-reasoner" });
  });

  it("imports settings without persisting secrets in the projection", async () => {
    const adapter = await open();
    const path = join(root, "dsh-settings.json");
    await writeFile(path, JSON.stringify({ model: "deepseek-chat", apiKey: "secret-value" }));
    const report = await adapter.importSettings(path, "deepseek");
    expect(report).toMatchObject({ imported: 2, parseErrors: 0 });
    const setting = new SettingsRegistry(driver!).get("deepseek", "apiKey");
    expect(setting?.value).toBe("[redacted]");
  });

  it("imports legacy JSONL events idempotently and isolates malformed rows", async () => {
    const adapter = await open();
    const path = join(root, "events.jsonl");
    await writeFile(path, [
      JSON.stringify({ sequence: 1, type: "session/input", payload: { text: "hello" } }),
      "not-json",
      JSON.stringify({ sequence: 2, type: "agent/settled", payload: { ok: true } }),
    ].join("\n"));
    const first = await adapter.importEventLog(path, "session-1");
    const second = await adapter.importEventLog(path, "session-1");
    expect(first).toMatchObject({ imported: 2, parseErrors: 1 });
    expect(second).toMatchObject({ imported: 0, skipped: 2, parseErrors: 1 });
  });

  it("imports Markdown as a rebuildable FTS projection", async () => {
    const adapter = await open();
    const path = join(root, "MEMORY.md");
    await writeFile(path, "# Project Memory\n\nSQLite migration uses a shadow projection.\n");
    await expect(adapter.importMarkdown(path, "memory-1")).resolves.toMatchObject({ imported: 1, parseErrors: 0 });
    expect(new MemoryIndex(driver!).search("shadow projection")).toEqual([
      expect.objectContaining({ documentId: "memory-1", title: "Project Memory" }),
    ]);
  });

  it("reports missing legacy sources without treating read failures as imported state", async () => {
    const adapter = await open();
    await expect(adapter.importSettings(join(root, "missing-settings.json"), "fixture")).resolves.toMatchObject({ sourceStatus: "missing", imported: 0, parseErrors: 0 });
  });
});
