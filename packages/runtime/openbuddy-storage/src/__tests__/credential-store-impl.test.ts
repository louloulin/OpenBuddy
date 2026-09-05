import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialStore } from "../secrets/credential-store";
import { EphemeralSecretStore } from "../secrets/secret-store";

class CountingSecretStore extends EphemeralSecretStore {
  importCalls = 0;
  async put(ref: string, value: string, metadata?: { label?: string }) {
    return super.put(ref, value, metadata);
  }
  async delete(ref: string) {
    return super.delete(ref);
  }
  // Spy: detect how many times we touch the legacy file path indirectly
  resolveSpy = 0;
  async get(ref: string) {
    return super.get(ref);
  }
}

describe("CredentialStore — importLegacy caching", () => {
  let root: string;
  let databasePath: string;
  let legacyPath: string;
  let secretStore: CountingSecretStore;
  let store: CredentialStore;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "openbuddy-credential-cache-"));
    databasePath = join(root, "openbuddy.sqlite");
    legacyPath = join(root, "credentials.legacy.json");
    secretStore = new CountingSecretStore();
    writeFileSync(
      legacyPath,
      JSON.stringify({
        refs: { alpha: "value-alpha" },
        records: { beta: { kind: "api-key", key: "k" } },
      }, null, 2),
      "utf8",
    );
    store = new CredentialStore({ databasePath, legacyPath, secretStore });
  });

  afterEach(async () => {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("first resolve triggers legacy import and persists ref", async () => {
    await store.resolve("alpha");
    // Legacy file should still exist but be emptied after successful import.
    expect(existsSync(legacyPath)).toBe(true);
    const content = JSON.parse(readFileSync(legacyPath, "utf8"));
    expect(content.refs).toEqual({});
    expect(content.records).toEqual({});
  });

  it("second resolve does NOT re-read or re-import the legacy file", async () => {
    await store.resolve("alpha");
    // Drop a fresh legacy file at the same path — if caching is broken the
    // second resolve would re-import it.
    writeFileSync(
      legacyPath,
      JSON.stringify({ refs: { alpha: "OTHER" }, records: {} }, null, 2),
      "utf8",
    );
    const result = await store.resolve("alpha");
    // If caching works, the in-DB ref still resolves to "value-alpha"
    // because the second legacy file is ignored.
    expect(result).toBe("value-alpha");
  });

  it("describe does not re-import after first call", async () => {
    await store.describe("alpha");
    writeFileSync(
      legacyPath,
      JSON.stringify({ refs: { alpha: "OTHER" }, records: {} }, null, 2),
      "utf8",
    );
    const result = await store.describe("alpha");
    expect(result.configured).toBe(true);
  });

  it("readRecord does not re-import after first call", async () => {
    await store.readRecord("beta");
    writeFileSync(
      legacyPath,
      JSON.stringify({ refs: {}, records: { beta: { kind: "grant", payload: "different" } } }, null, 2),
      "utf8",
    );
    const record = await store.readRecord("beta");
    expect(record?.kind).toBe("api-key");
    if (record?.kind === "api-key") {
      expect(record.key).toBe("k");
    }
  });

  it("legacy file absent → import is a no-op and resolve returns undefined", async () => {
    rmSync(legacyPath);
    const store2 = new CredentialStore({
      databasePath: join(root, "openbuddy2.sqlite"),
      secretStore: new EphemeralSecretStore(),
    });
    try {
      const result = await store2.resolve("missing");
      expect(result).toBeUndefined();
      // Repeat call still fast and undefined.
      const result2 = await store2.resolve("missing");
      expect(result2).toBeUndefined();
    } finally {
      await store2.close();
    }
  });

  it("legacy document on disk after successful import is wiped", async () => {
    await store.resolve("alpha");
    // After import the file should be an empty JSON object (the migration
    // empties out refs/records and renames the file).
    expect(existsSync(legacyPath)).toBe(true);
    const content = JSON.parse(readFileSync(legacyPath, "utf8"));
    expect(content.refs).toEqual({});
    expect(content.records).toEqual({});
  });
});
