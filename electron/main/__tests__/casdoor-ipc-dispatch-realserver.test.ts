// @vitest-environment node
/**
 * Real end-to-end test for the `casdoor:*` IPC handlers registered in
 * `electron/main/ipc.ts` via `ipcMain.handle`. Covers the dispatcher layer
 * (parameter validation, error propagation, authz enforcement) that wraps
 * the underlying `casdoor-auth` / `casdoor-management` / `casdoor-audit`
 * implementations.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CapturedHandler { channel: string; fn: (...args: unknown[]) => Promise<unknown> | unknown }

const { registry, casdoorAuthMock, casdoorAuditMock, casdoorResourcesMock, casdoorManagementMock } = vi.hoisted(() => {
  const registry = new Map<string, CapturedHandler>();
  const fn = vi.fn((channel: string, handler: CapturedHandler["fn"]) => { registry.set(channel, { channel, fn: handler }); });
  const fn2 = vi.fn();
  const fn3 = vi.fn();
  const fn4 = vi.fn();
  // Make registry accessible inside electron mock factory
  (globalThis as unknown as { __registry: typeof registry }).__registry = registry;
  return {
    registry,
    casdoorAuthMock: {
      status: vi.fn(),
      getLoginCapabilities: vi.fn(),
      getConfig: vi.fn(),
      saveConfig: vi.fn(),
      startLogin: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(),
      assertAuthorized: vi.fn(),
      authorize: vi.fn(),
      authorizeResourceRemotely: vi.fn(),
      exchangeForWeKnora: vi.fn(),
      selectTenant: vi.fn(),
      can: vi.fn(),
      getAccessToken: vi.fn(),
      revalidateCurrentSession: vi.fn(),
    },
    casdoorAuditMock: { record: vi.fn(), list: vi.fn() },
    casdoorResourcesMock: {
    listSessions: vi.fn(),
    list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    deliverCasdoorWebhook: vi.fn(),
    getTenantPolicy: vi.fn(), updateTenantPolicy: vi.fn(),
    listTenantAudit: vi.fn(),
    getRuntimePolicy: vi.fn(),
    setMemberRevocation: vi.fn(), listMemberRevocations: vi.fn(),
    listWallets: vi.fn(), selectWallet: vi.fn(), getSelectedWallet: vi.fn(),
    listCreditWallets: vi.fn(), getSelectedCreditWalletCredits: vi.fn(),
    listSelectedCreditWalletLedger: vi.fn(), selectCreditWallet: vi.fn(),
    getCredits: vi.fn(), listCreditLedger: vi.fn(),
    getCreditReconciliation: vi.fn(), getCreditReconciliationExport: vi.fn(),
    listCreditPricing: vi.fn(), quoteCredits: vi.fn(),
    updateCreditPricing: vi.fn(),
    grantCredits: vi.fn(), issueWelcomeCredit: vi.fn(),
    reserveCredits: vi.fn(), settleCredits: vi.fn(), releaseCredits: vi.fn(),
    expireCredits: vi.fn(),
    registerSession: vi.fn(), unregisterSession: vi.fn(),
    getGatewayHealth: vi.fn(),
    getTenantHealth: vi.fn(),
    listBillingPlans: vi.fn(), upsertBillingPlan: vi.fn(),
    listBillingOrders: vi.fn(), createBillingOrder: vi.fn(),
    expireBillingOrder: vi.fn(), refundBillingOrder: vi.fn(),
    getBillingSubscription: vi.fn(),
    listCommercialModelCatalog: vi.fn(),
    listAiCapabilities: vi.fn(),
    introspectToken: vi.fn(),
    openManagementPage: vi.fn(),
    openMembershipManagementPage: vi.fn(),
    gatewayHealth: vi.fn(),
    tenantHealth: vi.fn(),
    getAiCapabilities: vi.fn(),
    getCommercialModelCatalog: vi.fn(),
    getSelectedWalletId: vi.fn(),
  },
    casdoorManagementMock: {
      listCasdoorUsers: vi.fn(), listCasdoorOrganizations: vi.fn(), listCasdoorRoles: vi.fn(),
      listCasdoorPermissions: vi.fn(), listCasdoorGroups: vi.fn(), listCasdoorRules: vi.fn(),
      listCasdoorSessions: vi.fn(), deleteCasdoorSession: vi.fn(), deleteAllCasdoorSessions: vi.fn(),
      getCasdoorOrganization: vi.fn(), introspectCasdoorToken: vi.fn(), inviteCasdoorUser: vi.fn(),
      listCasdoorAccountLinking: vi.fn(), unlinkCasdoorAccount: vi.fn(),
      listCasdoorWebhookSubscriptions: vi.fn(), updateCasdoorWebhookSubscriptions: vi.fn(),
      saveCasdoorUser: vi.fn(), updateCasdoorUser: vi.fn(), deleteCasdoorUser: vi.fn(),
      saveCasdoorRole: vi.fn(), updateCasdoorRole: vi.fn(), deleteCasdoorRole: vi.fn(),
      saveCasdoorPermission: vi.fn(), updateCasdoorPermission: vi.fn(), deleteCasdoorPermission: vi.fn(),
      saveCasdoorOrganization: vi.fn(), updateCasdoorOrganization: vi.fn(), deleteCasdoorOrganization: vi.fn(),
      saveCasdoorGroup: vi.fn(), updateCasdoorGroup: vi.fn(), deleteCasdoorGroup: vi.fn(),
      saveCasdoorRule: vi.fn(), updateCasdoorRule: vi.fn(), deleteCasdoorRule: vi.fn(),
    },
  };
});

vi.mock("electron", () => {
  const reg = (globalThis as unknown as { __registry: Map<string, CapturedHandler> }).__registry;
  return {
    app: {
      getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-casdoor-ipc-test" : "/tmp",
      on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => { reg.set(channel, { channel, fn: handler }); }),
      removeHandler: vi.fn((channel: string) => { reg.delete(channel); }),
      on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn(),
    },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn((s: string) => Buffer.from(s)), decryptString: vi.fn((b: Buffer) => b.toString()) },
    shell: { openExternal: vi.fn(async () => undefined) },
    BrowserWindow: vi.fn(),
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    clipboard: { writeText: vi.fn(), readText: vi.fn() },
  };
});

vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("../casdoor/casdoor-audit", () => ({ casdoorAudit: casdoorAuditMock }));
vi.mock("../casdoor/casdoor-resources", () => ({ casdoorResources: casdoorResourcesMock }));
vi.mock("../casdoor/casdoor-management", () => casdoorManagementMock);

let tempDir = "";
let registerIpc: typeof import("../ipc/index").registerIpc;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-casdoor-ipc-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  // Import ipc.ts AFTER mocks
  const ipc = await import("../ipc/index");
  registerIpc = ipc.registerIpc;
  await registerIpc(() => null);
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callHandler<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registry.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return (await handler.fn({}, ...args)) as T;
}

function setStatus(overrides: Record<string, unknown> = {}): void {
  casdoorAuthMock.status.mockReturnValue({
    status: "signed_in",
    provider: "default",
    expiresAt: undefined,
    error: undefined,
    config: { configured: true, issuer: "https://casdoor.example", clientId: "test" },
    identity: {
      subject: "user-1", displayName: "User One", email: "u1@example.com", phone: undefined,
      organizations: ["acme"], roles: ["member"], groups: [], permissions: ["tenant.audit.read"],
      capabilities: ["admin.portal", "team.workspace"], isAdmin: true, customFields: {},
    },
    tenantContext: { activeTenantId: "acme", membership: { isTenantAdmin: true } },
    ...overrides,
  });
}

describe("casdoor IPC dispatch 真实端到端", () => {
  describe("casdoor:status + workbench-summary", () => {
    it("casdoor:status 返回 casdoorAuth.status() 的结果", async () => {
      setStatus();
      const result = await callHandler("casdoor:status");
      expect(result).toMatchObject({ status: "signed_in", config: { configured: true } });
    });

    it("casdoor:workbench-summary 返回 identity 子集字段", async () => {
      setStatus();
      const result = await callHandler<Record<string, unknown>>("casdoor:workbench-summary");
      expect(result.status).toBe("signed_in");
      expect(result.config).toEqual({ configured: true, reason: undefined });
      const identity = result.identity as Record<string, unknown>;
      expect(identity.subject).toBe("user-1");
      expect(identity.isAdmin).toBe(true);
      expect((identity.capabilities as string[])).toContain("admin.portal");
    });

    it("casdoor:workbench-summary 在无身份时返回 identity=null", async () => {
      setStatus({ identity: null });
      const result = await callHandler<Record<string, unknown>>("casdoor:workbench-summary");
      expect(result.identity).toBeNull();
    });

    it("casdoor:capabilities 返回登录能力", async () => {
      casdoorAuthMock.getLoginCapabilities.mockReturnValue({ providers: ["default"], features: ["sso"] });
      const result = await callHandler("casdoor:capabilities");
      expect(result).toEqual({ providers: ["default"], features: ["sso"] });
    });

    it("casdoor:config-get / save 透传 patch", async () => {
      casdoorAuthMock.getConfig.mockReturnValue({ configured: true, issuer: "x" });
      casdoorAuthMock.saveConfig.mockReset();
      const cfg = await callHandler("casdoor:config-get");
      expect(cfg).toEqual({ configured: true, issuer: "x" });
      await callHandler("casdoor:config-save", { issuer: "y" });
      expect(casdoorAuthMock.saveConfig).toHaveBeenCalledWith({ issuer: "y" });
    });
  });

  describe("casdoor:authorize / can / authorize-decision / authorize-resource", () => {
    it("casdoor:authorize (capability) 调用 casdoorAuth.authorize", async () => {
      casdoorAuthMock.authorize.mockReturnValue(true);
      const ok = await callHandler("casdoor:authorize", { capability: "team.workspace" });
      expect(ok).toBe(true);
      expect(casdoorAuthMock.authorize).toHaveBeenCalledWith({ capability: "team.workspace" });
    });

    it("casdoor:authorize (permission) 调用 casdoorAuth.authorize", async () => {
      casdoorAuthMock.authorize.mockReturnValue(false);
      const ok = await callHandler("casdoor:authorize", { permission: "tenant.billing.write" });
      expect(ok).toBe(false);
      expect(casdoorAuthMock.authorize).toHaveBeenCalledWith({ permission: "tenant.billing.write" });
    });

    it("casdoor:authorize 缺 capability+permission 时返回 false", async () => {
      casdoorAuthMock.authorize.mockReset();
      const ok = await callHandler("casdoor:authorize", {});
      expect(ok).toBe(false);
      expect(casdoorAuthMock.authorize).not.toHaveBeenCalled();
    });

    it("casdoor:authorize-decision 与 casdoor:authorize 等价路径", async () => {
      casdoorAuthMock.authorize.mockReturnValue(true);
      const ok = await callHandler("casdoor:authorize-decision", { capability: "admin.portal" });
      expect(ok).toBe(true);
    });

    it("casdoor:can 直接转发 capability 字符串", async () => {
      casdoorAuthMock.can.mockReturnValue(true);
      const ok = await callHandler("casdoor:can", "team.workspace");
      expect(ok).toBe(true);
      expect(casdoorAuthMock.can).toHaveBeenCalledWith("team.workspace");
    });

    it("casdoor:authorize-resource 转发到 authorizeResourceRemotely", async () => {
      casdoorAuthMock.authorizeResourceRemotely.mockResolvedValue({ allowed: true });
      const result = await callHandler("casdoor:authorize-resource", { tenantId: "acme", resource: "session", action: "read" });
      expect(result).toEqual({ allowed: true });
      expect(casdoorAuthMock.authorizeResourceRemotely).toHaveBeenCalledWith({ tenantId: "acme", resource: "session", action: "read" });
    });
  });

  describe("casdoor:tenant-select / refresh / logout / login", () => {
    it("casdoor:tenant-select 调用 selectTenant", async () => {
      casdoorAuthMock.selectTenant.mockResolvedValue({ tenantContext: { activeTenantId: "beta" } });
      const result = await callHandler("casdoor:tenant-select", "beta");
      expect(result).toEqual({ tenantContext: { activeTenantId: "beta" } });
      expect(casdoorAuthMock.selectTenant).toHaveBeenCalledWith("beta");
    });

    it("casdoor:refresh / logout 透传", async () => {
      casdoorAuthMock.refresh.mockResolvedValue({ ok: true });
      casdoorAuthMock.logout.mockResolvedValue({ ok: true });
      expect(await callHandler("casdoor:refresh")).toEqual({ ok: true });
      expect(await callHandler("casdoor:logout")).toEqual({ ok: true });
    });

    it("casdoor:login 三种 provider 都透传", async () => {
      casdoorAuthMock.startLogin.mockResolvedValue({ url: "https://casdoor/login" });
      for (const provider of ["default", "sms", "wechat"] as const) {
        const result = await callHandler("casdoor:login", provider);
        expect(result).toEqual({ url: "https://casdoor/login" });
        expect(casdoorAuthMock.startLogin).toHaveBeenCalledWith(provider);
      }
    });
  });

  describe("casdoor:audit-list 鉴权 + 过滤", () => {
    it("无权限时 throw (assertAuthorized 抛)", async () => {
      setStatus();
      casdoorAuthMock.assertAuthorized.mockImplementation(() => { throw new Error("no perm"); });
      await expect(callHandler("casdoor:audit-list")).rejects.toThrow("no perm");
    });

    it("有权限 + isAdmin → 调用 list(undefined)", async () => {
      setStatus();
      casdoorAuthMock.assertAuthorized.mockReturnValue(true);
      casdoorAuditMock.list.mockReturnValue([{ id: "a" }]);
      const result = await callHandler("casdoor:audit-list");
      expect(casdoorAuditMock.list).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([{ id: "a" }]);
    });

    it("有权限 + 非 admin → 调用 list(activeTenantId)", async () => {
      setStatus({ identity: { subject: "u", isAdmin: false, capabilities: [], permissions: ["tenant.audit.read"] } });
      casdoorAuthMock.assertAuthorized.mockReturnValue(true);
      casdoorAuditMock.list.mockReturnValue([]);
      const result = await callHandler("casdoor:audit-list");
      expect(casdoorAuditMock.list).toHaveBeenCalledWith("acme");
      expect(result).toEqual([]);
    });
  });

  describe("casdoor:list-* / save-* / update-* / delete-* 透传", () => {
    const passthroughs: Array<[string, () => void, () => Promise<unknown>, () => void]> = [
      ["casdoor:list-users", () => casdoorManagementMock.listCasdoorUsers.mockResolvedValue([{ name: "u1" }]), () => callHandler("casdoor:list-users", { limit: 1 }), () => expect(casdoorManagementMock.listCasdoorUsers).toHaveBeenCalledWith({ limit: 1 })],
      ["casdoor:list-organizations", () => casdoorManagementMock.listCasdoorOrganizations.mockResolvedValue([]), () => callHandler("casdoor:list-organizations"), () => expect(casdoorManagementMock.listCasdoorOrganizations).toHaveBeenCalledWith({})],
      ["casdoor:list-roles", () => casdoorManagementMock.listCasdoorRoles.mockResolvedValue([]), () => callHandler("casdoor:list-roles"), () => expect(casdoorManagementMock.listCasdoorRoles).toHaveBeenCalledWith({})],
      ["casdoor:list-permissions", () => casdoorManagementMock.listCasdoorPermissions.mockResolvedValue([]), () => callHandler("casdoor:list-permissions"), () => expect(casdoorManagementMock.listCasdoorPermissions).toHaveBeenCalledWith({})],
      ["casdoor:list-groups", () => casdoorManagementMock.listCasdoorGroups.mockResolvedValue([]), () => callHandler("casdoor:list-groups"), () => expect(casdoorManagementMock.listCasdoorGroups).toHaveBeenCalledWith({})],
      ["casdoor:list-rules", () => casdoorManagementMock.listCasdoorRules.mockResolvedValue([]), () => callHandler("casdoor:list-rules"), () => expect(casdoorManagementMock.listCasdoorRules).toHaveBeenCalledWith({})],
      ["casdoor:user-add", () => casdoorManagementMock.saveCasdoorUser.mockResolvedValue({ ok: true }), () => callHandler("casdoor:user-add", { name: "u", password: "p" }), () => expect(casdoorManagementMock.saveCasdoorUser).toHaveBeenCalledWith({ name: "u", password: "p" })],
      ["casdoor:user-update", () => casdoorManagementMock.updateCasdoorUser.mockResolvedValue({ ok: true }), () => callHandler("casdoor:user-update", { name: "u" }), () => expect(casdoorManagementMock.updateCasdoorUser).toHaveBeenCalledWith({ name: "u" })],
      ["casdoor:user-delete", () => casdoorManagementMock.deleteCasdoorUser.mockResolvedValue({ ok: true }), () => callHandler("casdoor:user-delete", { owner: "o", name: "u" }), () => expect(casdoorManagementMock.deleteCasdoorUser).toHaveBeenCalledWith("o", "u")],
    ];
    for (const [channel, setup, run, assert] of passthroughs) {
      it(`${channel} 透传参数到底层实现`, async () => {
        setup();
        await run();
        assert();
      });
    }

    it("casdoor:session-list 调用 casdoorResources.listSessions", async () => {
      casdoorResourcesMock.listSessions.mockReturnValue([{ id: "s1" }]);
      const result = await callHandler("casdoor:session-list", { limit: 50 });
      expect(casdoorResourcesMock.listSessions).toHaveBeenCalledWith(50);
      expect(result).toEqual([{ id: "s1" }]);
    });

    it("casdoor:session-list 默认 limit=100", async () => {
      casdoorResourcesMock.listSessions.mockReturnValue([]);
      await callHandler("casdoor:session-list");
      expect(casdoorResourcesMock.listSessions).toHaveBeenCalledWith(100);
    });

    it("casdoor:delete-session 透传", async () => {
      casdoorManagementMock.deleteCasdoorSession.mockResolvedValue({ revoked: true });
      const result = await callHandler("casdoor:delete-session", { owner: "o", name: "n", sessionId: "sid" });
      expect(casdoorManagementMock.deleteCasdoorSession).toHaveBeenCalledWith({ owner: "o", name: "n", sessionId: "sid" });
      expect(result).toEqual({ revoked: true });
    });

    it("casdoor:webhook-subscription-list/update 透传", async () => {
      casdoorManagementMock.listCasdoorWebhookSubscriptions.mockResolvedValue({ items: [] });
      casdoorManagementMock.updateCasdoorWebhookSubscriptions.mockResolvedValue({ updated: 2 });
      const list = await callHandler("casdoor:webhook-subscription-list", { tenantId: "acme" });
      expect(casdoorManagementMock.listCasdoorWebhookSubscriptions).toHaveBeenCalledWith("acme");
      expect(list).toEqual({ items: [] });
      const upd = await callHandler("casdoor:webhook-subscription-update", { tenantId: "acme", eventTypes: ["x"] });
      expect(casdoorManagementMock.updateCasdoorWebhookSubscriptions).toHaveBeenCalledWith({ tenantId: "acme", eventTypes: ["x"] });
      expect(upd).toEqual({ updated: 2 });
    });

    it("casdoor:user-invite 透传 CasdoorUserInvite", async () => {
      casdoorManagementMock.inviteCasdoorUser.mockResolvedValue({ invited: true });
      const result = await callHandler("casdoor:user-invite", { email: "u@x", owner: "o" });
      expect(casdoorManagementMock.inviteCasdoorUser).toHaveBeenCalledWith({ email: "u@x", owner: "o" });
      expect(result).toEqual({ invited: true });
    });

    it("casdoor:list-account-linking / unlink-account 透传", async () => {
      casdoorManagementMock.listCasdoorAccountLinking.mockResolvedValue({ accounts: [] });
      casdoorManagementMock.unlinkCasdoorAccount.mockResolvedValue({ ok: true });
      const list = await callHandler("casdoor:list-account-linking", { owner: "o", name: "n" });
      expect(casdoorManagementMock.listCasdoorAccountLinking).toHaveBeenCalledWith("o", "n");
      expect(list).toEqual({ accounts: [] });
      const unl = await callHandler("casdoor:unlink-account", { owner: "o", name: "n", provider: "google" });
      expect(casdoorManagementMock.unlinkCasdoorAccount).toHaveBeenCalledWith({ owner: "o", name: "n", provider: "google" });
      expect(unl).toEqual({ ok: true });
    });
  });

  describe("casdoor:weknora-token-exchange", () => {
    it("casdoor:weknora-token-exchange 调用 exchangeForWeKnora", async () => {
      casdoorAuthMock.exchangeForWeKnora.mockResolvedValue({ token: "wk-tok", expiresAt: "2026-01-01" });
      const result = await callHandler("casdoor:weknora-token-exchange", { tenantId: "acme", sessionId: "s1" });
      expect(casdoorAuthMock.exchangeForWeKnora).toHaveBeenCalledWith("acme", "s1");
      expect(result).toEqual({ token: "wk-tok", expiresAt: "2026-01-01" });
    });
  });

  describe("casdoor CRUD handler 透传", () => {
    const crudCases: Array<[string, () => void, () => Promise<unknown>, () => void]> = [
      // Organization CRUD
      ["casdoor:organization-add", () => casdoorManagementMock.saveCasdoorOrganization.mockResolvedValue({ ok: true }), () => callHandler("casdoor:organization-add", { name: "org", owner: "o" }), () => expect(casdoorManagementMock.saveCasdoorOrganization).toHaveBeenCalledWith({ name: "org", owner: "o" })],
      ["casdoor:organization-update", () => casdoorManagementMock.updateCasdoorOrganization.mockResolvedValue({ ok: true }), () => callHandler("casdoor:organization-update", { name: "org", owner: "o" }), () => expect(casdoorManagementMock.updateCasdoorOrganization).toHaveBeenCalledWith({ name: "org", owner: "o" })],
      ["casdoor:organization-delete", () => casdoorManagementMock.deleteCasdoorOrganization.mockResolvedValue({ ok: true }), () => callHandler("casdoor:organization-delete", { owner: "o", name: "n" }), () => expect(casdoorManagementMock.deleteCasdoorOrganization).toHaveBeenCalledWith("o", "n")],
      // Permission CRUD
      ["casdoor:permission-add", () => casdoorManagementMock.saveCasdoorPermission.mockResolvedValue({ ok: true }), () => callHandler("casdoor:permission-add", { name: "p", owner: "o" }), () => expect(casdoorManagementMock.saveCasdoorPermission).toHaveBeenCalledWith({ name: "p", owner: "o" })],
      ["casdoor:permission-update", () => casdoorManagementMock.updateCasdoorPermission.mockResolvedValue({ ok: true }), () => callHandler("casdoor:permission-update", { name: "p", owner: "o" }), () => expect(casdoorManagementMock.updateCasdoorPermission).toHaveBeenCalledWith({ name: "p", owner: "o" })],
      ["casdoor:permission-delete", () => casdoorManagementMock.deleteCasdoorPermission.mockResolvedValue({ ok: true }), () => callHandler("casdoor:permission-delete", { owner: "o", name: "n" }), () => expect(casdoorManagementMock.deleteCasdoorPermission).toHaveBeenCalledWith("o", "n")],
      // Role CRUD
      ["casdoor:role-add", () => casdoorManagementMock.saveCasdoorRole.mockResolvedValue({ ok: true }), () => callHandler("casdoor:role-add", { name: "r", owner: "o" }), () => expect(casdoorManagementMock.saveCasdoorRole).toHaveBeenCalledWith({ name: "r", owner: "o" })],
      ["casdoor:role-update", () => casdoorManagementMock.updateCasdoorRole.mockResolvedValue({ ok: true }), () => callHandler("casdoor:role-update", { name: "r", owner: "o" }), () => expect(casdoorManagementMock.updateCasdoorRole).toHaveBeenCalledWith({ name: "r", owner: "o" })],
      ["casdoor:role-delete", () => casdoorManagementMock.deleteCasdoorRole.mockResolvedValue({ ok: true }), () => callHandler("casdoor:role-delete", { owner: "o", name: "n" }), () => expect(casdoorManagementMock.deleteCasdoorRole).toHaveBeenCalledWith("o", "n")],
      // Group CRUD
      ["casdoor:group-add", () => casdoorManagementMock.saveCasdoorGroup.mockResolvedValue({ ok: true }), () => callHandler("casdoor:group-add", { name: "g", owner: "o" }), () => expect(casdoorManagementMock.saveCasdoorGroup).toHaveBeenCalledWith({ name: "g", owner: "o" })],
      ["casdoor:group-update", () => casdoorManagementMock.updateCasdoorGroup.mockResolvedValue({ ok: true }), () => callHandler("casdoor:group-update", { name: "g", owner: "o" }), () => expect(casdoorManagementMock.updateCasdoorGroup).toHaveBeenCalledWith({ name: "g", owner: "o" })],
      ["casdoor:group-delete", () => casdoorManagementMock.deleteCasdoorGroup.mockResolvedValue({ ok: true }), () => callHandler("casdoor:group-delete", { owner: "o", name: "n" }), () => expect(casdoorManagementMock.deleteCasdoorGroup).toHaveBeenCalledWith("o", "n")],
      // Rule CRUD
      ["casdoor:rule-add", () => casdoorManagementMock.saveCasdoorRule.mockResolvedValue({ ok: true }), () => callHandler("casdoor:rule-add", { name: "rl", owner: "o" }), () => expect(casdoorManagementMock.saveCasdoorRule).toHaveBeenCalledWith({ name: "rl", owner: "o" })],
      ["casdoor:rule-update", () => casdoorManagementMock.updateCasdoorRule.mockResolvedValue({ ok: true }), () => callHandler("casdoor:rule-update", { name: "rl", owner: "o" }), () => expect(casdoorManagementMock.updateCasdoorRule).toHaveBeenCalledWith({ name: "rl", owner: "o" })],
      ["casdoor:rule-delete", () => casdoorManagementMock.deleteCasdoorRule.mockResolvedValue({ ok: true }), () => callHandler("casdoor:rule-delete", { owner: "o", name: "n" }), () => expect(casdoorManagementMock.deleteCasdoorRule).toHaveBeenCalledWith("o", "n")],
    ];
    for (const [channel, setup, run, assert] of crudCases) {
      it(`${channel} 透传参数到底层实现`, async () => {
        setup();
        await run();
        assert();
      });
    }
  });

  describe("casdoor:list-* sessions + introspect + get-organization", () => {
    it("casdoor:list-sessions 透传 owner/name", async () => {
      casdoorManagementMock.listCasdoorSessions.mockResolvedValue([{ id: "s1" }]);
      const result = await callHandler("casdoor:list-sessions", { owner: "o", name: "n" });
      expect(casdoorManagementMock.listCasdoorSessions).toHaveBeenCalledWith("o", "n");
      expect(result).toEqual([{ id: "s1" }]);
    });

    it("casdoor:delete-all-sessions 透传 owner/name", async () => {
      casdoorManagementMock.deleteAllCasdoorSessions.mockResolvedValue({ deleted: 5 });
      const result = await callHandler("casdoor:delete-all-sessions", { owner: "o", name: "n" });
      expect(casdoorManagementMock.deleteAllCasdoorSessions).toHaveBeenCalledWith("o", "n");
      expect(result).toEqual({ deleted: 5 });
    });

    it("casdoor:get-organization 透传 owner/name", async () => {
      casdoorManagementMock.getCasdoorOrganization.mockResolvedValue({ name: "n", owner: "o" });
      const result = await callHandler("casdoor:get-organization", { owner: "o", name: "n" });
      expect(casdoorManagementMock.getCasdoorOrganization).toHaveBeenCalledWith("o", "n");
      expect(result).toEqual({ name: "n", owner: "o" });
    });

    it("casdoor:introspect-token 调用 introspectCasdoorToken (handler 硬编码空 token)", async () => {
      casdoorAuthMock.authorize.mockReturnValue(true);
      casdoorManagementMock.introspectCasdoorToken.mockResolvedValue({ active: true, sub: "u1" });
      const result = await callHandler("casdoor:introspect-token");
      expect(casdoorAuthMock.authorize).toHaveBeenCalledWith({ permission: "tenant.users.read" });
      expect(casdoorManagementMock.introspectCasdoorToken).toHaveBeenCalledWith({ token: "" });
      expect(result).toEqual({ active: true, sub: "u1" });
    });
  });

  describe("casdoor resource gateway (casdoor:resource-*)", () => {
    it("casdoor:resource-list 透传 type", async () => {
      casdoorResourcesMock.list.mockReturnValue([{ id: "r1" }]);
      const result = await callHandler("casdoor:resource-list", { type: "model" });
      expect(casdoorResourcesMock.list).toHaveBeenCalledWith("model");
      expect(result).toEqual([{ id: "r1" }]);
    });

    it("casdoor:resource-list 默认 type=undefined", async () => {
      casdoorResourcesMock.list.mockReturnValue([]);
      await callHandler("casdoor:resource-list");
      expect(casdoorResourcesMock.list).toHaveBeenCalledWith(undefined);
    });

    it("casdoor:resource-get 透传 id", async () => {
      casdoorResourcesMock.get.mockReturnValue({ id: "r1" });
      const result = await callHandler("casdoor:resource-get", { id: "r1" });
      expect(casdoorResourcesMock.get).toHaveBeenCalledWith("r1");
      expect(result).toEqual({ id: "r1" });
    });

    it("casdoor:resource-create 透传 input", async () => {
      casdoorResourcesMock.create.mockReturnValue({ id: "r1" });
      const result = await callHandler("casdoor:resource-create", { input: { name: "r" } });
      expect(casdoorResourcesMock.create).toHaveBeenCalledWith({ name: "r" });
      expect(result).toEqual({ id: "r1" });
    });

    it("casdoor:resource-update 透传 id + input", async () => {
      casdoorResourcesMock.update.mockReturnValue({ id: "r1", version: 2 });
      const result = await callHandler("casdoor:resource-update", { id: "r1", input: { name: "r2" } });
      expect(casdoorResourcesMock.update).toHaveBeenCalledWith("r1", { name: "r2" });
      expect(result).toEqual({ id: "r1", version: 2 });
    });

    it("casdoor:resource-delete 透传 id + expectedVersion", async () => {
      casdoorResourcesMock.delete.mockReturnValue({ deleted: true });
      const result = await callHandler("casdoor:resource-delete", { id: "r1", expectedVersion: 5 });
      expect(casdoorResourcesMock.delete).toHaveBeenCalledWith("r1", 5);
      expect(result).toEqual({ deleted: true });
    });

    it("casdoor:webhook-deliver 透传 event + signatureSecret", async () => {
      casdoorResourcesMock.deliverCasdoorWebhook.mockReturnValue({ delivered: true });
      const result = await callHandler("casdoor:webhook-deliver", {
        event: { type: "user.created", action: "create", organization: "o" },
        signatureSecret: "secret",
      });
      expect(casdoorResourcesMock.deliverCasdoorWebhook).toHaveBeenCalledWith(
        { type: "user.created", action: "create", organization: "o" },
        "secret",
      );
      expect(result).toEqual({ delivered: true });
    });
  });

  describe("casdoor tenant/runtime policy", () => {
    it("casdoor:tenant-policy-get 返回当前策略", async () => {
      casdoorResourcesMock.getTenantPolicy.mockReturnValue({ allow: ["read"] });
      const result = await callHandler("casdoor:tenant-policy-get");
      expect(result).toEqual({ allow: ["read"] });
    });

    it("casdoor:tenant-policy-update 透传 patch", async () => {
      casdoorResourcesMock.updateTenantPolicy.mockReturnValue({ allow: ["write"] });
      const result = await callHandler("casdoor:tenant-policy-update", { allow: ["write"] });
      expect(casdoorResourcesMock.updateTenantPolicy).toHaveBeenCalledWith({ allow: ["write"] });
      expect(result).toEqual({ allow: ["write"] });
    });

    it("casdoor:tenant-audit-list 透传 limit (默认 100)", async () => {
      casdoorResourcesMock.listTenantAudit.mockReturnValue([{ id: "a1" }]);
      const result = await callHandler("casdoor:tenant-audit-list");
      expect(casdoorResourcesMock.listTenantAudit).toHaveBeenCalledWith(100);
      expect(result).toEqual([{ id: "a1" }]);
    });

    it("casdoor:tenant-audit-list 透传 limit", async () => {
      casdoorResourcesMock.listTenantAudit.mockReturnValue([]);
      await callHandler("casdoor:tenant-audit-list", { limit: 25 });
      expect(casdoorResourcesMock.listTenantAudit).toHaveBeenCalledWith(25);
    });

    it("casdoor:runtime-policy-get 返回当前 runtime policy", async () => {
      casdoorResourcesMock.getRuntimePolicy.mockReturnValue({ mode: "strict" });
      const result = await callHandler("casdoor:runtime-policy-get");
      expect(result).toEqual({ mode: "strict" });
    });
  });

  describe("casdoor member revocation", () => {
    it("casdoor:member-revocation 透传 subject + revoked + reason", async () => {
      casdoorResourcesMock.setMemberRevocation.mockReturnValue({ ok: true });
      const result = await callHandler("casdoor:member-revocation", { subject: "u1", revoked: true, reason: "compromised" });
      expect(casdoorResourcesMock.setMemberRevocation).toHaveBeenCalledWith("u1", true, "compromised");
      expect(result).toEqual({ ok: true });
    });

    it("casdoor:member-revocation 不传 reason → undefined", async () => {
      casdoorResourcesMock.setMemberRevocation.mockReturnValue({ ok: true });
      await callHandler("casdoor:member-revocation", { subject: "u1", revoked: false });
      expect(casdoorResourcesMock.setMemberRevocation).toHaveBeenCalledWith("u1", false, undefined);
    });

    it("casdoor:member-revocations 列出所有撤销", async () => {
      casdoorResourcesMock.listMemberRevocations.mockReturnValue([{ subject: "u1", revoked: true }]);
      const result = await callHandler("casdoor:member-revocations");
      expect(result).toEqual([{ subject: "u1", revoked: true }]);
    });
  });

  describe("casdoor credits + wallets + billing + health", () => {
    it("casdoor:credits-get 透传 subject", async () => {
      casdoorResourcesMock.getCredits.mockReturnValue({ balance: 100 });
      const result = await callHandler("casdoor:credits-get", { subject: "u1" });
      expect(casdoorResourcesMock.getCredits).toHaveBeenCalledWith("u1");
      expect(result).toEqual({ balance: 100 });
    });

    it("casdoor:credits-grant 透传 amount + idempotencyKey", async () => {
      casdoorResourcesMock.grantCredits.mockReturnValue({ account: { balance: 200 }, entry: { id: "e1" } });
      const result = await callHandler("casdoor:credits-grant", { amount: 100, idempotencyKey: "k1" });
      expect(casdoorResourcesMock.grantCredits).toHaveBeenCalledWith({ amount: 100, idempotencyKey: "k1" });
      expect(result).toEqual({ account: { balance: 200 }, entry: { id: "e1" } });
    });

    it("casdoor:credits-reserve 透传 reservation params", async () => {
      casdoorResourcesMock.reserveCredits.mockReturnValue({ account: { balance: 50 }, entry: { id: "r1" } });
      const result = await callHandler("casdoor:credits-reserve", { amount: 50, idempotencyKey: "k2" });
      expect(casdoorResourcesMock.reserveCredits).toHaveBeenCalledWith({ amount: 50, idempotencyKey: "k2" });
      expect(result).toEqual({ account: { balance: 50 }, entry: { id: "r1" } });
    });

    it("casdoor:credits-settle 透传 reservationKey + amount", async () => {
      casdoorResourcesMock.settleCredits.mockReturnValue({ account: { balance: 25 }, entry: { id: "s1" } });
      const result = await callHandler("casdoor:credits-settle", { reservationKey: "rk", amount: 25 });
      expect(casdoorResourcesMock.settleCredits).toHaveBeenCalledWith({ reservationKey: "rk", amount: 25 });
      expect(result).toEqual({ account: { balance: 25 }, entry: { id: "s1" } });
    });

    it("casdoor:credits-release 透传 reservationKey", async () => {
      casdoorResourcesMock.releaseCredits.mockReturnValue({ account: { balance: 75 }, entry: { id: "r2" } });
      const result = await callHandler("casdoor:credits-release", { reservationKey: "rk" });
      expect(casdoorResourcesMock.releaseCredits).toHaveBeenCalledWith("rk");
      expect(result).toEqual({ account: { balance: 75 }, entry: { id: "r2" } });
    });

    it("casdoor:credits-expire 触发过期扫描", async () => {
      casdoorResourcesMock.expireCredits.mockReturnValue({ expired: 3 });
      const result = await callHandler("casdoor:credits-expire");
      expect(result).toEqual({ expired: 3 });
    });

    it("casdoor:credits-pricing 列出价格表", async () => {
      casdoorResourcesMock.listCreditPricing.mockReturnValue([{ model: "gpt-4", rate: 0.01 }]);
      const result = await callHandler("casdoor:credits-pricing");
      expect(result).toEqual([{ model: "gpt-4", rate: 0.01 }]);
    });

    it("casdoor:credits-quote 报价", async () => {
      casdoorResourcesMock.quoteCredits.mockReturnValue({ cost: 0.02, currency: "USD" });
      const result = await callHandler("casdoor:credits-quote", { model: "gpt-4", promptTokens: 100, completionTokens: 50 });
      expect(casdoorResourcesMock.quoteCredits).toHaveBeenCalledWith({ model: "gpt-4", promptTokens: 100, completionTokens: 50 });
      expect(result).toEqual({ cost: 0.02, currency: "USD" });
    });

    it("casdoor:credits-reconciliation 返回对账报告", async () => {
      casdoorResourcesMock.getCreditReconciliation.mockReturnValue({ entries: [] });
      const result = await callHandler("casdoor:credits-reconciliation");
      expect(result).toEqual({ entries: [] });
    });

    it("casdoor:credits-reconciliation-export 返回导出", async () => {
      casdoorResourcesMock.getCreditReconciliationExport.mockReturnValue({ url: "https://example/export.csv" });
      const result = await callHandler("casdoor:credits-reconciliation-export");
      expect(result).toEqual({ url: "https://example/export.csv" });
    });

    it("casdoor:credits-ledger 列出账本 (默认 limit=100)", async () => {
      casdoorResourcesMock.listCreditLedger.mockReturnValue([{ id: "l1" }]);
      const result = await callHandler("casdoor:credits-ledger");
      expect(casdoorResourcesMock.listCreditLedger).toHaveBeenCalledWith(100, undefined);
      expect(result).toEqual([{ id: "l1" }]);
    });

    it("casdoor:credits-welcome 触发欢迎积分", async () => {
      casdoorResourcesMock.issueWelcomeCredit.mockReturnValue({ account: { balance: 10 } });
      const result = await callHandler("casdoor:credits-welcome", { idempotencyKey: "welcome-1" });
      expect(casdoorResourcesMock.issueWelcomeCredit).toHaveBeenCalledWith({ idempotencyKey: "welcome-1" });
      expect(result).toEqual({ account: { balance: 10 } });
    });

    it("casdoor:credits-pricing-update 更新价格", async () => {
      casdoorResourcesMock.updateCreditPricing.mockReturnValue({ model: "gpt-4", rate: 0.02 });
      const result = await callHandler("casdoor:credits-pricing-update", { model: "gpt-4", rate: 0.02 });
      expect(casdoorResourcesMock.updateCreditPricing).toHaveBeenCalledWith({ model: "gpt-4", rate: 0.02 });
      expect(result).toEqual({ model: "gpt-4", rate: 0.02 });
    });

    it("casdoor:wallet-credits 返回钱包余额", async () => {
      casdoorResourcesMock.getSelectedCreditWalletCredits.mockReturnValue({ balance: 500 });
      const result = await callHandler("casdoor:wallet-credits");
      expect(result).toEqual({ balance: 500 });
    });

    it("casdoor:wallet-ledger 返回钱包账本 (默认 100)", async () => {
      casdoorResourcesMock.listSelectedCreditWalletLedger.mockReturnValue([]);
      await callHandler("casdoor:wallet-ledger");
      expect(casdoorResourcesMock.listSelectedCreditWalletLedger).toHaveBeenCalledWith(100);
    });

    it("casdoor:wallet-ledger 透传 limit", async () => {
      casdoorResourcesMock.listSelectedCreditWalletLedger.mockReturnValue([]);
      await callHandler("casdoor:wallet-ledger", { limit: 50 });
      expect(casdoorResourcesMock.listSelectedCreditWalletLedger).toHaveBeenCalledWith(50);
    });

    it("casdoor:wallet-select 切换钱包", async () => {
      casdoorResourcesMock.selectCreditWallet.mockResolvedValue({ selectedWalletId: "w1", wallets: [] });
      const result = await callHandler("casdoor:wallet-select", { walletId: "w1" });
      expect(casdoorResourcesMock.selectCreditWallet).toHaveBeenCalledWith("w1");
      expect(result).toEqual({ selectedWalletId: "w1", wallets: [] });
    });

    it("casdoor:wallet-selected 读取当前钱包 ID", async () => {
      casdoorResourcesMock.getSelectedWalletId.mockReturnValue("w1");
      const result = await callHandler("casdoor:wallet-selected");
      expect(result).toBe("w1");
    });

    it("casdoor:wallets-list 列出所有钱包", async () => {
      casdoorResourcesMock.listCreditWallets.mockReturnValue([{ walletId: "w1" }]);
      const result = await callHandler("casdoor:wallets-list");
      expect(result).toEqual([{ walletId: "w1" }]);
    });

    it("casdoor:billing-plans 列出计费方案", async () => {
      casdoorResourcesMock.listBillingPlans.mockReturnValue([{ planId: "p1" }]);
      const result = await callHandler("casdoor:billing-plans");
      expect(result).toEqual([{ planId: "p1" }]);
    });

    it("casdoor:billing-plan-upsert 创建/更新方案", async () => {
      casdoorResourcesMock.upsertBillingPlan.mockReturnValue({ planId: "p1" });
      const result = await callHandler("casdoor:billing-plan-upsert", { planId: "p1", price: 100 });
      expect(casdoorResourcesMock.upsertBillingPlan).toHaveBeenCalledWith({ planId: "p1", price: 100 });
      expect(result).toEqual({ planId: "p1" });
    });

    it("casdoor:billing-orders 列出订单", async () => {
      casdoorResourcesMock.listBillingOrders.mockReturnValue([{ orderId: "o1" }]);
      const result = await callHandler("casdoor:billing-orders");
      expect(result).toEqual([{ orderId: "o1" }]);
    });

    it("casdoor:billing-order-create 创建订单", async () => {
      casdoorResourcesMock.createBillingOrder.mockReturnValue({ orderId: "o2" });
      const result = await callHandler("casdoor:billing-order-create", { planId: "p1" });
      expect(casdoorResourcesMock.createBillingOrder).toHaveBeenCalledWith({ planId: "p1" });
      expect(result).toEqual({ orderId: "o2" });
    });

    it("casdoor:billing-order-expire 过期订单", async () => {
      casdoorResourcesMock.expireBillingOrder.mockReturnValue({ expired: true });
      const result = await callHandler("casdoor:billing-order-expire", { orderId: "o1" });
      expect(result).toEqual({ expired: true });
    });

    it("casdoor:billing-order-refund 退款", async () => {
      casdoorResourcesMock.refundBillingOrder.mockReturnValue({ refunded: 50 });
      const result = await callHandler("casdoor:billing-order-refund", { orderId: "o1" });
      expect(result).toEqual({ refunded: 50 });
    });

    it("casdoor:billing-subscription 读取订阅", async () => {
      casdoorResourcesMock.getBillingSubscription.mockReturnValue({ planId: "p1" });
      const result = await callHandler("casdoor:billing-subscription");
      expect(result).toEqual({ planId: "p1" });
    });

    it("casdoor:commercial-model-catalog 列出商用模型目录", async () => {
      casdoorResourcesMock.getCommercialModelCatalog.mockReturnValue([{ modelId: "gpt-4" }]);
      const result = await callHandler("casdoor:commercial-model-catalog");
      expect(result).toEqual([{ modelId: "gpt-4" }]);
    });

    it("casdoor:ai-capabilities 列出 AI 能力", async () => {
      casdoorResourcesMock.getAiCapabilities.mockReturnValue([{ name: "summarize" }]);
      const result = await callHandler("casdoor:ai-capabilities");
      expect(result).toEqual([{ name: "summarize" }]);
    });

    it("casdoor:gateway-health 读取 gateway 健康", async () => {
      casdoorResourcesMock.gatewayHealth.mockReturnValue({ status: "ok" });
      const result = await callHandler("casdoor:gateway-health");
      expect(result).toEqual({ status: "ok" });
    });

    it("casdoor:tenant-health 读取 tenant 健康", async () => {
      casdoorResourcesMock.tenantHealth.mockReturnValue({ status: "ok" });
      const result = await callHandler("casdoor:tenant-health");
      expect(result).toEqual({ status: "ok" });
    });

    it("casdoor:session-register 注册会话 (透传完整 input)", async () => {
      casdoorResourcesMock.registerSession.mockReturnValue({ ok: true });
      const result = await callHandler("casdoor:session-register", { sessionId: "s1", kind: "harness" });
      expect(casdoorResourcesMock.registerSession).toHaveBeenCalledWith({ sessionId: "s1", kind: "harness" });
      expect(result).toEqual({ ok: true });
    });

    it("casdoor:session-unregister 注销会话", async () => {
      casdoorResourcesMock.unregisterSession.mockReturnValue({ ok: true });
      const result = await callHandler("casdoor:session-unregister", { sessionId: "s1" });
      expect(casdoorResourcesMock.unregisterSession).toHaveBeenCalledWith("s1");
      expect(result).toEqual({ ok: true });
    });
  });

  describe("casdoor:open-* external page opener", () => {
    it("casdoor:open-management 验证 configured + capability + URL 后打开浏览器", async () => {
      setStatus({ config: { configured: true, issuer: "https://casdoor.example", managementUrl: "https://casdoor.example/admin" } });
      casdoorAuthMock.assertAuthorized.mockReturnValue(true);
      const { shell } = await import("electron");
      (shell.openExternal as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const result = await callHandler("casdoor:open-management");
      expect(casdoorAuthMock.assertAuthorized).toHaveBeenCalledWith({ capability: "admin.portal" }, expect.any(String));
      expect(shell.openExternal).toHaveBeenCalledWith("https://casdoor.example/admin");
      expect(result).toEqual({ ok: true });
    });

    it("casdoor:open-management 在未配置时 throw", async () => {
      setStatus({ config: { configured: false, issuer: "", managementUrl: "" } });
      await expect(callHandler("casdoor:open-management")).rejects.toThrow("Casdoor 配置无效");
      const { shell } = await import("electron");
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it("casdoor:open-management 在 managementUrl 非法时 throw", async () => {
      setStatus({ config: { configured: true, issuer: "x", managementUrl: "javascript:alert(1)" } });
      casdoorAuthMock.assertAuthorized.mockReturnValue(true);
      await expect(callHandler("casdoor:open-management")).rejects.toThrow("Casdoor 管理地址无效");
      const { shell } = await import("electron");
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it("casdoor:open-management 在无 admin.portal 权限时 throw", async () => {
      setStatus({ config: { configured: true, issuer: "https://casdoor.example", managementUrl: "https://casdoor.example/admin" } });
      casdoorAuthMock.assertAuthorized.mockImplementation(() => { throw new Error("no admin.portal"); });
      await expect(callHandler("casdoor:open-management")).rejects.toThrow("no admin.portal");
      const { shell } = await import("electron");
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it("casdoor:open-membership-management 验证 configured + tenant.users.read 后打开浏览器", async () => {
      setStatus({ config: { configured: true, issuer: "https://casdoor.example", managementUrl: "https://casdoor.example/members" } });
      casdoorAuthMock.assertAuthorized.mockReturnValue(true);
      const { shell } = await import("electron");
      (shell.openExternal as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const result = await callHandler("casdoor:open-membership-management");
      expect(casdoorAuthMock.assertAuthorized).toHaveBeenCalledWith({ permission: "tenant.users.read" }, expect.any(String));
      expect(shell.openExternal).toHaveBeenCalledWith("https://casdoor.example/members");
      expect(result).toEqual({ ok: true });
    });

    it("casdoor:open-membership-management 在未配置时 throw", async () => {
      setStatus({ config: { configured: false, issuer: "", managementUrl: "" } });
      await expect(callHandler("casdoor:open-membership-management")).rejects.toThrow("Casdoor 配置无效");
    });
  });
});
