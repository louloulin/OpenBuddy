import { describe, expect, it } from "vitest";
import {
  applyPatchOperations,
  matchesScimFilter,
  normalizeUserName,
  scimPaginate,
  serviceProviderConfig,
  type ScimUser,
} from "../index";

const sampleUser: ScimUser = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id: "u1",
  userName: "alice@example.com",
  displayName: "Alice",
  active: true,
  emails: [{ value: "alice@example.com", type: "work", primary: true }],
  meta: {
    resourceType: "User",
    created: "2026-01-01T00:00:00Z",
    lastModified: "2026-01-01T00:00:00Z",
  },
};

describe("normalizeUserName", () => {
  it("lowercases and trims valid email", () => {
    expect(normalizeUserName("  Alice@Example.com ")).toBe("alice@example.com");
  });
  it("rejects non-email", () => {
    expect(() => normalizeUserName("not-an-email")).toThrow();
    expect(() => normalizeUserName("")).toThrow();
  });
});

describe("scimPaginate", () => {
  it("returns slice with totalResults", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ ...sampleUser, id: `u${i}` }));
    const r = scimPaginate(items, 1, 10);
    expect(r.totalResults).toBe(25);
    expect(r.Resources).toHaveLength(10);
    expect(r.startIndex).toBe(1);
    expect(r.itemsPerPage).toBe(10);
  });
  it("clamps count to 1000", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ ...sampleUser, id: `u${i}` }));
    const r = scimPaginate(items, 1, 99999);
    expect(r.itemsPerPage).toBe(5);
  });
  it("clamps startIndex >= 1", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ ...sampleUser, id: `u${i}` }));
    const r = scimPaginate(items, -10, 5);
    expect(r.startIndex).toBe(1);
  });
});

describe("matchesScimFilter", () => {
  it("returns true when filter is undefined", () => {
    expect(matchesScimFilter(sampleUser, undefined)).toBe(true);
  });
  it("returns true on empty filter", () => {
    expect(matchesScimFilter(sampleUser, "")).toBe(true);
  });
  it("matches eq string", () => {
    expect(matchesScimFilter(sampleUser, `userName eq "alice@example.com"`)).toBe(true);
    expect(matchesScimFilter(sampleUser, `userName eq "bob@example.com"`)).toBe(false);
  });
  it("matches eq boolean", () => {
    expect(matchesScimFilter(sampleUser, "active eq true")).toBe(true);
    expect(matchesScimFilter(sampleUser, "active eq false")).toBe(false);
  });
  it("matches eq number", () => {
    const u = { ...sampleUser, id: "1" };
    expect(matchesScimFilter(u as ScimUser, 'id eq "1"')).toBe(true);
    expect(matchesScimFilter(u as ScimUser, 'id eq "2"')).toBe(false);
  });
  it("supports and", () => {
    expect(
      matchesScimFilter(sampleUser, `userName eq "alice@example.com" and active eq true`),
    ).toBe(true);
    expect(
      matchesScimFilter(sampleUser, `userName eq "alice@example.com" and active eq false`),
    ).toBe(false);
  });
  it("rejects unsupported filter operators", () => {
    expect(() => matchesScimFilter(sampleUser, `userName co "alice"`)).toThrow(/仅支持/);
    expect(() => matchesScimFilter(sampleUser, `displayName sw "A"`)).toThrow();
  });
});

describe("applyPatchOperations", () => {
  it("replaces top-level field", () => {
    const out = applyPatchOperations(sampleUser, [{ op: "replace", path: "displayName", value: "Alice2" }]);
    expect(out.displayName).toBe("Alice2");
  });
  it("adds new field", () => {
    const out = applyPatchOperations(sampleUser, [{ op: "add", path: "displayName", value: "Alice3" }]);
    expect(out.displayName).toBe("Alice3");
  });
  it("removes field", () => {
    const out = applyPatchOperations(sampleUser, [{ op: "remove", path: "displayName" }]);
    expect(out.displayName).toBeUndefined();
  });
  it("navigates nested path", () => {
    const out = applyPatchOperations(
      sampleUser,
      [{ op: "replace", path: "name.givenName", value: "Alice" }],
    );
    expect(out.name?.givenName).toBe("Alice");
  });
  it("removes from array by value", () => {
    const out = applyPatchOperations(sampleUser, [
      { op: "remove", path: "emails", value: [{ value: "alice@example.com", type: "work", primary: true }] },
    ]);
    expect(out.emails).toEqual([]);
  });
  it("supports whole-object replace via no path", () => {
    const out = applyPatchOperations(sampleUser, [
      { op: "add", value: { active: false } },
    ]);
    expect(out.active).toBe(false);
  });
});

describe("serviceProviderConfig", () => {
  it("returns valid SCIM config", () => {
    const cfg = serviceProviderConfig("https://api.example.com/");
    expect(cfg.patch).toEqual({ supported: true });
    expect(cfg.filter).toEqual({ supported: true, maxResults: 1000 });
    expect(cfg.meta.location).toBe("https://api.example.com/scim/v2/ServiceProviderConfig");
  });
});
