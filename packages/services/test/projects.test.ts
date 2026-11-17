// @vitest-environment node
// pii W5.4: projects persist in projects.json; import is idempotent; instructions follow the cwd.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectsService } from "../src/projects/projects";
import { createSettings } from "../src/settings/settings";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-projects-"));
  dirs.push(root);
  const settings = createSettings(root, { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
  return { root, settings, projects: new ProjectsService(settings) };
}
const project = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `项目 ${id}`,
  createdAt: "2026-11-17T00:00:00.000Z",
  connectors: [],
  plans: [{ id: "p1", title: "计划", status: "pending" }],
  ...over,
});

describe("项目后端 (pii W5.4)", () => {
  it("saves, updates and deletes projects in projects.json", () => {
    const { settings, projects } = setup();
    projects.save(project("a"));
    projects.save(project("b"));
    expect(projects.list().map((p) => p.id)).toEqual(["b", "a"]);
    // Renderer-owned detail survives the round trip.
    expect((projects.list()[0] as { plans: unknown[] }).plans).toHaveLength(1);

    projects.save(project("a", { name: "改名" }));
    expect(projects.list()).toHaveLength(2);
    expect(projects.list().find((p) => p.id === "a")?.name).toBe("改名");

    projects.remove("b");
    expect(projects.list().map((p) => p.id)).toEqual(["a"]);
    expect(JSON.parse(readFileSync(join(settings.dir, "projects.json"), "utf8"))).toHaveLength(1);
  });

  it("imports the old localStorage list once (idempotent by id)", () => {
    const { projects } = setup();
    const first = projects.import([project("a"), project("b"), { name: "无 id" }]);
    expect(first).toMatchObject({ imported: 2, skipped: 1 });
    const again = projects.import([project("a"), project("b")]);
    expect(again).toMatchObject({ imported: 0, skipped: 2 });
    expect(again.projects).toHaveLength(2);
  });

  it("appends project instructions for sessions opened in that cwd", () => {
    const { projects } = setup();
    projects.save(project("a", { cwd: "/ws/app", instructions: "  使用 pnpm，不要 npm。  " }));
    expect(projects.instructionsFor("/ws/app")).toBe("## 项目说明 · 项目 a\n使用 pnpm，不要 npm。");
    expect(projects.instructionsFor("/ws/other")).toBeUndefined();
    // Empty instructions never add an empty section.
    projects.save(project("b", { cwd: "/ws/empty", instructions: "   " }));
    expect(projects.instructionsFor("/ws/empty")).toBeUndefined();
  });

  it("rejects malformed records", () => {
    const { projects } = setup();
    expect(() => projects.save({ id: "", name: "" } as never)).toThrow("invalid_project");
    expect(projects.list()).toEqual([]);
  });
});
