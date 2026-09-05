import { describe, expect, it } from "vitest"
import {
  authorizeCasdoorTenant,
  buildCasdoorTenantContext,
  casdoorAuthorizationCode,
  casdoorTenantMembership,
  defaultCasdoorTenantId,
  type CasdoorAuthorizationRequirement,
} from "@openbuddy/auth-casdoor"
import type { CasdoorIdentity, CasdoorTenantMembership } from "@openbuddy/auth-casdoor"

function makeIdentity(overrides: Partial<CasdoorIdentity> = {}): CasdoorIdentity {
  return {
    subject: "user-1",
    organizations: ["org-1"],
    isForbidden: false,
    isDeleted: false,
    isAdmin: false,
    roles: [],
    permissions: [],
    groups: [],
    capabilities: [],
    tenantMemberships: [],
    ...overrides,
  }
}

const tenantAMembership: CasdoorTenantMembership = {
  tenantId: "tenant-a",
  roles: ["developer"],
  permissions: ["email.send", "billing.read"],
  groups: [],
  capabilities: ["team.workspace", "cloud.sync"],
  tenantPermissions: ["tenant.users.read"],
  isTenantAdmin: false,
}

const tenantBMembership: CasdoorTenantMembership = {
  tenantId: "tenant-b",
  roles: ["admin"],
  permissions: ["*"],
  groups: [],
  capabilities: ["admin.portal"],
  tenantPermissions: ["tenant.users.write", "tenant.billing.write"],
  isTenantAdmin: true,
}

describe("casdoor-authorization pure helpers", () => {
  describe("casdoorAuthorizationCode", () => {
    it("maps every reason to its canonical code", () => {
      expect(casdoorAuthorizationCode("allowed")).toBe("CASDOOR_AUTHORIZED")
      expect(casdoorAuthorizationCode("signed_out")).toBe("CASDOOR_SIGNED_OUT")
      expect(casdoorAuthorizationCode("tenant_not_selected")).toBe("CASDOOR_TENANT_REQUIRED")
      expect(casdoorAuthorizationCode("tenant_not_member")).toBe("CASDOOR_TENANT_MEMBERSHIP_REQUIRED")
      expect(casdoorAuthorizationCode("user_forbidden")).toBe("CASDOOR_USER_FORBIDDEN")
      expect(casdoorAuthorizationCode("permission_denied")).toBe("CASDOOR_PERMISSION_DENIED")
    })
  })

  describe("defaultCasdoorTenantId", () => {
    it("returns undefined for null or forbidden identity", () => {
      expect(defaultCasdoorTenantId(null)).toBeUndefined()
      expect(defaultCasdoorTenantId(makeIdentity({ isForbidden: true }))).toBeUndefined()
      expect(defaultCasdoorTenantId(makeIdentity({ isDeleted: true }))).toBeUndefined()
    })
    it("prefers the first tenant membership over owner", () => {
      const id = makeIdentity({
        tenantMemberships: [tenantAMembership, tenantBMembership],
        owner: "owner-1",
        organization: "org-z",
      })
      expect(defaultCasdoorTenantId(id)).toBe("tenant-a")
    })
    it("falls back to owner when no memberships exist", () => {
      const id = makeIdentity({ owner: "owner-1" })
      expect(defaultCasdoorTenantId(id)).toBe("owner-1")
    })
    it("falls back to organization then first organization", () => {
      expect(defaultCasdoorTenantId(makeIdentity({ organization: "org-x" }))).toBe("org-x")
      expect(defaultCasdoorTenantId(makeIdentity({ organizations: ["first", "second"] }))).toBe("first")
    })
  })

  describe("casdoorTenantMembership", () => {
    it("returns undefined for null identity or missing tenantId", () => {
      expect(casdoorTenantMembership(null, "x")).toBeUndefined()
      expect(casdoorTenantMembership(makeIdentity(), undefined)).toBeUndefined()
    })
    it("finds the matching membership", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership, tenantBMembership] })
      expect(casdoorTenantMembership(id, "tenant-a")?.roles).toEqual(["developer"])
      expect(casdoorTenantMembership(id, "tenant-b")?.isTenantAdmin).toBe(true)
    })
    it("returns undefined for unknown tenantId", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      expect(casdoorTenantMembership(id, "tenant-zzz")).toBeUndefined()
    })
  })

  describe("buildCasdoorTenantContext", () => {
    it("auto-selects when only one tenant is available", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const ctx = buildCasdoorTenantContext(id)
      expect(ctx.activeTenantId).toBe("tenant-a")
      expect(ctx.membership?.tenantId).toBe("tenant-a")
      expect(ctx.availableTenantIds).toEqual(["tenant-a"])
    })
    it("requires explicit selection when multiple tenants available", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership, tenantBMembership] })
      const ctx = buildCasdoorTenantContext(id)
      expect(ctx.activeTenantId).toBeUndefined()
      expect(ctx.availableTenantIds).toEqual(["tenant-a", "tenant-b"])
    })
    it("uses the explicit active tenantId when it is in the list", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership, tenantBMembership] })
      const ctx = buildCasdoorTenantContext(id, "tenant-b")
      expect(ctx.activeTenantId).toBe("tenant-b")
      expect(ctx.membership?.tenantId).toBe("tenant-b")
    })
    it("ignores activeTenantId that is not in the available list", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const ctx = buildCasdoorTenantContext(id, "tenant-zzz")
      expect(ctx.activeTenantId).toBe("tenant-a")
    })
    it("surfaces plans across tenants", () => {
      const id = makeIdentity({
        tenantMemberships: [
          { ...tenantAMembership, plan: "team" },
          { ...tenantBMembership, plan: "enterprise" },
        ],
      })
      const ctx = buildCasdoorTenantContext(id)
      expect(ctx.plansByTenantId).toEqual({ "tenant-a": "team", "tenant-b": "enterprise" })
    })
  })

  describe("authorizeCasdoorTenant", () => {
    it("returns signed_out for null identity", () => {
      const d = authorizeCasdoorTenant(null, "tenant-a", { capability: "team.workspace" })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe("signed_out")
      expect(d.code).toBe("CASDOOR_SIGNED_OUT")
    })
    it("returns user_forbidden for forbidden or deleted identity", () => {
      const d = authorizeCasdoorTenant(makeIdentity({ isForbidden: true }), "tenant-a", { capability: "team.workspace" })
      expect(d.reason).toBe("user_forbidden")
      expect(d.subject).toBe("user-1")
    })
    it("returns tenant_not_selected when tenantId missing", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const d = authorizeCasdoorTenant(id, undefined, { capability: "team.workspace" })
      expect(d.reason).toBe("tenant_not_selected")
    })
    it("returns tenant_not_member for unknown tenantId", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const d = authorizeCasdoorTenant(id, "tenant-zzz", { capability: "team.workspace" })
      expect(d.reason).toBe("tenant_not_member")
    })

    it("allows when membership has the capability and identity carries it", () => {
      const id = makeIdentity({
        tenantMemberships: [tenantAMembership],
        capabilities: ["team.workspace", "cloud.sync"],
      })
      const d = authorizeCasdoorTenant(id, "tenant-a", { capability: "team.workspace" })
      expect(d.allowed).toBe(true)
      expect(d.reason).toBe("allowed")
      expect(d.code).toBe("CASDOOR_AUTHORIZED")
      expect(d.tenantId).toBe("tenant-a")
    })

    it("denies capability even if membership has it but identity lacks it", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership], capabilities: [] })
      const d = authorizeCasdoorTenant(id, "tenant-a", { capability: "team.workspace" })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe("permission_denied")
    })

    it("allows when tenant membership has the tenant permission", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const d = authorizeCasdoorTenant(id, "tenant-a", { permission: "tenant.users.read" })
      expect(d.allowed).toBe(true)
    })

    it("denies when tenant membership lacks the tenant permission", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const d = authorizeCasdoorTenant(id, "tenant-a", { permission: "tenant.billing.write" })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe("permission_denied")
    })

    it("grants resource+action to admin identity", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership], isAdmin: true })
      const d = authorizeCasdoorTenant(id, "tenant-a", { resource: "email", action: "send" })
      expect(d.allowed).toBe(true)
      expect(d.resource).toBe("email")
      expect(d.action).toBe("send")
    })

    it("grants resource+action to tenant admin", () => {
      const id = makeIdentity({ tenantMemberships: [tenantBMembership] })
      const d = authorizeCasdoorTenant(id, "tenant-b", { resource: "billing", action: "write" })
      expect(d.allowed).toBe(true)
    })

    it("grants resource+action via dot-separated permission", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const d = authorizeCasdoorTenant(id, "tenant-a", { resource: "email", action: "send" })
      expect(d.allowed).toBe(true)
    })

    it("grants resource+action via wildcard permission on resource", () => {
      const id = makeIdentity({
        tenantMemberships: [
          { ...tenantAMembership, permissions: ["email.*"] },
        ],
      })
      const d = authorizeCasdoorTenant(id, "tenant-a", { resource: "email", action: "send" })
      expect(d.allowed).toBe(true)
    })

    it("denies resource+action when no matching permission and not admin", () => {
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const d = authorizeCasdoorTenant(id, "tenant-a", { resource: "billing", action: "write" })
      expect(d.allowed).toBe(false)
      expect(d.resource).toBe("billing")
      expect(d.action).toBe("write")
    })

    it("supports resource-only requirement with action", () => {
      const req: CasdoorAuthorizationRequirement = { resource: "email", action: "send", resourceId: "msg-1" }
      const id = makeIdentity({ tenantMemberships: [tenantAMembership] })
      const d = authorizeCasdoorTenant(id, "tenant-a", req)
      expect(d.allowed).toBe(true)
    })
  })
})
