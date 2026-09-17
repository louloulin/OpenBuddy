import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-expert-starter-test" },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const originalAgentDir = process.env.OPENBUDDY_AGENT_DIR;
const originalPiAgent = process.env.PI_CODING_AGENT_DIR;
const originalPiHome = process.env.PI_HOME;
const originalAgentsDir = process.env.OPENBUDDY_AGENTS_DIR;

afterEach(() => {
  for (const [key, value] of [
    ["OPENBUDDY_AGENT_DIR", originalAgentDir],
    ["PI_CODING_AGENT_DIR", originalPiAgent],
    ["PI_HOME", originalPiHome],
    ["OPENBUDDY_AGENTS_DIR", originalAgentsDir],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "openbuddy-expert-starter-"));
  process.env.OPENBUDDY_AGENT_DIR = home;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_HOME;
  delete process.env.OPENBUDDY_AGENTS_DIR;
  return home;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

describe("built-in starter expert pack", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("materializes a catalog on a fresh agent home and resolves it as the default root", async () => {
    const home = await freshHome();
    const seed = await import("./seed");
    const agents = await import("../agents");

    const root = await agents.expertDefaultRoot(home);
    expect(root).toBe(join(home, "experts"));

    const catalog = (await agents.listExpertCatalog(root)) as {
      experts: Array<Record<string, unknown>>;
      categories: Array<Record<string, unknown>>;
      featuredScenes: Array<Record<string, unknown>>;
    };

    // The page needs a non-empty grid AND resolvable scenes — that was the whole gap.
    expect(catalog.experts.length).toBeGreaterThanOrEqual(6);
    expect(catalog.categories.length).toBeGreaterThanOrEqual(5);
    expect(catalog.featuredScenes.length).toBeGreaterThanOrEqual(5);

    // Every starter expert must carry a resolvable plugin + lead agent, otherwise
    // "召唤" silently produces an empty prompt.
    for (const expert of catalog.experts) {
      expect(expert.plugin).toMatch(/^starter-/);
      expect(expert.agentName).toBe("lead");
      expect(String(expert.desc ?? "").length).toBeGreaterThan(10);
    }

    // Scenes must only reference ids that exist, or FeaturedScenes drops them.
    const ids = new Set(catalog.experts.map((expert) => String(expert.id)));
    for (const scene of catalog.featuredScenes) {
      const expertIds = (scene.expertIds ?? []) as string[];
      expect(expertIds.length).toBeGreaterThan(0);
      for (const id of expertIds) expect(ids.has(id)).toBe(true);
    }

    // The agent prompt must be readable from disk — that is what gets summoned.
    const prompt = await agents.readExpertAgent(root, "starter-software-engineer", "lead");
    expect(prompt).toContain("name:");
    expect(prompt.length).toBeGreaterThan(200);

    expect(seed.STARTER_SEED_VERSION).toBe(1);
  });

  it("is idempotent and preserves user edits to a built-in agent prompt", async () => {
    const home = await freshHome();
    const seed = await import("./seed");
    const agents = await import("../agents");

    await agents.expertDefaultRoot(home);
    const agentFile = join(home, "experts", "starter-code-reviewer", "agents", "lead.md");
    await writeFile(agentFile, "---\nname: 我的审查员\n---\n\n自定义提示词\n");

    const markerBefore = await readJson(join(home, "experts", "_meta", ".starter-seed.json"));
    await seed.ensureStarterExperts(join(home, "experts"));
    const markerAfter = await readJson(join(home, "experts", "_meta", ".starter-seed.json"));

    // Marker untouched ⇒ the fast path was taken, not a re-write.
    expect(markerAfter).toEqual(markerBefore);
    expect(await readFile(agentFile, "utf8")).toContain("自定义提示词");
  });

  it("re-seeds when the marker version is stale, without dropping imported experts", async () => {
    const home = await freshHome();
    const agents = await import("../agents");
    const root = await agents.expertDefaultRoot(home);

    const centerPath = join(root, "_meta", "_expert_center.json");
    const center = await readJson(centerPath);
    const experts = (center.experts ?? []) as Array<Record<string, unknown>>;
    experts.push({ id: "citongshuopro", plugin: "citongshuopro", categoryId: "imported", displayName: { zh: "导入专家" }, expertType: "team", agentName: "lead" });
    await writeFile(centerPath, JSON.stringify({ ...center, experts }, null, 2));
    await writeFile(join(root, "_meta", ".starter-seed.json"), JSON.stringify({ version: 0, seededAt: "2020-01-01T00:00:00.000Z" }));

    const seed = await import("./seed");
    await seed.ensureStarterExperts(root);

    const next = await readJson(centerPath);
    const plugins = ((next.experts ?? []) as Array<Record<string, unknown>>).map((expert) => expert.plugin);
    expect(plugins).toContain("citongshuopro"); // user import survived
    expect(plugins).toContain("starter-software-engineer"); // built-ins restored
    expect(new Set(plugins).size).toBe(plugins.length); // no duplicates from the merge
  });

  it("never throws when the agent home is not writable", async () => {
    const home = await freshHome();
    const seed = await import("./seed");
    await expect(seed.tryEnsureStarterExperts()).resolves.toBeUndefined();
    // Point at a path whose parent is a file, so mkdir must fail.
    const blocker = join(home, "blocker");
    await mkdir(home, { recursive: true });
    await writeFile(blocker, "not a directory");
    process.env.OPENBUDDY_AGENT_DIR = join(blocker, "nested");
    await expect(seed.tryEnsureStarterExperts()).resolves.toBeUndefined();
  });
  it("emits pi-subagents-compatible frontmatter on every starter agent", async () => {
    const home = await freshHome();
    const seed = await import("./seed");
    const agents = await import("../agents");
    const root = await agents.expertDefaultRoot(home);

    // Sample three different starter plugins to make sure every plugin gets
    // the contract, not just one. The team plugin also has member agents.
    const samples = ["starter-software-engineer", "starter-longform-writer", "starter-delivery-team"];
    for (const plugin of samples) {
      const leadPath = join(root, plugin, "agents", "lead.md");
      const raw = await readFile(leadPath, "utf8");
      // pi-subagents contract: slug name, advertise in catalog, tools inherit,
      // systemPromptMode append (so the agent keeps project context).
      expect(raw, `lead frontmatter for ${plugin}`).toMatch(/^---\n/);
      expect(raw).toMatch(new RegExp(`name: ${plugin}\\b`));
      expect(raw).toMatch(/advertise: true/);
      expect(raw).toMatch(/tools: inherit/);
      expect(raw).toMatch(/systemPromptMode: append/);
    }
  });

  it("materializes every team member as its own discoverable agent", async () => {
    const home = await freshHome();
    const seed = await import("./seed");
    const agents = await import("../agents");
    const root = await agents.expertDefaultRoot(home);
    const teamDir = join(root, "starter-delivery-team", "agents");
    const members = ["starter-clarifier", "starter-drafter", "starter-reviewer", "starter-finalizer"];
    for (const id of members) {
      const file = join(teamDir, `${id}.md`);
      const raw = await readFile(file, "utf8");
      expect(raw, `${id} .md must exist`).toMatch(/^# .+ — /m);  // body has the role line
      expect(raw).toMatch(new RegExp(`name: ${id}\\b`));
      expect(raw).toMatch(/advertise: true/);
    }
    // Lead must reference the member ids by name (so the model can dispatch
    // to them via `subagent({ agent: "<id>" })` after discovery).
    const lead = await readFile(join(teamDir, "lead.md"), "utf8");
    for (const id of members) expect(lead, `lead should mention ${id}`).toContain(id);
  });

});
