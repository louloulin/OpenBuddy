import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "casdoor-management-storage-"));

const { casdoorAuthMock } = vi.hoisted(() => ({
  casdoorAuthMock: {
    status: vi.fn(),
    assertAuthorized: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
}));
vi.mock("./casdoor-audit", () => ({ casdoorAudit: { record: vi.fn(async () => undefined) } }));
vi.mock("./casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));

import { __casdoorManagementTestables } from "./casdoor-management";

function makeStatus(issuer = "https://casdoor.test") {
  return {
    status: "signed_in" as const,
    config: { configured: true, issuer },
    tenantContext: { activeTenantId: "tenant-a" },
    identity: { subject: "user-1" },
  };
}

beforeEach(() => {
  casdoorAuthMock.status.mockReset();
  casdoorAuthMock.status.mockImplementation(() => makeStatus());
  casdoorAuthMock.assertAuthorized.mockReset();
  casdoorAuthMock.assertAuthorized.mockImplementation(() => undefined);
  __casdoorManagementTestables.resetWebhookSubscriptionsForTests();
  // Drop any persisted namespace so each test starts from a clean slate.
  const store = __casdoorManagementTestables.openWebhookSubscriptionsStoreForTests();
  store.delete("casdoor:webhook-subscriptions");
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe("casdoor-management SettingsDocumentStore-backed persistence", () => {
  it("consumes legacy JSON file on first read and unlinks it", async () => {
    const legacy = join(userData, "casdoor-webhook-subscriptions.json");
    writeFileSync(
      legacy,
      JSON.stringify({ schemaVersion: 1, subscriptions: { "https://casdoor.test::tenant-a": ["user.update"] } }),
      { encoding: "utf8", mode: 0o600 },
    );
    __casdoorManagementTestables.resetWebhookSubscriptionsForTests();
    __casdoorManagementTestables.isWebhookSubscribed("tenant-a", "user.update");
    await __casdoorManagementTestables.flushWebhookSubscriptionMigrationForTests();
    expect(existsSync(legacy)).toBe(false);

    const stored = __casdoorManagementTestables.openWebhookSubscriptionsStoreForTests().get("casdoor:webhook-subscriptions");
    const subs = (stored as { casdoorSubscriptions?: Record<string, string[]> } | null)?.casdoorSubscriptions;
    expect(Object.values(subs ?? {})).toContainEqual(["user.update"]);
  });

  it("persists update + clear via SQLite and re-reads identical state", () => {
    const snapshot = __casdoorManagementTestables.updateCasdoorWebhookSubscriptions({
      tenantId: "tenant-a",
      eventTypes: ["permission.delete"],
    });
    expect(snapshot.eventTypes).toEqual(["permission.delete"]);

    __casdoorManagementTestables.resetWebhookSubscriptionsForTests();
    const restored = __casdoorManagementTestables.listCasdoorWebhookSubscriptions("tenant-a");
    expect(restored.source).toBe("explicit");
    expect(restored.eventTypes).toEqual(["permission.delete"]);

    __casdoorManagementTestables.clearCasdoorWebhookSubscriptions("tenant-a");
    __casdoorManagementTestables.resetWebhookSubscriptionsForTests();
    const cleared = __casdoorManagementTestables.listCasdoorWebhookSubscriptions("tenant-a");
    expect(cleared.source).toBe("default-all");
  });
});
