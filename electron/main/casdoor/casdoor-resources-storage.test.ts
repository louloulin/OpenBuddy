import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { casdoorAuthMock, electronMock, auditMock } = vi.hoisted(() => ({
  casdoorAuthMock: {
    status: vi.fn(),
    authorize: vi.fn(() => true),
    getAccessToken: vi.fn(),
    refresh: vi.fn(async () => undefined),
    handleExternalRevocation: vi.fn(async () => undefined),
  },
  electronMock: (() => {
    const fn = vi.fn();
    fn.mockReturnValue("");
    return {
      app: { getPath: fn },
      BrowserWindow: class {},
    };
  })(),
  auditMock: { record: vi.fn(async () => undefined) },
}));

function makeStatus(subject = "user-1", activeTenantId = "tenant-a") {
  return {
    status: "signed_in" as const,
    config: { configured: true },
    tenantContext: { activeTenantId },
    identity: { subject },
  };
}

vi.mock("electron", () => electronMock);
vi.mock("./casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("./casdoor-audit", () => ({ casdoorAudit: auditMock }));

const userData = mkdtempSync(join(tmpdir(), "casdoor-resources-storage-"));

import { __casdoorResourceTestables } from "./casdoor-resources";
const { CasdoorResourceService } = __casdoorResourceTestables;

// vi.resetModules() 之后动态 import 出来的是**新的模块实例**,静态导入的
// testables 摸不到它的 driver。不记录这些实例,afterEach 只能关掉第一个,
// 其余实例的 SQLite 句柄会让 rmSync 在 Windows 上 EBUSY。
let reloadedModules: Array<typeof import("./casdoor-resources")> = [];
async function reloadCasdoorResources(): Promise<typeof import("./casdoor-resources")> {
  const mod = await import("./casdoor-resources");
  reloadedModules.push(mod);
  return mod;
}

beforeEach(() => {
  electronMock.app.getPath.mockReturnValue(userData);
  casdoorAuthMock.status.mockReset();
  casdoorAuthMock.status.mockImplementation(() => makeStatus());
  casdoorAuthMock.authorize.mockReset();
  casdoorAuthMock.authorize.mockReturnValue(true);
  auditMock.record.mockReset();
  auditMock.record.mockResolvedValue(undefined);
});

afterEach(() => {
  // 先关 SQLite 句柄再删目录(Windows EBUSY)。
  for (const mod of reloadedModules) {
    mod.__casdoorResourceTestables.resetResourceStoreForTests();
  }
  reloadedModules = [];
  __casdoorResourceTestables.resetResourceStoreForTests?.();
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("casdoor-resources SettingsDocumentStore-backed persistence", () => {
  it("consumes legacy JSON file on first read and unlinks it", async () => {
    const legacy = join(userData, "casdoor-tenant-resources.json");
    rmSync(userData, { recursive: true, force: true });
    const u2 = mkdtempSync(join(tmpdir(), "casdoor-resources-legacy-"));
    electronMock.app.getPath.mockReturnValue(u2);
    try {
      const legacyDocument = {
        schemaVersion: 3,
        resources: [
          {
            id: "legacy-res-1",
            type: "project",
            tenantId: "tenant-a",
            ownerSubject: "user-1",
            name: "legacy-demo",
            metadata: {},
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            version: 1,
          },
        ],
        idempotency: {},
        tenantPolicies: {},
        runtimeUsage: {},
      };
      writeFileSync(join(u2, "casdoor-tenant-resources.json"), JSON.stringify(legacyDocument), { encoding: "utf8", mode: 0o600 });

      vi.resetModules();
      vi.mock("electron", () => electronMock);
      vi.mock("./casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
      vi.mock("./casdoor-audit", () => ({ casdoorAudit: auditMock }));
      const mod = await reloadCasdoorResources();
      const items = await mod.casdoorResources.list("project");
      expect(items.find((r) => r.id === "legacy-res-1")).toBeTruthy();
      expect(existsSync(join(u2, "casdoor-tenant-resources.json"))).toBe(false);
    } finally {
      // 先关掉这个用例 reload 出来的模块实例持有的 SQLite 句柄,再删目录;
      // 否则 Windows 上 rmSync 会 EBUSY(afterEach 关闭发生在这之后)。
      for (const mod of reloadedModules) mod.__casdoorResourceTestables.resetResourceStoreForTests();
      reloadedModules = [];
      rmSync(u2, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("writes via SettingsDocumentStore and reads back identical data after re-import", async () => {
    casdoorAuthMock.status.mockImplementation(() => makeStatus("user-9", "tenant-b"));
    const service = new CasdoorResourceService();
    const created = await service.create({
      type: "project",
      name: "alpha",
      metadata: { description: "migrated" },
    } as Parameters<typeof service.create>[0]);
    expect(created.name).toBe("alpha");

    vi.resetModules();
    vi.mock("electron", () => electronMock);
    vi.mock("./casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
    vi.mock("./casdoor-audit", () => ({ casdoorAudit: auditMock }));
    casdoorAuthMock.status.mockImplementation(() => makeStatus("user-9", "tenant-b"));
    const mod = await reloadCasdoorResources();
    const restored = (await mod.casdoorResources.list("project")) as unknown[];
    expect(restored.find((r: any) => r.id === created.id)).toBeTruthy();
  });
});
