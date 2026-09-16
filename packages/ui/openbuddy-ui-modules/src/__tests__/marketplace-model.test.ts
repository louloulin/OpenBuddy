import { describe, expect, it } from "vitest";
import {
  classifyVersion,
  collectCapabilityIds,
  collectKindFacets,
  compareSemver,
  filterMarketplaceEntries,
  formatBytes,
  highlightSegments,
  isMajorUpgrade,
  parseSemver,
  resolveInstallState,
  scoreRelevance,
  selectMarketplaceEntries,
  sortMarketplaceEntries,
  sortVersionsDesc,
  summarizeCapabilities,
  type MarketplaceEntry,
} from "../components/marketplace-model";

function entry(partial: Partial<MarketplaceEntry> & { id: string }): MarketplaceEntry {
  return {
    name: partial.id,
    publisher: "openbuddy",
    description: "",
    version: "1.0.0",
    kinds: ["plugin"],
    ...partial,
  };
}

describe("parseSemver", () => {
  it("parses strict and loose versions", () => {
    expect(parseSemver("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseSemver("v2")).toMatchObject({ major: 2, minor: 0, patch: 0 });
    expect(parseSemver("1.4")).toMatchObject({ major: 1, minor: 4, patch: 0 });
    expect(parseSemver("1.2.3-beta.2+sha.abc")).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["beta", 2],
      build: "sha.abc",
    });
  });

  it("returns null for non-versions", () => {
    expect(parseSemver("latest")).toBeNull();
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("1.2.3.4")).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
    expect(parseSemver(null)).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders numeric parts", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("1.0.1", "1.0.1")).toBe(0);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
  });

  it("treats prerelease as lower than the release", () => {
    expect(compareSemver("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha")).toBe(1);
  });

  it("returns null when either side is unparsable", () => {
    expect(compareSemver("latest", "1.0.0")).toBeNull();
    expect(compareSemver("1.0.0", undefined)).toBeNull();
  });
});

describe("classifyVersion", () => {
  it("detects upgrade, downgrade and same", () => {
    expect(classifyVersion("1.0.0", "1.1.0")).toBe("upgrade");
    expect(classifyVersion("1.1.0", "1.0.0")).toBe("downgrade");
    expect(classifyVersion("1.0.0", "1.0.0")).toBe("same");
  });

  it("treats a fresh install as an upgrade", () => {
    expect(classifyVersion(undefined, "1.0.0")).toBe("upgrade");
    expect(classifyVersion(undefined, undefined)).toBe("unknown");
  });

  it("short-circuits to incompatible when flagged", () => {
    expect(classifyVersion("1.0.0", "2.0.0", { incompatible: true })).toBe("incompatible");
  });

  it("falls back to unknown for unparsable versions", () => {
    expect(classifyVersion("1.0.0", "latest")).toBe("unknown");
    expect(classifyVersion("nightly", "1.0.0")).toBe("unknown");
    expect(classifyVersion("nightly", "nightly")).toBe("same");
  });
});

describe("isMajorUpgrade", () => {
  it("flags breaking bumps only", () => {
    expect(isMajorUpgrade("1.4.0", "2.0.0")).toBe(true);
    expect(isMajorUpgrade("1.4.0", "1.5.0")).toBe(false);
    expect(isMajorUpgrade(undefined, "2.0.0")).toBe(false);
  });
});

describe("sortVersionsDesc", () => {
  it("sorts newest first and keeps unparsable entries stable", () => {
    expect(sortVersionsDesc(["1.0.0", "1.10.0", "1.2.0"])).toEqual(["1.10.0", "1.2.0", "1.0.0"]);
  });
});

describe("resolveInstallState", () => {
  it("follows the documented priority", () => {
    expect(resolveInstallState({ installing: true })).toBe("installing");
    expect(resolveInstallState({ incompatible: true, installedVersion: "1.0.0" })).toBe("blocked");
    expect(resolveInstallState({ blockedReason: "engine mismatch" })).toBe("blocked");
    expect(resolveInstallState({ installedVersion: "1.0.0", version: "1.1.0" })).toBe(
      "update-available",
    );
    expect(resolveInstallState({ installedVersion: "1.1.0", version: "1.1.0" })).toBe("installed");
    expect(resolveInstallState({ installedVersion: "2.0.0", version: "1.0.0" })).toBe("installed");
    expect(resolveInstallState({ version: "1.0.0" })).toBe("available");
  });
});

describe("summarizeCapabilities", () => {
  const capabilities = [
    { id: "fs.read", risk: "low" as const },
    { id: "network.fetch", risk: "high" as const, label: "网络访问" },
    { id: "fs.write", risk: "medium" as const },
    { id: "shell.exec", risk: "high" as const },
  ];

  it("truncates the visible list and counts the rest", () => {
    const summary = summarizeCapabilities(capabilities, 3);
    expect(summary.shown.map((c) => c.id)).toEqual(["network.fetch", "shell.exec", "fs.write"]);
    expect(summary.hiddenCount).toBe(1);
    expect(summary.total).toBe(4);
    expect(summary.hasHighRisk).toBe(true);
    expect(summary.hasMediumRisk).toBe(true);
    expect(summary.riskiest?.id).toBe("network.fetch");
  });

  it("handles undefined and max=0", () => {
    expect(summarizeCapabilities(undefined)).toMatchObject({
      total: 0,
      hiddenCount: 0,
      hasHighRisk: false,
    });
    expect(summarizeCapabilities(capabilities, 0).shown).toEqual([]);
    expect(summarizeCapabilities(capabilities, 0).hiddenCount).toBe(4);
    expect(summarizeCapabilities(capabilities, 0).riskiest?.id).toBe("network.fetch");
  });

  it("treats a missing risk as low", () => {
    const summary = summarizeCapabilities([{ id: "theme.apply" }]);
    expect(summary.hasHighRisk).toBe(false);
    expect(summary.hasMediumRisk).toBe(false);
  });
});

describe("facets", () => {
  const entries = [
    entry({ id: "a", kinds: ["plugin", "theme"], capabilities: [{ id: "fs.write" }] }),
    entry({ id: "b", kinds: ["plugin"] }),
    entry({ id: "c", kinds: ["skill"], capabilities: [{ id: "fs.write" }, { id: "net" }] }),
  ];

  it("counts kinds across multi-kind entries", () => {
    const facets = collectKindFacets(entries);
    expect(facets.find((facet) => facet.kind === "plugin")?.count).toBe(2);
    expect(facets.find((facet) => facet.kind === "theme")?.count).toBe(1);
    expect(facets.find((facet) => facet.kind === "mcp")?.count).toBe(0);
  });

  it("collects unique capability ids", () => {
    expect(collectCapabilityIds(entries)).toEqual(["fs.write", "net"]);
  });
});

describe("filterMarketplaceEntries", () => {
  const entries = [
    entry({
      id: "pi-fs",
      name: "Pi FS Tools",
      description: "file system helpers",
      kinds: ["plugin"],
      capabilities: [{ id: "fs.write", risk: "high" }],
    }),
    entry({
      id: "theme-sakura",
      name: "Sakura Theme",
      publisher: "moe",
      kinds: ["theme"],
      version: "2.0.0",
      installedVersion: "2.0.0",
    }),
    entry({
      id: "mcp-browser",
      name: "Browser MCP",
      publisher: "moe",
      kinds: ["mcp"],
      version: "1.2.0",
      installedVersion: "1.0.0",
    }),
    entry({
      id: "skill-email",
      name: "Email Skill",
      kinds: ["skill"],
      blockedReason: "引擎版本过低",
    }),
  ];

  it("matches every query token", () => {
    expect(filterMarketplaceEntries(entries, { query: "moe browser" }).map((e) => e.id)).toEqual([
      "mcp-browser",
    ]);
    expect(filterMarketplaceEntries(entries, { query: "browser moe" }).map((e) => e.id)).toEqual([
      "mcp-browser",
    ]);
    expect(filterMarketplaceEntries(entries, { query: "nothing" })).toEqual([]);
  });

  it("searches capabilities too", () => {
    expect(filterMarketplaceEntries(entries, { query: "fs.write" }).map((e) => e.id)).toEqual([
      "pi-fs",
    ]);
  });

  it("filters by kind (any match wins)", () => {
    expect(
      filterMarketplaceEntries(entries, { kinds: ["theme", "skill"] }).map((e) => e.id),
    ).toEqual(["theme-sakura", "skill-email"]);
  });

  it("requires all requested capabilities", () => {
    expect(
      filterMarketplaceEntries(entries, { capabilities: ["fs.write"] }).map((e) => e.id),
    ).toEqual(["pi-fs"]);
    expect(filterMarketplaceEntries(entries, { capabilities: ["fs.write", "net"] })).toEqual([]);
  });

  it("filters by derived install state", () => {
    expect(
      filterMarketplaceEntries(entries, { installStates: ["update-available"] }).map((e) => e.id),
    ).toEqual(["mcp-browser"]);
    expect(
      filterMarketplaceEntries(entries, { installStates: ["installed"] }).map((e) => e.id),
    ).toEqual(["theme-sakura"]);
    expect(
      filterMarketplaceEntries(entries, { installStates: ["blocked"] }).map((e) => e.id),
    ).toEqual(["skill-email"]);
  });

  it("can exclude high-risk entries", () => {
    expect(filterMarketplaceEntries(entries, { excludeHighRisk: true }).map((e) => e.id)).toEqual([
      "theme-sakura",
      "mcp-browser",
      "skill-email",
    ]);
  });

  it("is a no-op without a filter", () => {
    expect(filterMarketplaceEntries(entries)).toHaveLength(entries.length);
  });
});

describe("sortMarketplaceEntries", () => {
  const entries = [
    entry({
      id: "z",
      name: "Zeta",
      publisher: "b",
      updatedAt: "2024-01-01T00:00:00Z",
      installedBytes: 10,
    }),
    entry({
      id: "a",
      name: "Alpha",
      publisher: "c",
      updatedAt: "2025-01-01T00:00:00Z",
      installedBytes: 4096,
    }),
    entry({
      id: "m",
      name: "Mu",
      publisher: "a",
      updatedAt: "2023-01-01T00:00:00Z",
      installedBytes: undefined,
    }),
  ];

  it("sorts by name / publisher / recent / size", () => {
    expect(sortMarketplaceEntries(entries, "name").map((e) => e.id)).toEqual(["a", "m", "z"]);
    expect(sortMarketplaceEntries(entries, "publisher").map((e) => e.id)).toEqual(["m", "z", "a"]);
    expect(sortMarketplaceEntries(entries, "recent").map((e) => e.id)).toEqual(["a", "z", "m"]);
    expect(sortMarketplaceEntries(entries, "size").map((e) => e.id)).toEqual(["a", "z", "m"]);
  });

  it("sorts by relevance and boosts installed entries on ties", () => {
    const tied = [
      entry({ id: "x", name: "Gamma" }),
      entry({ id: "y", name: "Gamma", installedVersion: "1.0.0" }),
    ];
    expect(sortMarketplaceEntries(tied, "relevance", "").map((e) => e.id)).toEqual(["y", "x"]);
  });

  it("does not mutate the input array", () => {
    const original = [...entries];
    sortMarketplaceEntries(entries, "name");
    expect(entries).toEqual(original);
  });
});

describe("scoreRelevance", () => {
  it("ranks prefix matches above description matches", () => {
    const prefix = entry({ id: "email-tools", name: "Email Tools", description: "" });
    const body = entry({ id: "x", name: "X", description: "email helpers" });
    expect(scoreRelevance(prefix, "email")).toBeGreaterThan(scoreRelevance(body, "email"));
    expect(scoreRelevance(prefix, "")).toBe(0);
  });
});

describe("selectMarketplaceEntries", () => {
  it("combines filter and sort", () => {
    const entries = [
      entry({ id: "b", name: "Beta", kinds: ["plugin"] }),
      entry({ id: "a", name: "Alpha", kinds: ["plugin"] }),
      entry({ id: "c", name: "Alpha Theme", kinds: ["theme"] }),
    ];
    expect(
      selectMarketplaceEntries(entries, { kinds: ["plugin"] }, "name").map((e) => e.id),
    ).toEqual(["a", "b"]);
  });
});

describe("highlightSegments", () => {
  it("splits matched and unmatched runs", () => {
    expect(highlightSegments("Browser MCP", "mcp")).toEqual([
      { text: "Browser ", match: false },
      { text: "MCP", match: true },
    ]);
  });

  it("returns a single unmatched run when the query is empty or missing", () => {
    expect(highlightSegments("Browser MCP", "")).toEqual([{ text: "Browser MCP", match: false }]);
    expect(highlightSegments("Browser MCP", "zzz")).toEqual([
      { text: "Browser MCP", match: false },
    ]);
  });

  it("escapes regex metacharacters in the query", () => {
    expect(highlightSegments("a.b.c", ".")).toEqual([
      { text: "a", match: false },
      { text: ".", match: true },
      { text: "b", match: false },
      { text: ".", match: true },
      { text: "c", match: false },
    ]);
  });
});

describe("formatBytes", () => {
  it("formats with binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1024)).toBe("1024 TB");
  });

  it("returns undefined for missing or invalid input", () => {
    expect(formatBytes(undefined)).toBeUndefined();
    expect(formatBytes(-1)).toBeUndefined();
    expect(formatBytes(Number.NaN)).toBeUndefined();
  });
});
