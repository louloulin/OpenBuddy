import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorageSync } from "../sqlite/open-storage";
import { SettingsDocumentStore } from "../sqlite/settings-document";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("SettingsDocumentStore", () => {
  it("round-trips values through set + get", () => {
    root = mkdtempSync(join(tmpdir(), "settings-document-roundtrip-"));
    const store = new SettingsDocumentStore(openStorageSync({ filePath: join(root, "profile.sqlite") }).driver);
    store.set("casdoor:config", { issuer: "https://casdoor.test", clientId: "client" });
    expect(store.get("casdoor:config")).toEqual({ issuer: "https://casdoor.test", clientId: "client" });
  });

  it("delete() removes a namespace and returns true when present", () => {
    root = mkdtempSync(join(tmpdir(), "settings-document-delete-"));
    const store = new SettingsDocumentStore(openStorageSync({ filePath: join(root, "profile.sqlite") }).driver);
    store.set("casdoor:webhook-subscriptions", { casdoorSubscriptions: { "issuer::tenant-a": ["user.update"] }, schemaVersion: 1 });
    expect(store.get("casdoor:webhook-subscriptions")).toMatchObject({ casdoorSubscriptions: { "issuer::tenant-a": ["user.update"] } });
    expect(store.delete("casdoor:webhook-subscriptions")).toBe(true);
    expect(store.get("casdoor:webhook-subscriptions")).toEqual({});
    // Deleting a non-existent namespace returns false but does not throw.
    expect(store.delete("casdoor:does-not-exist")).toBe(false);
  });

  it("list() returns the full document", () => {
    root = mkdtempSync(join(tmpdir(), "settings-document-list-"));
    const store = new SettingsDocumentStore(openStorageSync({ filePath: join(root, "profile.sqlite") }).driver);
    store.set("casdoor:config", { issuer: "https://casdoor.test" });
    store.set("casdoor:session", { refreshToken: "enc:rt", provider: "default" });
    expect(store.list()).toEqual({
      "casdoor:config": { issuer: "https://casdoor.test" },
      "casdoor:session": { refreshToken: "enc:rt", provider: "default" },
    });
  });
});
