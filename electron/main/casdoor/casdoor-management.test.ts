import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-casdoor-management-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
}));

const { casdoorAuthMock } = vi.hoisted(() => ({
  casdoorAuthMock: {
    status: vi.fn(() => ({ config: { configured: true, issuer: "https://casdoor.test" }, identity: { isAdmin: true }, tenantContext: { activeTenantId: "acme" } })),
    assertAuthorized: vi.fn(),
  },
}));

vi.mock("./casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("./casdoor-audit", () => ({ casdoorAudit: { record: vi.fn(async () => undefined) } }));

import { __casdoorManagementTestables } from "./casdoor-management";

describe("Casdoor management audit operation mapping", () => {
  it("maps Casdoor CRUD endpoints to stable resource actions", () => {
    expect(__casdoorManagementTestables.managementOperation("https://casdoor.test/api/add-user")).toEqual({ resource: "user", action: "create" });
    expect(__casdoorManagementTestables.managementOperation("https://casdoor.test/api/update-role?id=built-in%2Fmember")).toEqual({ resource: "role", action: "update" });
    expect(__casdoorManagementTestables.managementOperation("https://casdoor.test/api/delete-permission")).toEqual({ resource: "permission", action: "delete" });
    expect(__casdoorManagementTestables.managementOperation("https://casdoor.test/api/get-organizations?p=1")).toEqual({ resource: "organization", action: "read" });
    expect(__casdoorManagementTestables.managementOperation("https://casdoor.test/api/invite-user")).toEqual({ resource: "user", action: "create" });
    expect(__casdoorManagementTestables.managementOperation("https://casdoor.test/api/get-account-linking-options")).toEqual({ resource: "account-linking-option", action: "read" });
    expect(__casdoorManagementTestables.managementOperation("https://casdoor.test/api/delete-account-linking-option")).toEqual({ resource: "account-linking-option", action: "delete" });
  });

  it("uses a safe fallback for malformed or unknown endpoints", () => {
    expect(__casdoorManagementTestables.managementOperation("not-a-url")).toEqual({ resource: "casdoor", action: "write" });
    expect(__casdoorManagementTestables.managementOperation("https://casdoor.test/api/unknown")).toEqual({ resource: "casdoor", action: "write" });
  });

  it("defaults to all webhook event types and filters explicit subscriptions", () => {
    const testables = __casdoorManagementTestables;
    testables.clearCasdoorWebhookSubscriptions("acme");
    expect(testables.listCasdoorWebhookSubscriptions("acme").source).toBe("default-all");
    expect(testables.isWebhookSubscribed("acme", "user.update")).toBe(true);

    const snapshot = testables.updateCasdoorWebhookSubscriptions({ tenantId: "acme", eventTypes: ["user.update", "organization.delete", "not-supported"] });
    expect(snapshot.eventTypes).toEqual(["user.update", "organization.delete"]);
    expect(testables.isWebhookSubscribed("acme", "user.update")).toBe(true);
    expect(testables.isWebhookSubscribed("acme", "user.delete")).toBe(false);
    expect(testables.isWebhookSubscribed("acme", "not-supported")).toBe(false);
    testables.clearCasdoorWebhookSubscriptions("acme");
  });

  it("persists explicit subscriptions and restores them after an in-process reload", () => {
    const testables = __casdoorManagementTestables;
    testables.resetWebhookSubscriptionsForTests();
    testables.updateCasdoorWebhookSubscriptions({ tenantId: "acme", eventTypes: ["permission.delete"] });
    testables.resetWebhookSubscriptionsForTests();

    const restored = testables.listCasdoorWebhookSubscriptions("acme");
    expect(restored.source).toBe("explicit");
    expect(restored.eventTypes).toEqual(["permission.delete"]);
    // Migration to SettingsDocumentStore: verify the SQLite namespace, not the legacy JSON file.
    const persisted = testables.openWebhookSubscriptionsStoreForTests().get("casdoor:webhook-subscriptions");
    expect(persisted).toBeTruthy();
    const subscriptions = (persisted as { casdoorSubscriptions?: Record<string, string[]> }).casdoorSubscriptions;
    expect(subscriptions).toBeTruthy();
    expect(Object.values(subscriptions ?? {})).toContainEqual(["permission.delete"]);
    // Legacy file should have been consumed and unlinked on first load.
    expect(existsSync("/tmp/openbuddy-casdoor-management-test/casdoor-webhook-subscriptions.json")).toBe(false);
    testables.clearCasdoorWebhookSubscriptions("acme");
  });
});
