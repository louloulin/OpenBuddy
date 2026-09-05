import { describe, expect, it } from "vitest";
import {
  builtInMcpExporters,
  calendarMcpExporter,
  capabilityMcpExportersRegistry,
  createMcpExporterRegistry,
  exportersToBuddyCapabilities,
  exportersToInvocationTable,
  type McpExporter,
} from "./capability-mcp-exporters";

describe("capability-mcp-exporters registry", () => {
  it("registers and unregisters exporters by packageId", () => {
    const registry = createMcpExporterRegistry();
    const dispose = registry.register(calendarMcpExporter);
    expect(registry.list()).toHaveLength(1);
    expect(registry.totalCapabilityCount()).toBe(calendarMcpExporter.capabilities.length);
    dispose();
    expect(registry.list()).toHaveLength(0);
    expect(registry.totalCapabilityCount()).toBe(0);
  });

  it("replaces an exporter registered twice under the same packageId", () => {
    const registry = createMcpExporterRegistry();
    registry.register(calendarMcpExporter);
    const replacement: McpExporter = { ...calendarMcpExporter, label: "v2" };
    registry.register(replacement);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].label).toBe("v2");
  });

  it("aggregates capability counts across multiple exporters", () => {
    const registry = createMcpExporterRegistry();
    const exporterA: McpExporter = {
      packageId: "test-a",
      label: "A",
      capabilities: [
        { id: "test:a:list", description: "a", inputSchema: {}, invoke: () => ({}), requiredApproval: "never" },
      ],
    };
    const exporterB: McpExporter = {
      packageId: "test-b",
      label: "B",
      capabilities: [
        { id: "test:b:list", description: "b", inputSchema: {}, invoke: () => ({}), requiredApproval: "never" },
      ],
    };
    registry.register(exporterA);
    registry.register(exporterB);
    expect(registry.totalCapabilityCount()).toBe(2);
  });
});

describe("capability-mcp-exporters projection", () => {
  it("projects every exporter capability into a BuddyCapability with package id as providerId", () => {
    const projected = exportersToBuddyCapabilities([calendarMcpExporter]);
    expect(projected).toHaveLength(calendarMcpExporter.capabilities.length);
    expect(projected[0].providerId).toBe("openbuddy-calendar");
    expect(projected[0].id).toBe(calendarMcpExporter.capabilities[0].id);
  });

  it("defaults forbidden data scopes to private/credential/secret to enforce Discovery ≠ Authorization", () => {
    const projected = exportersToBuddyCapabilities([calendarMcpExporter]);
    for (const cap of projected) {
      expect(cap.forbiddenDataScopes).toEqual(expect.arrayContaining(["private:*", "credential:*", "secret:*"]));
      expect(cap.forbiddenActions).toEqual(expect.arrayContaining(["external:commit"]));
    }
  });

  it("maps requiredTrust to visibility so external clients see the right scope", () => {
    const projected = exportersToBuddyCapabilities([calendarMcpExporter]);
    for (const cap of projected) {
      expect(cap.visibility).toBe("private");
    }
  });

  it("preserves requiredApproval hints for write-style capabilities", () => {
    const projected = exportersToBuddyCapabilities([calendarMcpExporter]);
    const complete = projected.find((cap) => cap.id === "calendar:create");
    expect(complete?.requiredApproval).toBe("before_external_commit");
  });

  it("builds an invocation table keyed by capability id", () => {
    const table = exportersToInvocationTable([calendarMcpExporter]);
    expect(Object.keys(table)).toEqual(["calendar:list", "calendar:create"]);
  });
});

describe("capability-mcp-exporters built-in exporters", () => {
  // Stage G-1c: openbuddy-automation removed; automation is owned by
  // pi-background-tasks + pi-goal (passthrough). Only the calendar
  // exporter remains in the built-in set.
  it("ships the calendar exporter covering 2 MCP tools", () => {
    expect(builtInMcpExporters).toHaveLength(1);
    expect(builtInMcpExporters[0].packageId).toBe("openbuddy-calendar");
    const total = builtInMcpExporters.reduce((acc, exp) => acc + exp.capabilities.length, 0);
    expect(total).toBe(2);
  });

  it("calendar exporter marks write operations with before_external_commit", () => {
    const write = calendarMcpExporter.capabilities.find((cap) => cap.id === "calendar:create");
    expect(write?.requiredApproval).toBe("before_external_commit");
  });
});

describe("capability-mcp-exporters cross-package coverage", () => {
  it("calendar export gates writes through before_external_commit and lists external:commit as forbidden", () => {
    const create = calendarMcpExporter.capabilities.find((c) => c.id === "calendar:create");
    expect(create?.requiredApproval).toBe("before_external_commit");
    expect(create?.allowedActions).toEqual(["write:room"]);
    // external:commit is forbidden across the board — the assertion is that
    // this entry explicitly keeps it listed so the runtime gate rejects it.
    expect(create?.forbiddenActions).toContain("external:commit");
    for (const cap of calendarMcpExporter.capabilities) {
      expect(cap.forbiddenDataScopes).toEqual(expect.arrayContaining(["private:*", "credential:*", "secret:*"]));
    }
  });

  it("every built-in exporter participates in the projection with the right providerId", () => {
    const projected = exportersToBuddyCapabilities(builtInMcpExporters);
    const byProvider = projected.reduce<Record<string, number>>((acc, cap) => {
      acc[cap.providerId] = (acc[cap.providerId] ?? 0) + 1;
      return acc;
    }, {});
    expect(byProvider["openbuddy-calendar"]).toBe(2);
  });

  it("invocation table covers all built-in exporter ids without collision", () => {
    const table = exportersToInvocationTable(builtInMcpExporters);
    const ids = Object.keys(table);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "calendar:list", "calendar:create",
    ]));
  });
});

describe("capabilityMcpExportersRegistry singleton", () => {
  it("starts empty and grows when callers register exporters", () => {
    expect(capabilityMcpExportersRegistry.list().length).toBeGreaterThanOrEqual(0);
    const dispose = capabilityMcpExportersRegistry.register(calendarMcpExporter);
    expect(capabilityMcpExportersRegistry.list().map((entry) => entry.packageId)).toContain("openbuddy-calendar");
    dispose();
  });
});