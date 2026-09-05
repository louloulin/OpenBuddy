import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-workbuddy-import-test" },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("./casdoor/casdoor-auth", () => ({
  casdoorAuth: { status: () => ({ config: { configured: false }, identity: null, tenantContext: { activeTenantId: undefined } }) },
}));

const originalPiHome = process.env.PI_HOME;
const originalPiAgent = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  vi.resetModules();
  if (originalPiHome === undefined) delete process.env.PI_HOME;
  else process.env.PI_HOME = originalPiHome;
  if (originalPiAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiAgent;
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-workbuddy-source-"));
  const plugin = join(root, "plugins", "marketplaces", "my-experts", "plugins", "citongshuopro");
  await mkdir(join(plugin, ".codebuddy-plugin"), { recursive: true });
  await mkdir(join(plugin, "agents"), { recursive: true });
  await mkdir(join(plugin, "skills", "research"), { recursive: true });
  await writeFile(join(plugin, ".codebuddy-plugin", "plugin.json"), JSON.stringify({
    name: "citongshuopro",
    version: "1.2.0",
    expertType: "team",
    agentName: "lead",
    apiToken: "must-not-be-copied",
    members: [{ agentName: "lead" }, { agentName: "analyst" }],
  }));
  await writeFile(join(plugin, "agents", "lead.md"), "---\nname: lead\ndescription: 汇总负责人\n---\n先执行 TeamCreate，再通过 SendMessage 调度成员并汇总结果。\n");
  await writeFile(join(plugin, "agents", "analyst.md"), "---\nname: analyst\ndescription: 基本面分析\n---\n通过 SendMessage 回传分析结果。\n");
  await writeFile(join(plugin, "skills", "research", "SKILL.md"), "---\ndescription: 研究技能\n---\n");
  return root;
}

async function loadWithHome() {
  return import("./workbuddy-import");
}

describe("WorkBuddy import service", () => {
  it("previews and imports a marketplace team without credentials", async () => {
    const source = await fixture();
    const home = await mkdtemp(join(tmpdir(), "openbuddy-workbuddy-home-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const importer = await loadWithHome();

    const preview = await importer.previewWorkBuddyImport(source, "citongshuopro");
    expect(preview.team).toBe(true);
    expect(preview.leadAgent).toBe("lead");
    expect(preview.members).toHaveLength(2);
    expect(preview.skills).toEqual(["research"]);
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toContain("redacted manifest field: apiToken");

    const result = await importer.confirmWorkBuddyImport(preview.previewToken);
    expect(result.autoActivated).toBe(false);
    expect(result.status).toBe("installed");
    const installed = join(home, ".pi", "agent", "workbuddy-experts", "citongshuopro");
    await expect(readFile(join(installed, "plugin.json"), "utf8")).resolves.not.toContain("apiToken");
    await expect(stat(join(installed, "agents", "lead.md"))).resolves.toBeTruthy();
    await expect(stat(join(home, ".pi", "agent", "workbuddy-experts", "_meta", "_expert_center.json"))).resolves.toBeTruthy();
    const resources = await import("./agent/pi-resources");
    await expect(resources.expertDefaultRoot("/tmp/openbuddy-import-test")).resolves.toBe(join(home, ".pi", "agent", "workbuddy-experts"));
    await expect(resources.listExpertCatalog(join(home, ".pi", "agent", "workbuddy-experts"))).resolves.toMatchObject({ experts: [{ plugin: "citongshuopro", type: "team", agentName: "lead" }] });

    const repeatPreview = await importer.previewWorkBuddyImport(source, "citongshuopro");
    expect(repeatPreview.disposition).toBe("same");
    await expect(importer.confirmWorkBuddyImport(repeatPreview.previewToken)).resolves.toMatchObject({ status: "already-installed", autoActivated: false });
    await expect(importer.rollbackWorkBuddyImport(result.importId)).resolves.toMatchObject({ status: "rolled-back" });
    await expect(stat(installed)).rejects.toThrow();
  });

  it("rejects unsafe plugin ids and team prompts without collaboration contract", async () => {
    const source = await fixture();
    const home = await mkdtemp(join(tmpdir(), "openbuddy-workbuddy-home-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const importer = await loadWithHome();
    await expect(importer.previewWorkBuddyImport(source, "../escape")).rejects.toThrow("invalid name");

      await writeFile(join(source, "plugins", "marketplaces", "my-experts", "plugins", "citongshuopro", "agents", "analyst.md"), "---\nname: analyst\n---\nNo collaboration.\n");
    const preview = await importer.previewWorkBuddyImport(source, "citongshuopro");
    expect(preview.disposition).toBe("blocked");
    expect(preview.errors.some((error) => error.includes("SendMessage"))).toBe(true);
    await expect(importer.confirmWorkBuddyImport(preview.previewToken)).rejects.toThrow("blocked");
  });

  it("rejects traversal in declared assets before staging", async () => {
    const source = await fixture();
    const home = await mkdtemp(join(tmpdir(), "openbuddy-workbuddy-home-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
      const manifest = join(source, "plugins", "marketplaces", "my-experts", "plugins", "citongshuopro", ".codebuddy-plugin", "plugin.json");
    await writeFile(manifest, JSON.stringify({ name: "citongshuopro", version: "1.2.0", expertType: "team", agentName: "lead", avatar: "../outside.png" }));
    const importer = await loadWithHome();
    await expect(importer.previewWorkBuddyImport(source, "citongshuopro")).rejects.toThrow("outside the selected WorkBuddy root");
  });
});
