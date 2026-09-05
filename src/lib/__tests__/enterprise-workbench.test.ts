import { describe, expect, it } from "vitest";
import { workbenchRequirement, workbenchResourceForChannel } from "../enterprise/enterprise-workbench";

describe("enterprise workbench authorization mapping", () => {
  it("maps shared agent surfaces to the team capability", () => {
    expect(workbenchRequirement("agent", "write")).toEqual({ capability: "team.workspace" });
    expect(workbenchResourceForChannel("agents_save")).toBe("agent");
    expect(workbenchResourceForChannel("mcp:upsert")).toBe("mcp");
  });

  it("maps protected resources and management to their narrower permissions", () => {
    expect(workbenchRequirement("project", "read")).toEqual({ capability: "protected.resources" });
    expect(workbenchRequirement("storage_connection", "write")).toEqual({ capability: "cloud.sync" });
    expect(workbenchRequirement("casdoor_management", "read")).toEqual({ permission: "tenant.settings.read" });
  });

  it("does not classify unrelated renderer channels as enterprise workbench resources", () => {
    expect(workbenchResourceForChannel("dialog:open")).toBeUndefined();
    expect(workbenchResourceForChannel("notification_list")).toBeUndefined();
  });

  it("classifies agent execution and authorization channels", () => {
    expect(workbenchResourceForChannel("agent:prompt")).toBe("session");
    expect(workbenchResourceForChannel("agent:resolve-permission")).toBe("session");
    expect(workbenchResourceForChannel("agent:init")).toBeUndefined();
    expect(workbenchResourceForChannel("agent:current-model")).toBe("model");
  });
});
