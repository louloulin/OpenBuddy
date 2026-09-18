/**
 * R41 — 安装预检(纯逻辑)。
 *
 * 这里把 `install-preflight.ts` 的每一条分支都钉死:
 *   - 动作(action):全新 / 升级 / 重装的判定;
 *   - 阻断(blockers):sourceUrlOrPath / relativePath 缺失;
 *   - 风险(risks):hooks / mcp / 远程未固定 / 本机目录 / 能力接管 / 覆盖已有;
 *   - requiresConfirmation:什么时候打断人,什么时候不打断。
 *
 * 因为是纯函数,不需要 Electron、不需要 React,不需要 IPC mock。
 */
import { describe, expect, it } from "vitest";
import type {
  MarketplacePluginEntry,
  MarketplaceScanResult,
  PiPackageCatalogEntry,
} from "@openbuddy/shared-types";
import {
  buildInstallPreflight,
  resolvePreflightAction,
} from "../src/install-preflight";

function source(overrides: Partial<MarketplaceScanResult> = {}): MarketplaceScanResult {
  return {
    sourceName: "pi.dev",
    sourceKind: "remote",
    sourceKindValue: "remote",
    sourceUrlOrPath: "https://pi.dev/packages",
    builtIn: true,
    plugins: [],
    ...overrides,
  };
}

function plugin(overrides: Partial<MarketplacePluginEntry> = {}): MarketplacePluginEntry {
  return {
    name: "pkg",
    version: "1.2.3",
    description: "",
    category: "general",
    author: "tester",
    relativePath: "/pkg",
    skillCount: 0,
    hasHooks: false,
    hasAgents: false,
    hasMcp: false,
    installStatus: "available",
    ...overrides,
  };
}

const catalog = (
  overrides: Partial<PiPackageCatalogEntry> = {},
): PiPackageCatalogEntry => ({
  packageNames: ["pkg"],
  capability: "mcp",
  owner: "openbuddy-mcp-client",
  passthrough: true,
  capabilityLabel: "MCP 客户端",
  ...overrides,
});

describe("resolvePreflightAction", () => {
  it("available = install", () => {
    expect(resolvePreflightAction(plugin({ installStatus: "available" }))).toBe("install");
  });
  it("installed + 同版本 = reinstall", () => {
    expect(
      resolvePreflightAction(plugin({ installStatus: "installed", installedVersion: "1.2.3", version: "1.2.3" })),
    ).toBe("reinstall");
  });
  it("installed + 不同版本 = upgrade", () => {
    expect(
      resolvePreflightAction(plugin({ installStatus: "installed", installedVersion: "1.2.2", version: "1.2.3" })),
    ).toBe("upgrade");
  });
});

describe("buildInstallPreflight — blockers", () => {
  it("缺 sourceUrlOrPath → blocker", () => {
    const plan = buildInstallPreflight(source({ sourceUrlOrPath: "" }), plugin());
    expect(plan.blockers.map((b) => b.id)).toContain("missing-source");
    expect(plan.requiresConfirmation).toBe(true); // 阻断项仍需要用户看
  });
  it("缺 relativePath → blocker", () => {
    const plan = buildInstallPreflight(source(), plugin({ relativePath: "" }));
    expect(plan.blockers.map((b) => b.id)).toContain("missing-relative-path");
  });
});

describe("buildInstallPreflight — risks", () => {
  it("hooks → danger", () => {
    const plan = buildInstallPreflight(source(), plugin({ hasHooks: true }));
    const item = plan.risks.find((r) => r.id === "hooks-exec");
    expect(item?.level).toBe("danger");
  });
  it("MCP → warning(说明白会连接外部服务)", () => {
    const plan = buildInstallPreflight(source(), plugin({ hasMcp: true }));
    const item = plan.risks.find((r) => r.id === "mcp-external");
    expect(item?.level).toBe("warning");
  });
  it("升级覆盖已有版本 → warning", () => {
    const plan = buildInstallPreflight(
      source(),
      plugin({ installStatus: "installed", installedVersion: "1.0.0", version: "2.0.0" }),
    );
    const item = plan.risks.find((r) => r.id === "overwrite-existing");
    expect(item?.level).toBe("warning");
    expect(plan.action).toBe("upgrade");
  });
  it("远程源没固定版本 → warning", () => {
    const plan = buildInstallPreflight(
      source({ sourceKindValue: "remote", sourceUrlOrPath: "https://pi.dev/packages" }),
      plugin({ remoteRef: undefined }),
    );
    expect(plan.risks.find((r) => r.id === "remote-unpinned")).toBeTruthy();
  });
  it("远程源有 ref → 不警告", () => {
    const plan = buildInstallPreflight(
      source({ sourceKindValue: "remote" }),
      plugin({ remoteRef: "v1.2.3", remoteUrl: "https://.../pkg" }),
    );
    expect(plan.risks.find((r) => r.id === "remote-unpinned")).toBeUndefined();
  });
  it("本地目录源 → warning(本机目录,内容可能被改动)", () => {
    const plan = buildInstallPreflight(
      source({ sourceKindValue: "local", sourceUrlOrPath: "/Users/me/plugs" }),
      plugin(),
    );
    expect(plan.risks.find((r) => r.id === "local-untracked")).toBeTruthy();
  });
  it("catalog passthrough + 命中 → takeover warning", () => {
    const plan = buildInstallPreflight(source(), plugin({ name: "pkg" }), {
      catalogEntry: catalog({ capabilityLabel: "MCP 客户端", capability: "mcp" }),
    });
    expect(plan.takeover?.capability).toBe("mcp");
    const item = plan.risks.find((r) => r.id === "capability-takeover");
    expect(item?.level).toBe("warning");
  });
});

describe("buildInstallPreflight — requiresConfirmation", () => {
  it("全新 + 无风险 + 不接管 = false(别为仪式感打断人)", () => {
    // 远程源 + 固定 ref + 没人管的能力 + 全新安装 → 干净
    const plan = buildInstallPreflight(
      source({ sourceKindValue: "remote", sourceUrlOrPath: "https://pi.dev/packages" }),
      plugin({ remoteRef: "v1.2.3", remoteUrl: "https://pi.dev/packages/pkg" }),
    );
    expect(plan.action).toBe("install");
    expect(plan.risks).toEqual([]);
    expect(plan.requiresConfirmation).toBe(false);
  });

  it("升级 → true", () => {
    const plan = buildInstallPreflight(
      source(),
      plugin({ installStatus: "installed", installedVersion: "1.0.0", version: "2.0.0" }),
    );
    expect(plan.requiresConfirmation).toBe(true);
  });

  it("任何一个 risk → true", () => {
    const plan = buildInstallPreflight(source(), plugin({ hasMcp: true }));
    expect(plan.requiresConfirmation).toBe(true);
  });

  it("takeover 但没其它风险 → true(够大,值得专门问一下)", () => {
    const plan = buildInstallPreflight(source(), plugin({ name: "pkg" }), {
      catalogEntry: catalog(),
    });
    expect(plan.risks.find((r) => r.id === "capability-takeover")).toBeTruthy();
    expect(plan.requiresConfirmation).toBe(true);
  });
});
