// @vitest-environment node
// 文件触发 (pii W4.7): the watcher finds file changes (debounced) and injects the content.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTriggerWatcher, readTriggerContent } from "../src/automation/triggers";

const dirs: string[] = [];
const watchers: FileTriggerWatcher[] = [];
afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-trigger-"));
  dirs.push(dir);
  return dir;
}

describe("文件触发 watcher (pii W4.7)", () => {
  it("reports a change after the debounce window and carries the content", async () => {
    const dir = tempDir();
    const file = join(dir, "inbox.csv");
    writeFileSync(file, "a,b\n1,2\n");
    const changes: Array<{ path: string; meta?: unknown }> = [];
    const watcher = new FileTriggerWatcher((change) => changes.push(change));
    watchers.push(watcher);
    expect(watcher.watch(file, { debounceMs: 20, meta: "task-1" })).toBe(true);
    // fs.watch 注册后立刻写文件可能丢事件；给 watcher 一个事件循环的时间。
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(file, "a,b\n1,2\n3,4\n");
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0].path).toBe(file);
    expect(changes[0].meta).toBe("task-1");
    expect(readTriggerContent(file)).toContain("3,4");
  });

  it("merges a burst of writes into one run", async () => {
    const dir = tempDir();
    const file = join(dir, "inbox.csv");
    writeFileSync(file, "x");
    const changes: unknown[] = [];
    const watcher = new FileTriggerWatcher((change) => changes.push(change));
    watchers.push(watcher);
    watcher.watch(file, { debounceMs: 60 });
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(file, `x${i}`);
      await new Promise((r) => setTimeout(r, 10));
    }
    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 120));
    expect(changes).toHaveLength(1);
  });

  it("ignores other files in the same directory", async () => {
    const dir = tempDir();
    const watched = join(dir, "watched.txt");
    const other = join(dir, "other.txt");
    writeFileSync(watched, "a");
    writeFileSync(other, "b");
    const changes: unknown[] = [];
    const watcher = new FileTriggerWatcher((change) => changes.push(change));
    watchers.push(watcher);
    watcher.watch(watched, { debounceMs: 20 });
    writeFileSync(other, "c");
    await new Promise((r) => setTimeout(r, 120));
    expect(changes).toHaveLength(0);
  });

  it("watches a directory and refuses a missing path", async () => {
    const dir = tempDir();
    const changes: unknown[] = [];
    const watcher = new FileTriggerWatcher((change) => changes.push(change));
    watchers.push(watcher);
    expect(watcher.watch(join(dir, "nope.txt"))).toBe(false);
    expect(watcher.watch(dir, { debounceMs: 20 })).toBe(true);
    expect(watcher.watching).toHaveLength(1);
    writeFileSync(join(dir, "new.txt"), "hello");
    await vi.waitFor(() => expect(changes).toHaveLength(1));
  });

  it("stops watching on unwatch", async () => {
    const dir = tempDir();
    const file = join(dir, "inbox.csv");
    writeFileSync(file, "x");
    const changes: unknown[] = [];
    const watcher = new FileTriggerWatcher((change) => changes.push(change));
    watchers.push(watcher);
    watcher.watch(file, { debounceMs: 20 });
    watcher.unwatch(file);
    expect(watcher.watching).toHaveLength(0);
    writeFileSync(file, "y");
    await new Promise((r) => setTimeout(r, 120));
    expect(changes).toHaveLength(0);
  });

  it("reads the content, truncating very large files", () => {
    const dir = tempDir();
    const file = join(dir, "big.txt");
    writeFileSync(file, "x".repeat(200));
    expect(readTriggerContent(file, 50)).toContain("内容已截断");
    expect(readTriggerContent(join(dir, "missing.txt"))).toBe("");
  });
});
