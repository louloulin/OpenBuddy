// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExpertStore } from "../src/agents/store";
import { parseExpertMarkdown, serializeExpert, slugify } from "../src/agents/expert-file";
import { SEED_EXPERTS, EXPERT_CATEGORIES, EXPERT_SCENES } from "../src/agents/seeds";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-experts-"));
  dirs.push(dir);
  return dir;
}
function setup(trusted: string[] = []) {
  const root = temp();
  const pi = join(root, "pi");
  mkdirSync(pi);
  const store = new ExpertStore({ dir: pi, trusted: (cwd) => trusted.includes(cwd) });
  return { root, pi, store };
}
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4480000000049454e44ae426082", "hex");

describe("expert files (pii W2.1)", () => {
  it("parses front matter and body, and round-trips through the template", () => {
    const raw = [
      "---",
      "name: 周报助手",
      "avatar: 📅",
      "description: 帮你写周报",
      "category: office",
      "thinking: low",
      "tools: [read, write]",
      "examples:",
      "  - 写本周周报",
      "  - 总结风险",
      "---",
      "",
      "你是一名周报助手。",
    ].join("\n");
    const { draft } = parseExpertMarkdown(raw, "fallback");
    expect(draft).toMatchObject({ name: "周报助手", avatar: "📅", category: "office", thinking: "low", tools: ["read", "write"], examples: ["写本周周报", "总结风险"], prompt: "你是一名周报助手。" });
    expect(parseExpertMarkdown(serializeExpert(draft), "x").draft).toEqual(draft);
    // Legacy files: numeric avatar, comma model_tags, no front matter name → file stem.
    const legacy = parseExpertMarkdown("---\ndescription: old\navatar: 3\nmodel_tags: default, reasoning\n---\nbody", "old-agent");
    expect(legacy).toMatchObject({ legacyAvatar: 3, modelTags: ["default", "reasoning"], draft: { name: "old-agent", prompt: "body" } });
    expect(slugify("Data Analyst!")).toBe("data-analyst");
    expect(slugify("数据分析师")).toBe("");
  });

  it("rejects bad YAML and invalid fields with expert_invalid", () => {
    expect(() => parseExpertMarkdown("---\nname: [unclosed\n---\nbody", "x")).toThrow(/expert_invalid: YAML/);
    expect(() => parseExpertMarkdown("---\nname: ok\nthinking: extreme\n---\nbody", "x")).toThrow(/expert_invalid/);
    expect(() => parseExpertMarkdown("---\nname: ok\ntools: [\"rm -rf\"]\n---\nbody", "x")).toThrow(/expert_invalid/);
    expect(() => parseExpertMarkdown("---\nname: ok\nexamples: {a: 1}\n---\nbody", "x")).toThrow(/expert_invalid/);
  });

  it("ships 8–12 self-written seeds with valid ids, categories and scenes", () => {
    expect(SEED_EXPERTS.length).toBeGreaterThanOrEqual(8);
    expect(SEED_EXPERTS.length).toBeLessThanOrEqual(12);
    const categories = new Set(EXPERT_CATEGORIES.map((c) => c.id));
    const ids = new Set<string>();
    for (const seed of SEED_EXPERTS) {
      expect(seed.id).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
      expect(ids.has(seed.id!)).toBe(false);
      ids.add(seed.id!);
      expect(categories.has(seed.category!)).toBe(true);
      expect(seed.prompt.length).toBeGreaterThan(200);
      expect(seed.examples!.length).toBeGreaterThanOrEqual(3);
      expect(parseExpertMarkdown(serializeExpert(seed), seed.id!).draft.name).toBe(seed.name);
    }
    for (const scene of EXPERT_SCENES) for (const id of scene.expertIds) expect(ids.has(id)).toBe(true);
    for (const area of ["office", "writing", "data", "dev", "research", "language", "product", "learning"])
      expect(SEED_EXPERTS.some((s) => s.category === area)).toBe(true);
  });
});

describe("expert store (pii W2.1)", () => {
  it("creates, updates, duplicates and deletes user experts; built-ins are read-only", () => {
    const { pi, store } = setup();
    expect(store.list()).toEqual([]);
    const created = store.save({ name: "My Analyst", avatar: "📈", prompt: "你是我的分析师。", examples: ["看看数据"] }, "create");
    expect(created).toMatchObject({ id: "my-analyst", scope: "user", readonly: false, emoji: "📈", examples: ["看看数据"] });
    expect(existsSync(join(pi, "agents", "my-analyst.md"))).toBe(true);
    // Chinese names get a generated id; creating twice never overwrites.
    const zh = store.save({ name: "周报助手", prompt: "写周报" }, "create");
    expect(zh.id).toMatch(/^expert-[0-9a-f]{6}$/);
    const again = store.save({ name: "My Analyst", prompt: "第二个" }, "create");
    expect(again.id).toBe("my-analyst-2");
    // A new expert never shadows a built-in id.
    expect(store.save({ id: "translator", name: "译", prompt: "p" }, "create").id).toBe("translator-2");
    const updated = store.save({ ...store.toDraft(created), description: "改过了" }, "update");
    expect(updated.description).toBe("改过了");
    expect(store.list().map((e) => e.id).sort()).toEqual(["my-analyst", "my-analyst-2", zh.id, "translator-2"].sort());
    expect(() => store.save({ id: "data-analyst", name: "x", prompt: "p" }, "update")).toThrow(/expert_readonly/);
    expect(() => store.save({ id: "nope", name: "x", prompt: "p" }, "update")).toThrow(/expert_not_found/);
    expect(() => store.save({ name: "x", prompt: "  " }, "create")).toThrow(/expert_invalid/);
    store.delete({ id: "my-analyst-2" });
    expect(() => store.delete({ id: "my-analyst-2" })).toThrow(/expert_not_found/);
    expect(() => store.delete({ id: "data-analyst" })).toThrow(/expert_readonly/);
    expect(store.get("data-analyst")).toMatchObject({ scope: "builtin", readonly: true, path: "builtin:data-analyst" });
    expect(() => store.get("missing")).toThrow(/expert_not_found/);
  });

  it("never treats an id or a legacy path as a way out of the user directory", () => {
    const { root, pi, store } = setup();
    writeFileSync(join(root, "outside.md"), "---\nname: outside\n---\nsecret");
    expect(() => store.get("../outside")).toThrow(/invalid_payload/);
    expect(() => store.delete({ id: "../outside" })).toThrow(/invalid_payload/);
    expect(() => store.getByPath(join(root, "outside.md"))).toThrow(/path_not_authorized/);
    expect(() => store.delete({ path: join(pi, "agents", "..", "..", "outside.md") })).toThrow(/path_not_authorized/);
    expect(existsSync(join(root, "outside.md"))).toBe(true);
    // Legacy raw save (old AssistantsPanel) lands in the user directory under a sanitized name.
    const saved = store.saveRaw("../../Evil Name", "---\nname: Evil\navatar: 2\n---\nbody");
    expect(saved).toMatchObject({ id: "evil-name", avatar: 2 });
    expect(store.getByPath(saved.path).id).toBe("evil-name");
    store.delete({ path: saved.path });
  });

  it("reads project experts only from trusted folders, and reports broken files", () => {
    const project = temp();
    mkdirSync(join(project, ".pi", "agents"), { recursive: true });
    writeFileSync(join(project, ".pi", "agents", "repo-guide.md"), "---\nname: 仓库向导\navatar: 🧭\n---\n熟悉本仓库。");
    writeFileSync(join(project, ".pi", "agents", "Bad Name.md"), "---\nname: x\n---\nbody");
    const untrusted = setup();
    expect(untrusted.store.list(project).map((e) => e.id)).toEqual([]);
    expect(() => untrusted.store.get("repo-guide", project)).toThrow(/expert_not_found/);
    expect(untrusted.store.catalog(project)).toMatchObject({ projectTrusted: false });
    const trusted = setup([project]);
    expect(trusted.store.list(project).map((e) => [e.id, e.scope])).toEqual([["repo-guide", "project"]]);
    const catalog = trusted.store.catalog(project);
    expect(catalog.projectTrusted).toBe(true);
    expect(catalog.experts.find((e) => e.id === "repo-guide")).toMatchObject({ scope: "project", readonly: true });
    expect(catalog.problems.map((p) => p.path)).toEqual([join(project, ".pi", "agents", "Bad Name.md")]);
    writeFileSync(join(trusted.pi, "agents", "broken.md"), "---\nname: [oops\n---\nbody");
    expect(trusted.store.catalog(project).problems.some((p) => p.path.endsWith("broken.md") && /YAML/.test(p.error))).toBe(true);
  });

  it("merges user > project > library > builtin and imports from a library", () => {
    const library = temp();
    mkdirSync(join(library, "agents"));
    writeFileSync(join(library, "Contract Reviewer.md"), "---\nname: 合同审阅\navatar: avatars/c.png\n---\n审合同。");
    writeFileSync(join(library, "agents", "translator.md"), "---\nname: 库里的翻译\n---\n库版本。");
    mkdirSync(join(library, "avatars"));
    writeFileSync(join(library, "avatars", "c.png"), PNG);
    const { pi, store } = setup();
    expect(() => store.setRoots(["relative/dir"])).toThrow(/invalid_payload/);
    expect(() => store.setRoots([join(library, "missing")])).toThrow(/invalid_payload/);
    expect(() => store.setRoots([join(pi, "agents")])).toThrow(/invalid_payload/);
    expect(store.setRoots([library, library])).toEqual([{ path: library, exists: true, count: 2 }]);
    expect(JSON.parse(readFileSync(join(pi, "experts-roots.json"), "utf8"))).toEqual({ roots: [library] });
    const catalog = store.catalog();
    const contract = catalog.experts.find((e) => e.id === "contract-reviewer")!;
    expect(contract).toMatchObject({ scope: "library", origin: library, image: join(library, "avatars", "c.png"), emoji: undefined });
    expect(catalog.experts.find((e) => e.id === "translator")).toMatchObject({ scope: "library", name: "库里的翻译" });
    expect(catalog.experts.filter((e) => e.id === "translator")).toHaveLength(1);
    expect(store.image(contract.image!, 1024).mime).toBe("image/png");
    // User copy wins over the library.
    expect(store.importFrom(library, ["translator"])).toBe(1);
    expect(store.importFrom(library, ["translator"])).toBe(0);
    expect(store.get("translator")).toMatchObject({ scope: "user", name: "库里的翻译" });
    expect(() => store.importFrom(temp())).toThrow(/path_not_authorized/);
  });

  it("lists library roots exactly as stored (canonical), so re-sending them adds nothing new", () => {
    // The desktop IPC boundary lets a root through without a native grant only when it is already
    // configured (register.ts): the paths experts_list_roots returns must be the ones setRoots keeps.
    const library = realpathSync(temp());
    const alias = join(temp(), "alias");
    symlinkSync(library, alias);
    const { store } = setup();
    expect(store.setRoots([alias]).map((r) => r.path)).toEqual([library]);
    const listed = store.listRoots().map((r) => r.path);
    expect(listed).toEqual([library]);
    expect(store.setRoots(listed).map((r) => r.path)).toEqual(listed);
    expect(store.setRoots([])).toEqual([]);
  });

  it("serves images only from allowed roots, never through symlinks out of them", () => {
    const { root, pi, store } = setup();
    mkdirSync(join(pi, "agents"), { recursive: true });
    writeFileSync(join(pi, "agents", "me.png"), PNG);
    writeFileSync(join(root, "secret.png"), PNG);
    symlinkSync(join(root, "secret.png"), join(pi, "agents", "link.png"));
    expect(store.image(join(pi, "agents", "me.png"), 1024).base64).toBe(PNG.toString("base64"));
    expect(() => store.image(join(root, "secret.png"), 1024)).toThrow(/path_not_authorized/);
    expect(() => store.image(join(pi, "agents", "link.png"), 1024)).toThrow(/path_not_authorized/);
    expect(() => store.image(join(pi, "openbuddy.json"), 1024)).toThrow(/path_not_authorized/);
    expect(() => store.image("agents/me.png", 1024)).toThrow(/path_not_authorized/);
    expect(() => store.image(join(pi, "agents", "me.png"), 10)).toThrow(/invalid_payload/);
  });
});
