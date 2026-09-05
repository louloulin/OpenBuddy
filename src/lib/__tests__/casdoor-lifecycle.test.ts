import { describe, expect, it } from "vitest";
import type { CasdoorLifecycleEvent } from "@openbuddy/auth-casdoor";

describe("Casdoor lifecycle contract", () => {
  it("represents scope changes without credentials", () => {
    const event: CasdoorLifecycleEvent = {
      kind: "tenant-switch",
      at: "2026-08-28T00:00:00.000Z",
      status: "signed_in",
      scope: "tenant-61-subject-75",
      previousScope: "tenant-61-subject-74",
      scopeChanged: true,
      tenantId: "tenant-a",
    };
    expect(event.scopeChanged).toBe(true);
    expect(event).not.toHaveProperty("accessToken");
    expect(event).not.toHaveProperty("refreshToken");
  });

  it("allows refresh events to invalidate same-scope renderer state", () => {
    const event: CasdoorLifecycleEvent = {
      kind: "refresh",
      at: "2026-08-28T00:00:00.000Z",
      status: "signed_in",
      scope: "tenant-61-subject-75",
      previousScope: "tenant-61-subject-75",
      scopeChanged: false,
      tenantId: "tenant-a",
    };
    expect(event.scopeChanged).toBe(false);
    expect(event.kind).toBe("refresh");
  });

  it("marks invalidation as a scope transition when credentials disappear", () => {
    const event: CasdoorLifecycleEvent = {
      kind: "session-invalidated",
      at: "2026-08-28T00:00:00.000Z",
      status: "signed_out",
      scope: "signed-out",
      previousScope: "tenant-61-subject-75",
      scopeChanged: true,
    };
    expect(event.status).toBe("signed_out");
    expect(event.tenantId).toBeUndefined();
  });
});
