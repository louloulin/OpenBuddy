// @vitest-environment node
// 20261116-pii W1.3: workspace file search for `@` mentions.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearFileSearchCache, fuzzyScore, isIgnored, parseIgnore, searchFiles } from "../src/files/search";

const roots: string[] = [];
beforeEach(() => clearFileSearchCache());
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function tree(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-search-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("gitignore rules", () => {
  it("matches like git: basename anywhere, anchored paths, dir-only, ** and negation", () => {
    const rules = parseIgnore(["# comment", "*.log", "/dist", "build/", "docs/**/*.tmp", "!keep.log", "", "secret?.txt"].join("\n"));
    expect(isIgnored(rules, "a.log", false)).toBe(true);
    expect(isIgnored(rules, "src/deep/b.log", false)).toBe(true);
    expect(isIgnored(rules, "keep.log", false)).toBe(false);
    expect(isIgnored(rules, "dist", true)).toBe(true);
    expect(isIgnored(rules, "src/dist", true)).toBe(false);
    expect(isIgnored(rules, "build", true)).toBe(true);
    expect(isIgnored(rules, "build", false)).toBe(false);
    expect(isIgnored(rules, "docs/x/y/z.tmp", false)).toBe(true);
    expect(isIgnored(rules, "docs/z.tmp", false)).toBe(true);
    expect(isIgnored(rules, "secret1.txt", false)).toBe(true);
    expect(isIgnored(rules, "secret12.txt", false)).toBe(false);
    // Rules of a nested ignore file only apply below it.
    const nested = parseIgnore("*.md", "pkg");
    expect(isIgnored(nested, "pkg/readme.md", false)).toBe(true);
    expect(isIgnored(nested, "readme.md", false)).toBe(false);
  });
});

describe("fuzzy ranking", () => {
  it("prefers exact and prefix name matches, then substrings, then subsequences; null when nothing matches", () => {
    expect(fuzzyScore("report.md", "docs/report.md")!).toBeGreaterThan(fuzzyScore("report", "docs/report.md")!);
    expect(fuzzyScore("rep", "docs/report.md")!).toBeGreaterThan(fuzzyScore("rep", "src/prepare.ts")!);
    expect(fuzzyScore("docs", "docs/report.md")!).toBeGreaterThan(fuzzyScore("rpt", "docs/report.md")!);
    expect(fuzzyScore("rpt", "docs/report.md")).not.toBeNull();
    expect(fuzzyScore("xyz", "docs/report.md")).toBeNull();
    expect(fuzzyScore("rep", "report.md")!).toBeGreaterThan(fuzzyScore("rep", "a/b/c/report.md")!);
  });
});

describe("searchFiles", () => {
  it("lists workspace files with Pi's find ignore rules and ranks them", async () => {
    const root = await tree({
      ".gitignore": "*.log\nout/\n",
      "docs/report.md": "# report",
      "docs/notes.txt": "notes",
      "src/app.ts": "x",
      "src/.hidden.ts": "hidden files are listed, as with fd --hidden",
      "debug.log": "ignored",
      "out/bundle.js": "ignored dir",
      "node_modules/pkg/index.js": "never",
      ".git/config": "never",
      "pkg/.gitignore": "generated.ts\n",
      "pkg/generated.ts": "ignored by the nested file",
      "pkg/real.ts": "kept",
    });
    const all = await searchFiles(root, "");
    const paths = all.hits.map((h) => h.path).sort();
    expect(paths).toEqual([".gitignore", "docs/notes.txt", "docs/report.md", "pkg/.gitignore", "pkg/real.ts", "src/.hidden.ts", "src/app.ts"]);
    expect(all.partial).toBe(false);
    const ranked = await searchFiles(root, "rep");
    expect(ranked.hits[0]).toMatchObject({ path: "docs/report.md", name: "report.md" });
    expect((await searchFiles(root, "zzz")).hits).toEqual([]);
    expect((await searchFiles(root, "docs/no")).hits.map((h) => h.path)).toEqual(["docs/notes.txt"]);
  });

  it("returns at most 200 results and never leaves the workspace through symlinks", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 260; i++) files[`many/file-${String(i).padStart(3, "0")}.txt`] = String(i);
    const root = await tree(files);
    const outside = await tree({ "secret.txt": "outside", "dir/inner.txt": "outside" });
    await symlink(join(outside, "secret.txt"), join(root, "link-to-secret.txt"));
    await symlink(join(outside, "dir"), join(root, "link-to-dir"), "dir");
    await writeFile(join(root, "inside.txt"), "in");
    await symlink(join(root, "inside.txt"), join(root, "link-inside.txt"));
    const result = await searchFiles(root, "file");
    expect(result.hits).toHaveLength(200);
    const every = (await searchFiles(root, "", 200)).hits.map((h) => h.path);
    clearFileSearchCache();
    const names = (await searchFiles(root, "link")).hits.map((h) => h.path);
    expect(names).toEqual(["link-inside.txt"]);
    expect(every.some((p) => p.includes("secret") || p.includes("inner"))).toBe(false);
    expect((await searchFiles(root, "secret")).hits).toEqual([]);
  });

  it("inherits ignore files above the workspace up to the repository root", async () => {
    const repo = await tree({ ".git/HEAD": "ref", ".gitignore": "*.cache\n", "app/sub/data.cache": "x", "app/sub/main.ts": "x" });
    const hits = (await searchFiles(join(repo, "app"), "")).hits.map((h) => h.path);
    expect(hits).toEqual(["sub/main.ts"]);
  });
});
