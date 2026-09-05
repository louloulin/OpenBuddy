import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuddyIdentityStore, resetBuddyIdentityStore } from "./buddy-identity-store";

describe("BuddyIdentityStore", () => {
  let root: string;
  let filePath: string;
  let store: BuddyIdentityStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "openbuddy-buddy-identity-"));
    filePath = join(root, "buddy-identity.json");
    store = new BuddyIdentityStore(filePath);
    resetBuddyIdentityStore();
  });

  it("mints a stable identity with UUID on first launch", async () => {
    const created = store.loadOrCreate(() => new Date("2026-08-31T00:00:00.000Z"));
    await store.flush();
    expect(created.id).toMatch(/^buddy-[0-9a-f-]{36}$/u);
    expect(created.ownerUserId).toMatch(/^user-[0-9a-f-]{36}$/u);
    expect(created.handle).toBe("me");
    expect(created.displayName).toBe("我的 Buddy");
    expect(created.trustLevel).toBe("local");
    expect(created.createdAt).toBe("2026-08-31T00:00:00.000Z");
    expect(readFileSync(filePath, "utf8")).toContain(created.id);
  });

  it("returns the same identity on subsequent loads", async () => {
    const first = store.loadOrCreate();
    const second = store.loadOrCreate();
    expect(second).toEqual(first);
  });

  it("updates handle/displayName and bumps updatedAt", async () => {
    const created = store.loadOrCreate(() => new Date("2026-08-31T00:00:00.000Z"));
    const updated = store.updateIdentity({ handle: "researcher", displayName: "研究员 Buddy" }, () => new Date("2026-08-31T01:00:00.000Z"));
    await store.flush();
    expect(updated.handle).toBe("researcher");
    expect(updated.displayName).toBe("研究员 Buddy");
    expect(updated.id).toBe(created.id);
    expect(updated.ownerUserId).toBe(created.ownerUserId);
    expect(updated.updatedAt).toBe("2026-08-31T01:00:00.000Z");
    const reloadedStore = new BuddyIdentityStore(filePath);
    await reloadedStore.flush();
    const reloaded = reloadedStore.loadOrCreate();
    expect(reloaded.handle).toBe("researcher");
  });

  it("ignores empty patches and keeps the previous value", async () => {
    const created = store.loadOrCreate();
    const updated = store.updateIdentity({ handle: "  " });
    expect(updated.handle).toBe(created.handle);
  });

  it("renames a corrupt file to .corrupt and mints a fresh identity", async () => {
    writeFileSync(filePath, "{ this is not json", "utf8");
    const recovered = store.loadOrCreate(() => new Date("2026-08-31T02:00:00.000Z"));
    await store.flush();
    expect(recovered.id).toMatch(/^buddy-/u);
    expect(recovered.createdAt).toBe("2026-08-31T02:00:00.000Z");
  });

  it("converts to BuddyIdentity correctly", async () => {
    const file = store.loadOrCreate();
    const identity = store.toBuddyIdentity(file);
    expect(identity).toEqual({
      id: file.id,
      handle: file.handle,
      displayName: file.displayName,
      ownerUserId: file.ownerUserId,
      organizationId: file.organizationId,
      trustLevel: file.trustLevel,
      status: file.status,
    });
  });

  it("renames an incomplete identity file and mints a fresh one", async () => {
    writeFileSync(filePath, JSON.stringify({ id: "buddy-x" }), "utf8");
    const recovered = store.loadOrCreate(() => new Date("2026-08-31T03:00:00.000Z"));
    await store.flush();
    expect(recovered.id).toMatch(/^buddy-/u);
    expect(recovered.handle).toBe("me");
  });
});
