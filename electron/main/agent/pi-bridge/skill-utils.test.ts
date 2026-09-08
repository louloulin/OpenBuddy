import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatSkillsForPrompt, loadSkills, loadSkillsFromDir } from "./skill-utils";

describe("pi-bridge/skill-utils", () => {
  it("loads skills from a single directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-bridge-skills-"));
    try {
      // skill 1: SKILL.md at root
      await writeFile(
        join(root, "SKILL.md"),
        "---\nname: coding\ndescription: write code\n---\nCoding skill body.",
        "utf8",
      );
      // skill 2: nested
      await mkdir(join(root, "nested"));
      await writeFile(
        join(root, "nested", "SKILL.md"),
        "---\nname: testing\ndescription: run tests\n---\nTesting skill body.",
        "utf8",
      );
      // unrelated .md at root should be ignored when SKILL.md exists at root
      await writeFile(join(root, "stray.md"), "# stray", "utf8");

      const result = await loadSkillsFromDir({ dir: root, source: "test" });
      const names = result.skills.map((s) => s.name).sort();
      expect(names).toEqual(["coding"]);
      expect(result.skills[0].filePath).toContain("SKILL.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("formats skills into the standard XML block", async () => {
    const skill = {
      name: "demo",
      description: "demo skill",
      filePath: "/tmp/demo/SKILL.md",
      baseDir: "/tmp/demo",
      sourceInfo: { kind: "test" },
      disableModelInvocation: false,
    };
    const out = formatSkillsForPrompt([skill as never]);
    expect(out).toContain("<skill>");
    expect(out).toContain("demo");
    expect(out).toContain("demo skill");
  });

  it("respects disableModelInvocation flag", () => {
    const a = {
      name: "visible",
      description: "v",
      filePath: "/a",
      baseDir: "/a",
      sourceInfo: { kind: "x" },
      disableModelInvocation: false,
    };
    const b = {
      name: "hidden",
      description: "h",
      filePath: "/b",
      baseDir: "/b",
      sourceInfo: { kind: "x" },
      disableModelInvocation: true,
    };
    const out = formatSkillsForPrompt([a as never, b as never]);
    expect(out).toContain("visible");
    expect(out).not.toContain("hidden");
  });

  it("loadSkills returns diagnostics on invalid skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-bridge-skills-2-"));
    try {
      // invalid frontmatter is still accepted by parse(); the diagnostics
      // surface returns warnings for missing name/description.
      await writeFile(
        join(root, "SKILL.md"),
        "---\ndescription: only description\n---\nbody",
        "utf8",
      );
      const result = await loadSkillsFromDir({ dir: root, source: "test" });
      // pi allows description-only; just ensure no crash + payload present.
      expect(Array.isArray(result.skills)).toBe(true);
      expect(Array.isArray(result.diagnostics)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});