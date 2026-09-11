/**
 * Tests for the 3 bridge.skills helpers added in Round 25 — G4 PR 4
 * (plan4.1.md §9.15): loadBridgeSkills / loadBridgeSkillsFromDir /
 * formatBridgeSkillsForPrompt.
 *
 * Mirrors the text/image helpers' 4-layer fallback contract. The skills
 * domain is special:
 *   - loadSkills / loadSkillsFromDir fall back to empty payload
 *     `{ skills: [], diagnostics: [] }` (NOT null) so callers can iterate
 *     without null checks.
 *   - formatForPrompt falls back to empty string.
 *
 * Exercises the channels
 *   pi-bridge-skills:load
 *   pi-bridge-skills:load-from-dir
 *   pi-bridge-skills:format-for-prompt
 * which were the last 3 dead channels (Round 24: 11/14 live = 79%).
 * After this round lands 14/14 = 100% — pi-bridge GA gate ≥ 80% ✅.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatBridgeSkillsForPrompt,
  loadBridgeSkills,
  loadBridgeSkillsFromDir,
} from "../pi-client";

type SkillsBridgeOverrides = {
  load?: (
    opts?: { cwd?: string; agentDir?: string; skillPaths?: string[]; includeDefaults?: boolean },
  ) => Promise<{ skills: unknown[]; diagnostics: unknown[] }>;
  loadFromDir?: (
    dir: string,
    source: string,
  ) => Promise<{ skills: unknown[]; diagnostics: unknown[] }>;
  formatForPrompt?: (skills: unknown[], fileReadTool?: "read" | "bash") => Promise<string>;
};

type BridgeBuilder = (overrides?: SkillsBridgeOverrides) => {
  text: Record<string, unknown>;
  image: Record<string, unknown>;
  skills: Record<string, unknown>;
};

const buildBridge: BridgeBuilder = (overrides = {}) => {
  const noop = async () => ({ skills: [], diagnostics: [] });
  return {
    text: { parseFrontmatter: noop, stripFrontmatter: vi.fn(async () => "") },
    image: {},
    skills: {
      load: overrides.load ?? noop,
      loadFromDir: overrides.loadFromDir ?? noop,
      formatForPrompt: overrides.formatForPrompt ?? vi.fn(async () => ""),
    },
  };
};

describe("Round 25 — G4 PR 4 bridge.skills helpers (G4 final PR)", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  // ---------- loadBridgeSkills ----------

  it("loadBridgeSkills: returns empty payload when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    const result = await loadBridgeSkills({ cwd: "/tmp/proj" });
    expect(result).toEqual({ skills: [], diagnostics: [] });
  });

  it("loadBridgeSkills: delegates to bridge.skills.load", async () => {
    const payload = {
      skills: [{ name: "code-search", description: "ripgrep", filePath: "/x.md", baseDir: "/x" }],
      diagnostics: [{ severity: "info", message: "ok" }],
    };
    const load = vi.fn(async () => payload);
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ load }) } };
    const result = await loadBridgeSkills({ cwd: "/tmp/proj", includeDefaults: true });
    expect(load).toHaveBeenCalledWith({ cwd: "/tmp/proj", includeDefaults: true });
    expect(result.skills).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("loadBridgeSkills: returns empty payload when bridge throws", async () => {
    const load = vi.fn(async () => {
      throw new Error("discovery failed");
    });
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ load }) } };
    const result = await loadBridgeSkills();
    expect(result).toEqual({ skills: [], diagnostics: [] });
  });

  // ---------- loadBridgeSkillsFromDir ----------

  it("loadBridgeSkillsFromDir: returns empty payload when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    const result = await loadBridgeSkillsFromDir("/tmp/skills", "user");
    expect(result).toEqual({ skills: [], diagnostics: [] });
  });

  it("loadBridgeSkillsFromDir: delegates to bridge.skills.loadFromDir", async () => {
    const payload = {
      skills: [{ name: "lint", description: "lint helper", filePath: "/y.md", baseDir: "/y" }],
      diagnostics: [],
    };
    const loadFromDir = vi.fn(async () => payload);
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ loadFromDir }) } };
    const result = await loadBridgeSkillsFromDir("/tmp/skills", "user");
    expect(loadFromDir).toHaveBeenCalledWith("/tmp/skills", "user");
    expect(result.skills[0].name).toBe("lint");
  });

  it("loadBridgeSkillsFromDir: returns empty when skills namespace is empty", async () => {
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: {}, image: {}, skills: {} } },
    };
    const result = await loadBridgeSkillsFromDir("/tmp/skills", "user");
    expect(result).toEqual({ skills: [], diagnostics: [] });
  });

  // ---------- formatBridgeSkillsForPrompt ----------

  it("formatBridgeSkillsForPrompt: returns empty string when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    const result = await formatBridgeSkillsForPrompt([], "read");
    expect(result).toBe("");
  });

  it("formatBridgeSkillsForPrompt: delegates to bridge.skills.formatForPrompt", async () => {
    const formatForPrompt = vi.fn(async () => "<available_skills>\n  <skill>...</skill>\n</available_skills>");
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ formatForPrompt }) } };
    const skills = [
      { name: "s", description: "d", filePath: "/p.md", baseDir: "/p" },
    ];
    const result = await formatBridgeSkillsForPrompt(skills, "bash");
    expect(formatForPrompt).toHaveBeenCalledWith(skills, "bash");
    expect(result).toContain("available_skills");
  });

  it("formatBridgeSkillsForPrompt: defaults fileReadTool to 'read'", async () => {
    const formatForPrompt = vi.fn(async () => "formatted");
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ formatForPrompt }) } };
    await formatBridgeSkillsForPrompt([]);
    expect(formatForPrompt).toHaveBeenCalledWith([], "read");
  });

  it("formatBridgeSkillsForPrompt: returns empty string when bridge throws", async () => {
    const formatForPrompt = vi.fn(async () => {
      throw new Error("format failed");
    });
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ formatForPrompt }) } };
    const result = await formatBridgeSkillsForPrompt([]);
    expect(result).toBe("");
  });
});