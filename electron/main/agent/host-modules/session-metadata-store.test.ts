import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionMetadataStore } from "./session-metadata-store";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbuddy-session-metadata-"));
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  // The SQLite driver owns its connection for the process lifetime;
  // each test uses a unique temporary database, so no shared state leaks.
});

describe("SessionMetadataStore", () => {
  it("migrates the legacy JSON mirror and removes it after success", async () => {
    const legacy = join(root, "openbuddy-state.json");
    const database = join(root, "openbuddy.sqlite");
    await writeFile(legacy, JSON.stringify({
      pinned: ["session-a", 42],
      archived: ["session-b"],
      experts: {
        "session-a": { expertId: "expert-1", expertName: "Architect", avatarLocal: "/avatar.png" },
        invalid: { expertId: 1 },
      },
    }));

    const store = new SessionMetadataStore({ databasePath: database, legacyJsonPath: legacy });
    await expect(store.snapshot()).resolves.toEqual({
      pinned: ["session-a"],
      archived: ["session-b"],
      experts: {
        "session-a": { expertId: "expert-1", expertName: "Architect", avatarLocal: "/avatar.png" },
      },
    });
    await expect(stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(database)).resolves.toBeTruthy();
  });

  it("preserves SQLite data when a legacy mirror remains after a restart", async () => {
    const legacy = join(root, "openbuddy-state.json");
    const database = join(root, "openbuddy.sqlite");
    const first = new SessionMetadataStore({ databasePath: database, legacyJsonPath: legacy });
    await first.updateMetadata((snapshot) => {
      snapshot.pinned.push("sqlite-session");
      snapshot.experts["sqlite-session"] = { expertId: "expert-2", expertName: "Builder" };
    });
    await writeFile(legacy, JSON.stringify({ pinned: ["stale-session"] }));

    const restarted = new SessionMetadataStore({ databasePath: database, legacyJsonPath: legacy });
    await expect(restarted.snapshot()).resolves.toMatchObject({
      pinned: ["sqlite-session"],
      experts: { "sqlite-session": { expertId: "expert-2", expertName: "Builder" } },
    });
    await expect(readFile(legacy, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deletes expert rows when metadata removes an expert", async () => {
    const store = new SessionMetadataStore({
      databasePath: join(root, "openbuddy.sqlite"),
      legacyJsonPath: join(root, "missing-state.json"),
    });
    await store.updateMetadata((snapshot) => {
      snapshot.experts.one = { expertId: "expert-1", expertName: "One" };
    });
    await store.updateMetadata((snapshot) => {
      delete snapshot.experts.one;
    });
    await expect(store.getExpert("one")).resolves.toBeUndefined();
  });

  it("clears all metadata rows", async () => {
    const store = new SessionMetadataStore({
      databasePath: join(root, "openbuddy.sqlite"),
      legacyJsonPath: join(root, "missing-state.json"),
    });
    await store.updateMetadata((snapshot) => {
      snapshot.pinned.push("one");
      snapshot.archived.push("two");
      snapshot.experts.three = { expertId: "expert-3", expertName: "Three" };
    });
    await store.clearAll();
    await expect(store.snapshot()).resolves.toEqual({ pinned: [], archived: [], experts: {} });
  });
});
