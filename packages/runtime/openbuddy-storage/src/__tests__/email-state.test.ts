import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EmailStateStore } from "../sqlite/email-state";

describe("EmailStateStore", () => {
  const stores: EmailStateStore[] = [];
  let root = "";

  afterEach(async () => {
    for (const store of stores.splice(0)) await store.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("imports legacy JSON once, persists SQLite authority, and mirrors writes", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-email-state-"));
    const legacyPath = join(root, "openbuddy-email.json");
    const databasePath = join(root, "openbuddy.sqlite");
    await writeFile(legacyPath, JSON.stringify({ drafts: [{ id: "draft-1", body: "private" }], tags: [{ id: "tag-1", name: "客户" }] }));
    const first = new EmailStateStore({ databasePath, legacyPath, mirrorPath: legacyPath });
    stores.push(first);
    await expect(first.read()).resolves.toMatchObject({ drafts: [{ id: "draft-1" }], tags: [{ id: "tag-1" }] });
    await first.write({ ...(await first.read()), drafts: [{ id: "draft-2", body: "updated" }] });
    await expect(readFile(legacyPath, "utf8")).resolves.toContain("draft-2");

    const restarted = new EmailStateStore({ databasePath, legacyPath, mirrorPath: legacyPath });
    stores.push(restarted);
    await expect(restarted.read()).resolves.toMatchObject({ drafts: [{ id: "draft-2", body: "updated" }] });
  });

  it("surfaces malformed legacy state instead of importing an empty document", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-email-legacy-error-"));
    const legacyPath = join(root, "openbuddy-email.json");
    const databasePath = join(root, "openbuddy.sqlite");
    await writeFile(legacyPath, JSON.stringify({ drafts: { invalid: true } }));
    const store = new EmailStateStore({ databasePath, legacyPath });
    stores.push(store);
    await expect(store.read()).rejects.toThrow("email legacy import failed");
  });
});
