import { describe, expect, it } from "vitest";
import { normalizeSessionTenantIndex, sessionBindingBelongsTo } from "../security/session-tenancy";

describe("session tenant bindings", () => {
  it("normalizes legacy tenant-only entries without granting ownership", () => {
    expect(normalizeSessionTenantIndex({ old: "tenant-a", current: { tenantId: "tenant-a", subject: "user-a" } })).toEqual({
      old: { tenantId: "tenant-a", subject: "" },
      current: { tenantId: "tenant-a", subject: "user-a" },
    });
    expect(sessionBindingBelongsTo({ tenantId: "tenant-a", subject: "" }, "tenant-a", "user-a")).toBe(false);
  });

  it("requires both tenant and subject to match", () => {
    const binding = { tenantId: "tenant-a", subject: "user-a" };
    expect(sessionBindingBelongsTo(binding, "tenant-a", "user-a")).toBe(true);
    expect(sessionBindingBelongsTo(binding, "tenant-a", "user-b")).toBe(false);
    expect(sessionBindingBelongsTo(binding, "tenant-b", "user-a")).toBe(false);
  });
});
