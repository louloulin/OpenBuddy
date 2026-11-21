// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ConnectorCatalogService } from "../src/mcp/catalog";

describe("连接器目录 (pii W2.4 P2)", () => {
  const service = new ConnectorCatalogService();

  it("lists installable connectors only (each has a real MCP config)", () => {
    const catalog = service.catalog();
    expect(catalog.root).toBe("builtin:connectors");
    expect(catalog.connectors.length).toBeGreaterThanOrEqual(8);
    for (const item of catalog.connectors) {
      expect(item.kind).toBe("mcp");
      expect(item.source).toBe(item.id);
      expect(item.desc.length).toBeGreaterThan(10);
      const config = JSON.parse(service.mcpConfig(item.source)) as { mcpServers: Record<string, { command?: string; url?: string }> };
      const server = config.mcpServers[item.id];
      expect(server).toBeTruthy();
      expect(server.command || server.url).toBeTruthy();
    }
  });

  it("marks token connectors with a schema and exposes the placeholder", () => {
    const github = service.catalog().connectors.find((item) => item.id === "github");
    expect(github?.authMode).toBe("token");
    expect(github?.tokenSchema?.fields[0]?.key).toBe("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(service.mcpConfig("github")).toContain("${GITHUB_PERSONAL_ACCESS_TOKEN}");
  });

  it("returns an empty config for an unknown source", () => {
    expect(service.mcpConfig("nope")).toBe("");
  });
});
