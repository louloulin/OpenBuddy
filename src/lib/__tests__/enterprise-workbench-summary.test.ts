import { describe, expect, it } from "vitest";
import type { CasdoorWorkbenchSummary } from "../casdoor/casdoor-client";

describe("enterprise workbench summary contract", () => {
  it("contains only safe identity and tenant context fields", () => {
    const summary: CasdoorWorkbenchSummary = {
      status: "signed_in",
      provider: "wechat",
      config: { configured: true },
      identity: {
        subject: "user-1",
        displayName: "User",
        email: "user@example.test",
        phone: undefined,
        organizations: ["tenant-a"],
        roles: ["member"],
        groups: ["engineering"],
        permissions: ["team.workspace"],
        capabilities: ["team.workspace"],
        isAdmin: false,
      },
      tenantContext: { activeTenantId: "tenant-a", availableTenantIds: ["tenant-a"] },
    };
    expect(summary).not.toHaveProperty("accessToken");
    expect(summary).not.toHaveProperty("refreshToken");
    expect(summary.identity?.organizations).toEqual(["tenant-a"]);
  });
});
