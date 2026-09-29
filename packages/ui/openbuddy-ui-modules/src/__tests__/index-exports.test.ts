import { describe, expect, it } from "vitest";
import * as api from "../index";

describe("@openbuddy/ui-modules public surface", () => {
  it("keeps the renderer-host re-exports", () => {
    expect(typeof api.ClientModuleSystem).toBe("function");
    expect(typeof api.loadRendererPlugin).toBe("function");
  });

  it("R97 — no longer exports the removed marketplace 表现层", () => {
    // 「插件·市场」面板的事实唯一实现是 @openbuddy/ui-mcp 的 MarketplacePanel。
    // 这里断言孤儿导出确实消失了,防止有人把两份实现又加回来。
    for (const name of [
      "MarketplaceTab",
      "MarketplaceCard",
      "InstallDialog",
      "CapabilityVersionBadge",
      "parseSemver",
      "collectKindFacets",
      "MARKETPLACE_KINDS",
    ]) {
      expect((api as Record<string, unknown>)[name], `${name} should be gone`).toBeUndefined();
    }
  });
});