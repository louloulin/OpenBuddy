import { describe, expect, it } from "vitest"
import {
  normalizeCasdoorClaims,
  mergeCasdoorClaims,
  restrictCasdoorClaimsFromUserinfo,
  hasCasdoorCapability,
  CASDOOR_CAPABILITIES,
  type CasdoorIdentity,
} from "@openbuddy/auth-casdoor"

describe("casdoor-permissions pure helpers", () => {
  describe("normalizeCasdoorClaims", () => {
    it("extracts subject and basic fields", () => {
      const id = normalizeCasdoorClaims({
        sub: "user-1",
        displayName: "Alice",
        email: "alice@example.com",
      })
      expect(id.subject).toBe("user-1")
      expect(id.displayName).toBe("Alice")
      expect(id.email).toBe("alice@example.com")
    })

    it("normalizes roles from roles or role key", () => {
      const a = normalizeCasdoorClaims({ sub: "x", roles: ["admin", "user"] })
      const b = normalizeCasdoorClaims({ sub: "x", role: "admin" })
      expect(a.roles).toEqual(["admin", "user"])
      expect(b.roles).toEqual(["admin"])
    })

    it("normalizes capabilities from any of the recognized keys", () => {
      const a = normalizeCasdoorClaims({ sub: "x", capabilities: ["team.workspace", "cloud.sync"] })
      const b = normalizeCasdoorClaims({ sub: "x", scopes: ["audit.read"] })
      const c = normalizeCasdoorClaims({ sub: "x", permissions: ["billing.read"] })
      expect(a.capabilities).toEqual(["team.workspace", "cloud.sync"])
      expect(b.capabilities).toEqual(["audit.read"])
      expect(c.capabilities).toEqual(["billing.read"])
    })

    it("defaults to empty arrays when nothing is provided", () => {
      const id = normalizeCasdoorClaims({ sub: "x" })
      expect(id.roles).toEqual([])
      expect(id.capabilities).toEqual([])
    })
  })

  describe("mergeCasdoorClaims", () => {
    it("signed claims win over userinfo on collision", () => {
      const merged = mergeCasdoorClaims(
        { sub: "signed", name: "Alice" },
        { sub: "userinfo", email: "a@x.com" },
      )
      expect(merged["sub"]).toBe("signed")
      expect(merged["name"]).toBe("Alice")
      expect(merged["email"]).toBe("a@x.com")
    })

    it("merges non-authorization claims from userinfo", () => {
      const merged = mergeCasdoorClaims(
        { sub: "signed" },
        { name: "from-userinfo", email: "a@x.com" },
      )
      expect(merged["sub"]).toBe("signed")
      expect(merged["name"]).toBe("from-userinfo")
      expect(merged["email"]).toBe("a@x.com")
    })
    it("restricts roles to intersection when both sides provide them", () => {
      const merged = mergeCasdoorClaims(
        { roles: ["admin", "user"] },
        { roles: ["user"] },
      )
      // Both signed and userinfo have "user" — it survives; "admin" only in signed is dropped.
      expect(merged["roles"]).toEqual(["user"])
    })
  })

  describe("restrictCasdoorClaimsFromUserinfo", () => {
    it("strips authorization-related keys from userinfo before merging", () => {
      const restricted = restrictCasdoorClaimsFromUserinfo(
        { sub: "signed" },
        { sub: "userinfo", roles: ["user"], email: "a@x.com" },
      )
      expect(restricted["sub"]).toBe("signed")
      expect(restricted["email"]).toBe("a@x.com")
      // roles from userinfo are dropped because signed has none → restrictClaimSet returns []
      expect(restricted["roles"]).toEqual([])
    })
  })

  describe("hasCasdoorCapability", () => {
    it("returns true when identity has capability", () => {
      const id: CasdoorIdentity = {
        subject: "x",
        displayName: "X",
        organizations: [],
        isForbidden: false,
        isDeleted: false,
        isAdmin: false,
        roles: [],
        permissions: [],
        groups: [],
        capabilities: ["billing.read"],
        tenantMemberships: [],
      }
      expect(hasCasdoorCapability(id, "billing.read")).toBe(true)
    })
    it("returns false when missing", () => {
      const id: CasdoorIdentity = { subject: "x", displayName: "X", organizations: [], isForbidden: false, isDeleted: false, isAdmin: false, roles: [], permissions: [], groups: [], capabilities: [], tenantMemberships: [] }
      expect(hasCasdoorCapability(id, "billing.read")).toBe(false)
    })
    it("handles null identity", () => {
      expect(hasCasdoorCapability(null, "billing.read")).toBe(false)
    })
  })

  describe("CASDOOR_CAPABILITIES constant", () => {
    it("is a non-empty string list", () => {
      expect(CASDOOR_CAPABILITIES.length).toBeGreaterThan(0)
      for (const c of CASDOOR_CAPABILITIES) expect(typeof c).toBe("string")
    })
  })
})
