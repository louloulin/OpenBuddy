import { describe, expect, it } from "vitest";
import { workbenchPiHome, workbenchScopeKey } from "../security/workbench-scope";

describe("workbench scope", () => {
  it("keeps local mode backward compatible", () => {
    expect(workbenchScopeKey({ configured: false })).toBe("local");
    expect(workbenchPiHome({ configured: false }, "/user-data", "/legacy/.pi/agent")).toBe("/legacy/.pi/agent");
  });

  it("separates tenants and subjects", () => {
    const tenantA = workbenchScopeKey({ configured: true, tenantId: "tenant-a", subject: "user-1" });
    const tenantB = workbenchScopeKey({ configured: true, tenantId: "tenant-b", subject: "user-1" });
    const userB = workbenchScopeKey({ configured: true, tenantId: "tenant-a", subject: "user-2" });
    expect(tenantA).not.toBe(tenantB);
    expect(tenantA).not.toBe(userB);
    expect(workbenchPiHome({ configured: true, tenantId: "tenant-a", subject: "user-1" }, "/user-data", "/legacy")).toContain("/user-data/workspaces/");
  });

  it("does not allow identity values to escape the workspace root", () => {
    const path = workbenchPiHome({ configured: true, tenantId: "../tenant", subject: "user/../../other" }, "/user-data", "/legacy");
    expect(path.startsWith("/user-data/workspaces/")).toBe(true);
    expect(path).not.toContain("..");
    expect(path).not.toContain("/tenant/");
  });

  it("uses an isolated scope while Casdoor is configured but signed out", () => {
    expect(workbenchScopeKey({ configured: true })).toBe("signed-out");
    expect(workbenchPiHome({ configured: true }, "/user-data", "/legacy")).toBe("/user-data/workspaces/signed-out/pi-agent");
  });
});
