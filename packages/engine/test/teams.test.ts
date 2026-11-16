// @vitest-environment node
// pii W3.5: preset expert pipelines install as normal 我的指令 prompt templates.
import { afterEach, describe, expect, it } from "vitest";
import { sdkFixture } from "./helpers/sdk-fixture.js";
import { TEAM_SEEDS, teamPrompt } from "@openbuddy/services/agents/teams";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("专家团 (pii W3.5)", () => {
  it("writes a chain prompt that names every stage and the user's task", () => {
    const team = TEAM_SEEDS[0];
    const text = teamPrompt(team);
    expect(text).toContain("ob_subagent");
    expect(text).toContain("mode=chain");
    for (const stage of team.stages) {
      expect(text).toContain(stage.expertId);
      expect(text).toContain(stage.instruction);
    }
    expect(text).toContain("$ARGUMENTS");
  });

  it("lists the built-in teams and installs one as a /team- prompt template", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    const before = (await f.call("teams_list")) as Array<{ id: string; installed?: boolean; command: string }>;
    expect(before.length).toBeGreaterThanOrEqual(3);
    expect(before.every((team) => team.installed === false)).toBe(true);

    const target = before[0];
    const installed = (await f.call("teams_install", { id: target.id })) as { installed?: boolean; command: string };
    expect(installed.installed).toBe(true);

    const prompts = (await f.call("prompts_list")) as Array<{ name: string; content: string; scope: string }>;
    const saved = prompts.find((entry) => entry.name === target.command);
    expect(saved).toMatchObject({ scope: "global" });
    expect(saved?.content).toContain("ob_subagent");

    const after = (await f.call("teams_list")) as Array<{ id: string; installed?: boolean }>;
    expect(after.find((team) => team.id === target.id)?.installed).toBe(true);
    // Idempotent: installing again keeps one template.
    await f.call("teams_install", { id: target.id });
    const again = (await f.call("prompts_list")) as Array<{ name: string }>;
    expect(again.filter((entry) => entry.name === target.command)).toHaveLength(1);
  });
});
