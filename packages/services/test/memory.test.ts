// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService, MEMORY_INJECT_CHARS } from "../src/memory/memory";
import type { Settings } from "../src/settings/settings";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup(trusted = false) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "openbuddy-memory-"));
  dirs.push(root);
  const pi = join(root, "pi");
  mkdirSync(pi);
  const cwd = join(root, "workspace");
  mkdirSync(join(cwd, ".pi", "memory"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "memory", "PROJECT.md"), "# 项目约定\n\n- 使用 pnpm\n");
  const memory = new MemoryService({ dir: pi } as Settings, () => trusted);
  return { root, pi, cwd, memory };
}

describe("memory service (pii W5.1–W5.3)", () => {
  it("saves, lists, reads and deletes a global note", async () => {
    const { memory } = setup();
    await memory.save("global", "notes/tone.md", "# 语气\n\n- 简洁\n");
    const list = await memory.list();
    expect(list.map((e) => `${e.scope}/${e.path}`)).toEqual(["global/notes/tone.md"]);
    expect(await memory.get("global", "notes/tone.md")).toContain("简洁");
    await memory.delete("global", "notes/tone.md");
    expect(await memory.list()).toEqual([]);
  });

  it("gates workspace memory on folder trust", async () => {
    const untrusted = setup(false);
    expect(await untrusted.memory.list(untrusted.cwd)).toEqual([]);
    await expect(untrusted.memory.save("workspace", "x.md", "x", untrusted.cwd)).rejects.toThrow("memory_trust_required");
    const trusted = setup(true);
    expect((await trusted.memory.list(trusted.cwd)).map((e) => e.path)).toEqual(["PROJECT.md"]);
    expect(await trusted.memory.get("workspace", "PROJECT.md", trusted.cwd)).toContain("pnpm");
  });

  it("rejects paths that escape the memory directory or are not markdown", async () => {
    const { memory } = setup();
    await expect(memory.save("global", "../escape.md", "x")).rejects.toThrow("memory_invalid_path");
    await expect(memory.save("global", "/etc/passwd.md", "x")).rejects.toThrow("memory_invalid_path");
    await expect(memory.save("global", "note.txt", "x")).rejects.toThrow("memory_invalid_path");
  });

  it("ob_remember appends a dated bullet to MEMORY.md", async () => {
    const { memory, pi } = setup();
    await memory.remember("周报要列风险和下一步", "周报格式偏好");
    await memory.remember("回答尽量简洁");
    const file = readFileSync(join(pi, "memory", "MEMORY.md"), "utf8");
    expect(file).toContain("**周报格式偏好**：周报要列风险和下一步");
    expect(file).toContain("回答尽量简洁");
    expect((await memory.list()).map((e) => e.path)).toEqual(["MEMORY.md"]);
  });

  it("injects global memory, plus trusted workspace memory, within the budget", async () => {
    const { memory } = setup(true);
    await memory.remember("用户偏好中文回答");
    const injected = await memory.injection();
    // Without a cwd only global memory is injected.
    expect(injected).toContain("用户偏好中文回答");
    await memory.save("global", "long.md", "x".repeat(MEMORY_INJECT_CHARS));
    const truncated = await memory.injection();
    expect(truncated).toContain("还有更多记忆未展示");
  });

  it("rewrite merges notes into MEMORY.md without duplicates and is idempotent", async () => {
    const { memory, pi } = setup();
    await memory.save("global", "a.md", "- 简洁\n- 中文\n");
    await memory.save("global", "b.md", "- 中文\n- 列风险\n");
    await memory.save("global", "MEMORY.md", "- 简洁\n");
    const first = await memory.rewrite();
    expect(first.kept).toBe(3);
    const merged = readFileSync(join(pi, "memory", "MEMORY.md"), "utf8");
    expect(merged.match(/- 中文/g)).toHaveLength(1);
    expect(merged).toContain("- 列风险");
    expect(existsSync(join(pi, "memory", "a.md"))).toBe(false);
    const second = await memory.rewrite();
    expect(second.kept).toBe(3);
  });
});
