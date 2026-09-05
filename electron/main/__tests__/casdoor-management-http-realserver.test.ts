// @vitest-environment node
/**
 * Real end-to-end test for the casdoor-management functions called by the
 * `casdoor:list-users`, `casdoor:list-organizations`, `casdoor:list-roles`,
 * `casdoor:list-permissions`, `casdoor:list-groups`, `casdoor:list-rules`,
 * `casdoor:user-add`, `casdoor:user-update`, `casdoor:user-delete`,
 * `casdoor:role-add`, `casdoor:role-update`, `casdoor:role-delete`,
 * `casdoor:permission-add`, `casdoor:permission-update`,
 * `casdoor:permission-delete`, `casdoor:organization-add`,
 * `casdoor:organization-update`, `casdoor:organization-delete`,
 * `casdoor:group-add`, `casdoor:group-update`, `casdoor:group-delete`,
 * `casdoor:rule-add`, `casdoor:rule-update`, `casdoor:rule-delete`,
 * IPC handlers defined in `electron/main/ipc.ts`.
 *
 * Uses a real local HTTP server (127.0.0.1) to handle the /api/get-*,
 * /api/add-*, /api/update-*, /api/delete-* endpoints. No fetch mocks.
 * casdoorAuth is minimally mocked (hoisted) only to inject the test issuer
 * and admin permissions — the HTTP layer is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-casdoor-mgmt-realserver" },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
}));

const { casdoorAuthMock, casdoorAuditMock } = vi.hoisted(() => ({
  casdoorAuthMock: {
    status: vi.fn(),
    assertAuthorized: vi.fn(),
    getAccessToken: vi.fn<() => string | null>(() => "test-bearer-token"),
    revalidateCurrentSession: vi.fn<() => Promise<{ status: string; config: { configured: boolean; issuer: string }; identity: null; tenantContext: { activeTenantId: string } }>>(async () => ({ status: "signed_in", config: { configured: true, issuer: "" }, identity: null, tenantContext: { activeTenantId: "acme" } })),
  },
  casdoorAuditMock: { record: vi.fn<(arg: unknown) => Promise<void>>(async () => undefined) },
}));

vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("../casdoor/casdoor-audit", () => ({ casdoorAudit: casdoorAuditMock }));

// Import after mocks are in place
import {
  listCasdoorUsers,
  listCasdoorOrganizations,
  listCasdoorRoles,
  listCasdoorPermissions,
  listCasdoorGroups,
  listCasdoorRules,
  saveCasdoorUser,
  updateCasdoorUser,
  deleteCasdoorUser,
  saveCasdoorRole,
  updateCasdoorRole,
  deleteCasdoorRole,
  saveCasdoorPermission,
  updateCasdoorPermission,
  deleteCasdoorPermission,
  saveCasdoorOrganization,
  updateCasdoorOrganization,
  deleteCasdoorOrganization,
  saveCasdoorGroup,
  updateCasdoorGroup,
  deleteCasdoorGroup,
  saveCasdoorRule,
  updateCasdoorRule,
  deleteCasdoorRule,
  type CasdoorListQuery,
} from "../casdoor/casdoor-management";

let server: Server;
let baseUrl = "";

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
  authHeader: string | undefined;
  contentType: string | undefined;
}

const captured: CapturedRequest[] = [];

function resetMockAuth(issuer: string): void {
  casdoorAuthMock.status.mockReset();
  casdoorAuthMock.status.mockReturnValue({
    config: { configured: true, issuer, clientId: "test-client" },
    identity: { subject: "test-admin", isAdmin: true, owner: "acme", organization: "acme" },
    tenantContext: { activeTenantId: "acme" },
  });
  casdoorAuthMock.assertAuthorized.mockReset();
  casdoorAuthMock.assertAuthorized.mockReturnValue(true);
  casdoorAuthMock.getAccessToken.mockReset();
  casdoorAuthMock.getAccessToken.mockReturnValue("test-bearer-token");
  casdoorAuthMock.revalidateCurrentSession.mockReset();
  casdoorAuthMock.revalidateCurrentSession.mockResolvedValue({ status: "signed_in", config: { configured: true, issuer }, identity: null, tenantContext: { activeTenantId: "acme" } });
  casdoorAuditMock.record.mockClear();
}

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    captured.push({
      method: req.method ?? "GET",
      url: req.url ?? "/",
      body,
      authHeader: typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
      contentType: typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined,
    });
    const urlPath = (req.url ?? "/").split("?")[0];
    const respond = (status: number, payload: unknown): void => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
    };
    try {
      // List endpoints (GET /api/get-*)
      if (urlPath.startsWith("/api/get-") && (req.method ?? "GET") === "GET") {
        const kind = urlPath.slice("/api/get-".length);
        const params = new URL(req.url ?? "/", "http://x").searchParams;
        if (kind === "users") {
          return respond(200, {
            status: "ok",
            data: [
              { owner: params.get("owner") ?? "acme", name: "alice", displayName: "Alice", email: "alice@acme.test", isAdmin: false },
              { owner: params.get("owner") ?? "acme", name: "bob", displayName: "Bob", email: "bob@acme.test", isAdmin: true },
            ],
          });
        }
        if (kind === "organizations") {
          return respond(200, { status: "ok", data: [{ owner: "acme", name: "acme", displayName: "Acme" }] });
        }
        if (kind === "roles") {
          return respond(200, { status: "ok", data: [{ owner: "acme", name: "admin", displayName: "Admin", isEnabled: true, users: ["alice"] }] });
        }
        if (kind === "permissions") {
          return respond(200, { status: "ok", data: [{ owner: "acme", name: "read", displayName: "Read", resourceType: "doc", actions: ["read"], effect: "allow" }] });
        }
        if (kind === "groups") {
          return respond(200, { status: "ok", data: [{ owner: "acme", name: "team-a", displayName: "Team A", isEnabled: true }] });
        }
        if (kind === "rules") {
          return respond(200, { status: "ok", data: [{ owner: "acme", name: "rule-a", displayName: "Rule A", expressions: "1==1" }] });
        }
      }
      // Write endpoints (POST /api/{add,update,delete}-*)
      if (urlPath.startsWith("/api/") && (req.method ?? "GET") === "POST") {
        return respond(200, { status: "ok", data: { ok: true } });
      }
      return respond(404, { status: "error", msg: `unregistered route: ${req.method} ${urlPath}` });
    } catch (error) {
      return respond(500, { status: "error", msg: String(error instanceof Error ? error.message : error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetMockAuth(baseUrl);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  captured.length = 0;
  resetMockAuth(baseUrl);
  casdoorAuditMock.record.mockClear();
});

describe("casdoor-management list functions 真实本地 HTTP 服务器", () => {
  it("listCasdoorUsers: GET /api/get-users with Bearer token, returns sanitized array", async () => {
    const query: CasdoorListQuery = { owner: "acme", pageSize: 50 };
    const users = await listCasdoorUsers(query);
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ owner: "acme", name: "alice", displayName: "Alice", email: "alice@acme.test", isAdmin: false });
    expect(users[1]).toMatchObject({ owner: "acme", name: "bob", isAdmin: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.method).toBe("GET");
    expect(captured[0]!.url).toContain("/api/get-users");
    expect(captured[0]!.url).toContain("owner=acme");
    expect(captured[0]!.url).toContain("pageSize=50");
    expect(captured[0]!.authHeader).toBe("Bearer test-bearer-token");
  });

  it("listCasdoorOrganizations: returns org list", async () => {
    const orgs = await listCasdoorOrganizations({ owner: "acme" });
    expect(orgs).toEqual([{ owner: "acme", name: "acme", displayName: "Acme", websiteUrl: undefined, createdTime: undefined, disableSignin: undefined }]);
    expect(captured[0]!.url).toContain("/api/get-organizations");
  });

  it("listCasdoorRoles: returns role list with subUsers", async () => {
    const roles = await listCasdoorRoles({ owner: "acme" });
    expect(roles).toHaveLength(1);
    expect(roles[0]?.name).toBe("admin");
    expect(roles[0]?.users).toContain("alice");
    expect(captured[0]!.url).toContain("/api/get-roles");
  });

  it("listCasdoorPermissions: returns permission list with actions + effect", async () => {
    const perms = await listCasdoorPermissions({ owner: "acme" });
    expect(perms[0]?.actions).toContain("read");
    expect(perms[0]?.effect).toBe("allow");
    expect(captured[0]!.url).toContain("/api/get-permissions");
  });

  it("listCasdoorGroups: returns group list with isEnabled", async () => {
    const groups = await listCasdoorGroups({ owner: "acme" });
    expect(groups[0]?.isEnabled).toBe(true);
    expect(captured[0]!.url).toContain("/api/get-groups");
  });

  it("listCasdoorRules: returns rule list with expressions", async () => {
    const rules = await listCasdoorRules({ owner: "acme" });
    expect(rules[0]?.expressions).toBe("1==1");
    expect(captured[0]!.url).toContain("/api/get-rules");
  });

  it("list functions record audit success on each call", async () => {
    await listCasdoorUsers({ owner: "acme" });
    await listCasdoorRoles({ owner: "acme" });
    expect(casdoorAuditMock.record).toHaveBeenCalledTimes(2);
    expect(casdoorAuditMock.record.mock.calls[0]?.[0]).toMatchObject({ event: "casdoor.management", outcome: "success", resource: "user", action: "read" });
    expect(casdoorAuditMock.record.mock.calls[1]?.[0]).toMatchObject({ resource: "role", action: "read" });
  });

  it("list failure records audit failure when server returns error", async () => {
    // Stop the original server and start one that returns 500
    const errorServer = createServer((req, res) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ status: "error", msg: "downstream unavailable" }));
    });
    await new Promise<void>((resolve) => errorServer.listen(0, "127.0.0.1", () => resolve()));
    const port = (errorServer.address() as AddressInfo).port;
    resetMockAuth(`http://127.0.0.1:${port}`);
    try {
      await expect(listCasdoorUsers({ owner: "acme" })).rejects.toThrow();
      expect(casdoorAuditMock.record).toHaveBeenCalledWith(expect.objectContaining({ event: "casdoor.management", outcome: "failure" }));
    } finally {
      await new Promise<void>((resolve) => errorServer.close(() => resolve()));
      resetMockAuth(baseUrl);
    }
  });
});

describe("casdoor-management CRUD write functions 真实本地 HTTP 服务器", () => {
  it("saveCasdoorUser → POST /api/add-user with trimmed payload + Bearer", async () => {
    await saveCasdoorUser({ owner: "acme", name: "carol", displayName: "Carol", email: "carol@acme.test" });
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/api/add-user");
    expect(req.contentType).toContain("application/json");
    expect(req.authHeader).toBe("Bearer test-bearer-token");
    const body = JSON.parse(req.body);
    expect(body).toEqual({ owner: "acme", name: "carol", displayName: "Carol", email: "carol@acme.test" });
  });

  it("updateCasdoorUser → POST /api/update-user?id=owner/name", async () => {
    await updateCasdoorUser({ owner: "acme", name: "carol", displayName: "Carol Updated", email: "carol2@acme.test", isForbidden: false });
    const req = captured[0]!;
    expect(req.url).toContain("/api/update-user");
    expect(req.url).toMatch(/id=acme\/carol/);
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ owner: "acme", name: "carol", displayName: "Carol Updated", email: "carol2@acme.test", isForbidden: false });
  });

  it("deleteCasdoorUser → POST /api/delete-user", async () => {
    await deleteCasdoorUser("acme", "carol");
    const req = captured[0]!;
    expect(req.url).toContain("/api/delete-user");
    const body = JSON.parse(req.body);
    expect(body).toEqual({ owner: "acme", name: "carol" });
  });

  it("saveCasdoorRole → POST /api/add-role with users array", async () => {
    await saveCasdoorRole({ owner: "acme", name: "dev", displayName: "Dev", users: ["alice", "bob"] });
    const req = captured[0]!;
    expect(req.url).toContain("/api/add-role");
    const body = JSON.parse(req.body);
    expect(body.users).toEqual(["alice", "bob"]);
  });

  it("updateCasdoorRole → POST /api/update-role", async () => {
    await updateCasdoorRole({ owner: "acme", name: "dev", isEnabled: false });
    expect(captured[0]!.url).toContain("/api/update-role");
  });

  it("deleteCasdoorRole → POST /api/delete-role", async () => {
    await deleteCasdoorRole("acme", "dev");
    expect(captured[0]!.url).toContain("/api/delete-role");
  });

  it("saveCasdoorPermission → POST /api/add-permission", async () => {
    await saveCasdoorPermission({ owner: "acme", name: "write", displayName: "Write", resourceType: "doc", actions: ["write"], effect: "allow" });
    expect(captured[0]!.url).toContain("/api/add-permission");
  });

  it("updateCasdoorPermission → POST /api/update-permission", async () => {
    await updateCasdoorPermission({ owner: "acme", name: "write", displayName: "Write All" });
    expect(captured[0]!.url).toContain("/api/update-permission");
  });

  it("deleteCasdoorPermission → POST /api/delete-permission", async () => {
    await deleteCasdoorPermission("acme", "write");
    expect(captured[0]!.url).toContain("/api/delete-permission");
  });

  it("saveCasdoorOrganization → POST /api/add-organization", async () => {
    await saveCasdoorOrganization({ owner: "acme", name: "acme", displayName: "Acme Co" });
    expect(captured[0]!.url).toContain("/api/add-organization");
  });

  it("updateCasdoorOrganization → POST /api/update-organization", async () => {
    await updateCasdoorOrganization({ owner: "acme", name: "acme", websiteUrl: "https://acme.test" });
    expect(captured[0]!.url).toContain("/api/update-organization");
  });

  it("deleteCasdoorOrganization → POST /api/delete-organization", async () => {
    await deleteCasdoorOrganization("acme", "acme");
    expect(captured[0]!.url).toContain("/api/delete-organization");
  });

  it("saveCasdoorGroup → POST /api/add-group", async () => {
    await saveCasdoorGroup({ owner: "acme", name: "team-a", displayName: "Team A" });
    expect(captured[0]!.url).toContain("/api/add-group");
  });

  it("updateCasdoorGroup → POST /api/update-group", async () => {
    await updateCasdoorGroup({ owner: "acme", name: "team-a", displayName: "Team A Updated" });
    expect(captured[0]!.url).toContain("/api/update-group");
  });

  it("deleteCasdoorGroup → POST /api/delete-group", async () => {
    await deleteCasdoorGroup("acme", "team-a");
    expect(captured[0]!.url).toContain("/api/delete-group");
  });

  it("saveCasdoorRule → POST /api/add-rule", async () => {
    await saveCasdoorRule({ owner: "acme", name: "rule-a", type: "PolicyRule", expressions: [{ value: "1==1" }] });
    expect(captured[0]!.url).toContain("/api/add-rule");
  });

  it("updateCasdoorRule → POST /api/update-rule", async () => {
    await updateCasdoorRule({ owner: "acme", name: "rule-a", type: "PolicyRule", isVerbose: true });
    expect(captured[0]!.url).toContain("/api/update-rule");
  });

  it("deleteCasdoorRule → POST /api/delete-rule", async () => {
    await deleteCasdoorRule("acme", "rule-a");
    expect(captured[0]!.url).toContain("/api/delete-rule");
  });

  it("write operations record audit success", async () => {
    await saveCasdoorUser({ owner: "acme", name: "u", displayName: "U" });
    await deleteCasdoorUser("acme", "u");
    expect(casdoorAuditMock.record.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ resource: "user", action: "create", outcome: "success" }),
      expect.objectContaining({ resource: "user", action: "delete", outcome: "success" }),
    ]);
  });

  it("missing access token rejects before HTTP call", async () => {
    casdoorAuthMock.getAccessToken.mockReturnValueOnce(null);
    await expect(saveCasdoorUser({ owner: "acme", name: "u", displayName: "U" })).rejects.toThrow(/Casdoor 会话不可用/);
    expect(captured).toHaveLength(0);
    expect(casdoorAuditMock.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }));
  });
});
