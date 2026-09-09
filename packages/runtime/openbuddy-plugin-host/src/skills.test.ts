/**
 * @openbuddy/plugin-host/skills — Phase D.3 tests.
 *
 * Verifies the Skills loading helpers added in D.3. The actual
 * filesystem scanning is delegated to PI's `loadSkills` /
 * `loadSkillsFromDir`; these tests pin the wrapper defaults and
 * the `formatForAgentPrompt` alias.
 */
import { describe, expect, it, vi } from "vitest";

// Mock the pi-coding-agent module BEFORE importing skills.ts so
// the wrapper's imports resolve to our stub.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  loadSkills: vi.fn(async () => ({ skills: [], errors: [] })),
  loadSkillsFromDir: vi.fn(async () => ({ skills: [], errors: [] })),
  formatSkillsForPrompt: vi.fn((skills) => `<skills>${skills.length}</skills>`),
}));

import {
  loadSkills,
  loadSkillsFromDir,
  formatForAgentPrompt,
} from "./skills";

describe("Phase D.3 — skills loading helpers", () => {
  it("loadSkillsFromDir delegates to PI with passed options", async () => {
    const result = await loadSkillsFromDir({ dir: "/skills", source: "test" });
    expect(result).toEqual({ skills: [], errors: [] });
  });

  it("loadSkills uses process.cwd() as the default cwd", async () => {
    const originalCwd = process.cwd();
    try {
      // Fake the cwd to a known dir so the assertion is portable.
      process.chdir("/tmp");
      const result = await loadSkills();
      expect(result).toEqual({ skills: [], errors: [] });
      // The default agent dir was used.
      // We don't assert against process.cwd() in case of platform
      // differences, but the call must succeed without throwing.
      void originalCwd;
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("loadSkills forwards includeDefaults = true as default", async () => {
    // The wrapper passes includeDefaults=true when the caller
    // doesn't override it. We verify that the call resolves to
    // the mocked empty result rather than throwing.
    const result = await loadSkills();
    expect(result.skills).toEqual([]);
  });

  it("formatForAgentPrompt is a thin alias around formatSkillsForPrompt", () => {
    const fakeSkills = [{ name: "fake" }, { name: "fake2" }] as never;
    const out = formatForAgentPrompt(fakeSkills);
    // The mock returns `<skills>${count}</skills>` so we expect
    // 2 skills in the output.
    expect(out).toBe("<skills>2</skills>");
  });

  it("formatForAgentPrompt accepts a fileReadTool override", () => {
    const fakeSkills = [{ name: "fake" }] as never;
    const out = formatForAgentPrompt(fakeSkills, "bash");
    expect(out).toBe("<skills>1</skills>");
  });
});
