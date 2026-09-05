/**
 * Phase I.3 tests for the marketplace priority toast helper.
 *
 * The helper translates the IPC payload from `marketplace_action` into the
 * user-facing toast. The four cases we care about:
 *
 *  1. install on a pi-priority package  → ✓ message + capability
 *  2. install on a non-priority package  → simple 已安装
 *  3. uninstall on a package that was priority → ✓ fallback-restored message
 *  4. uninstall on a non-priority package → simple 已卸载
 *
 * The helper must be defensive: missing fields fall back to plain text
 * instead of throwing (callers pass `unknown` IPC responses).
 */

import { describe, expect, it } from "vitest";
import { describeMarketplaceResult } from "../src/marketplace-priority-toast";

describe("Phase I.3: describeMarketplaceResult", () => {
  it("emits the priority toast when install carries piPriorityEnabled + capability", () => {
    const msg = describeMarketplaceResult("pi-mcp-adapter", "install", {
      piPriorityEnabled: true,
      capability: "mcp",
    });
    expect(msg).toContain("pi-mcp-adapter");
    expect(msg).toContain("原生 pi 实现");
    expect(msg).toContain("capability: mcp");
    expect(msg).toContain("Cordis 兼容层");
    expect(msg.startsWith("✓")).toBe(true);
  });

  it("falls back to the simple toast when install has no priority fields", () => {
    const msg = describeMarketplaceResult("demo", "install", { ok: true });
    expect(msg).toBe("已安装「demo」");
  });

  it("falls back to the simple toast when result is null/undefined", () => {
    expect(describeMarketplaceResult("demo", "install", null)).toBe("已安装「demo」");
    expect(describeMarketplaceResult("demo", "install", undefined)).toBe("已安装「demo」");
  });

  it("emits the update toast with the same priority shape", () => {
    const msg = describeMarketplaceResult("pi-permission-system", "update", {
      piPriorityEnabled: true,
      capability: "permission",
    });
    expect(msg).toContain("pi-permission-system");
    expect(msg).toContain("继续优先使用");
    expect(msg).toContain("capability: permission");
  });

  it("emits the uninstall toast when the package WAS priority", () => {
    const msg = describeMarketplaceResult("pi-goal-list-loop-audit", "uninstall", {
      piPriorityEnabledBefore: true,
      capability: "automation",
    });
    expect(msg).toContain("pi-goal-list-loop-audit");
    expect(msg).toContain("已卸载");
    expect(msg).toContain("fallback");
    expect(msg).toContain("capability: automation");
    expect(msg).toContain("已恢复");
  });

  it("emits the simple uninstall toast when the package was not priority", () => {
    const msg = describeMarketplaceResult("demo", "uninstall", { ok: true });
    expect(msg).toBe("已卸载「demo」");
  });

  it("downgrades to simple toast when capability is missing (defensive)", () => {
    // Caller might forget to forward `capability` — we must not render an
    // empty placeholder like "(capability: undefined)".
    const msg = describeMarketplaceResult("pi-mcp-adapter", "install", {
      piPriorityEnabled: true,
    });
    expect(msg).toBe("已安装「pi-mcp-adapter」");
  });
});
