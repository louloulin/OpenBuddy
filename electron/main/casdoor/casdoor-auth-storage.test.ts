import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorageSync, SettingsDocumentStore } from "@openbuddy/storage";

const userData = mkdtempSync(join(tmpdir(), "casdoor-auth-storage-"));

vi.mock("electron", () => ({
  app: {
    getPath: () => userData,
    setAsDefaultProtocolClient: () => undefined,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
  },
  shell: { openExternal: vi.fn() },
}));

import { casdoorAuth, CasdoorAuthService, resetAuthSettingsStoreForTests } from "./casdoor-auth";

function openAuthSettingsStoreForTests(): SettingsDocumentStore {
  const opened = openStorageSync({ filePath: join(userData, "openbuddy.sqlite"), appVersion: "openbuddy-casdoor-auth" });
  return new SettingsDocumentStore(opened.driver);
}

function stubRefresh(service: CasdoorAuthService): void {
  // Prevent loadPersistedSession() from calling the real network during refresh().
  vi.spyOn(service as unknown as { refresh: () => Promise<unknown> }, "refresh").mockResolvedValue(undefined);
}

beforeEach(() => {
  resetAuthSettingsStoreForTests();
  const store = openAuthSettingsStoreForTests();
  store.delete("casdoor:config");
  store.delete("casdoor:session");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(userData, { recursive: true, force: true });
});

describe("casdoor-auth SettingsDocumentStore-backed persistence", () => {
  it("persists config via SQLite and re-reads identical values after a reload", async () => {
    const config = await casdoorAuth.saveConfig({
      issuer: "https://casdoor.test",
      clientId: "new-client-id",
      redirectUri: "casdoor://localhost/callback",
      managementUrl: "https://casdoor.test/",
    });
    expect(config.configured).toBe(true);

    const stored = openAuthSettingsStoreForTests().get("casdoor:config");
    expect(stored).toMatchObject({
      issuer: "https://casdoor.test",
      clientId: "new-client-id",
      redirectUri: "casdoor://localhost/callback",
      managementUrl: "https://casdoor.test/",
    });

    const fresh = new CasdoorAuthService();
    stubRefresh(fresh);
    await fresh.init();
    expect(fresh.getConfig()).toMatchObject({
      issuer: "https://casdoor.test",
      clientId: "configured",
      configured: true,
      managementUrl: "https://casdoor.test/",
    });
  });

  it("consumes legacy JSON config on first read and unlinks it", async () => {
    const legacy = join(userData, "casdoor-config.json");
    writeFileSync(
      legacy,
      JSON.stringify({
        issuer: "https://casdoor.legacy",
        clientId: "legacy-client",
        redirectUri: "casdoor://localhost/callback",
        managementUrl: "https://casdoor.legacy/",
      }),
      { encoding: "utf8", mode: 0o600 },
    );

    const fresh = new CasdoorAuthService();
    stubRefresh(fresh);
    await fresh.init();
    const config = fresh.getConfig();
    expect(config.issuer).toBe("https://casdoor.legacy");
    expect(config.configured).toBe(true);
    expect(existsSync(legacy)).toBe(false);

    const stored = openAuthSettingsStoreForTests().get("casdoor:config");
    expect(stored).toMatchObject({
      issuer: "https://casdoor.legacy",
      clientId: "legacy-client",
    });
  });

  it("persists the encrypted session blob via SQLite and re-reads identical state", async () => {
    await casdoorAuth.saveConfig({
      issuer: "https://casdoor.test",
      clientId: "new-client-id",
      redirectUri: "casdoor://localhost/callback",
      managementUrl: "https://casdoor.test/",
    });

    const internal = casdoorAuth as unknown as {
      refreshToken: string | null;
      expiresAt: number | undefined;
      provider: string | undefined;
      activeTenantId: string | undefined;
    };
    internal.refreshToken = "rt-blob";
    internal.expiresAt = Date.now() + 60_000;
    internal.provider = "default";
    internal.activeTenantId = "tenant-a";
    await (casdoorAuth as unknown as { persistSession: () => Promise<void> }).persistSession();

    const stored = openAuthSettingsStoreForTests().get("casdoor:session");
    expect((stored as { refreshToken?: string })?.refreshToken).toBeTruthy();
    expect(stored).toMatchObject({
      provider: "default",
      activeTenantId: "tenant-a",
    });
    // Decrypting the stored blob yields the original refresh token (enc:rt-blob → rt-blob).
    const storedBlob = (stored as { refreshToken: string }).refreshToken;
    expect(Buffer.from(storedBlob, "base64").toString("utf8")).toBe("enc:rt-blob");

    // Reset in-memory state and re-read from SQLite.
    internal.refreshToken = null;
    internal.expiresAt = undefined;
    internal.provider = undefined;
    internal.activeTenantId = undefined;
    stubRefresh(casdoorAuth);
    await (casdoorAuth as unknown as { loadPersistedSession: () => Promise<void> }).loadPersistedSession();
    expect(internal.refreshToken).toBe("rt-blob");
    expect(internal.provider).toBe("default");
    expect(internal.activeTenantId).toBe("tenant-a");
  });

  it("consumes legacy JSON session on first read and unlinks it", async () => {
    const legacy = join(userData, "casdoor-session.json");
    const legacyBlob = Buffer.from("enc:legacy-rt", "utf8").toString("base64");
    writeFileSync(
      legacy,
      JSON.stringify({
        refreshToken: legacyBlob,
        expiresAt: Date.now() + 60_000,
        provider: "sms",
        activeTenantId: "tenant-z",
      }),
      { encoding: "utf8", mode: 0o600 },
    );

    stubRefresh(casdoorAuth);
    await (casdoorAuth as unknown as { loadPersistedSession: () => Promise<void> }).loadPersistedSession();
    expect(existsSync(legacy)).toBe(false);

    const stored = openAuthSettingsStoreForTests().get("casdoor:session");
    expect(stored).toMatchObject({
      refreshToken: legacyBlob,
      provider: "sms",
      activeTenantId: "tenant-z",
    });
  });

  it("clearSession removes the persisted session namespace", async () => {
    const internal = casdoorAuth as unknown as {
      refreshToken: string | null;
      expiresAt: number | undefined;
      provider: string | undefined;
      activeTenantId: string | undefined;
    };
    internal.refreshToken = "rt-blob";
    internal.expiresAt = Date.now() + 60_000;
    internal.provider = "default";
    internal.activeTenantId = "tenant-a";
    await (casdoorAuth as unknown as { persistSession: () => Promise<void> }).persistSession();
    expect((openAuthSettingsStoreForTests().get("casdoor:session") as { refreshToken?: string } | null)?.refreshToken).toBeTruthy();

    await (casdoorAuth as unknown as { clearSession: () => Promise<void> }).clearSession();
    expect(openAuthSettingsStoreForTests().get("casdoor:session")).toEqual({});
  });
});
