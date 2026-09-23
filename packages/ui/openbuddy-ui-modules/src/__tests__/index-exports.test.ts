import { describe, expect, it } from "vitest";
import * as api from "../index";

describe("@openbuddy/ui-modules public surface", () => {
  it("keeps the pre-existing renderer-host re-exports", () => {
    expect(typeof api.ClientModuleSystem).toBe("function");
    expect(typeof api.loadRendererPlugin).toBe("function");
  });

  it("exports the marketplace components and model helpers", () => {
    for (const name of [
      "MarketplaceTab",
      "MarketplaceCard",
      "InstallDialog",
      "CapabilityVersionBadge",
      "primaryActionFor",
      "resolveBadgeRelation",
      "parseSemver",
      "compareSemver",
      "classifyVersion",
      "isMajorUpgrade",
      "sortVersionsDesc",
      "resolveInstallState",
      "summarizeCapabilities",
      "capabilityRisk",
      "collectCapabilityIds",
      "collectKindFacets",
      "filterMarketplaceEntries",
      "sortMarketplaceEntries",
      "selectMarketplaceEntries",
      "scoreRelevance",
      "highlightSegments",
      "formatBytes",
    ]) {
      expect(typeof (api as Record<string, unknown>)[name], `${name} should be exported`).toBe(
        "function",
      );
    }
    expect(api.MARKETPLACE_KINDS).toEqual(["plugin", "skill", "extension", "mcp", "theme", "prompt"]);
    expect(api.INSTALL_STATE_LABELS.installed).toBe("已安装");
  });
});
