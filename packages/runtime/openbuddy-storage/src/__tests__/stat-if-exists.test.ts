/**
 * statIfExists — 存在性探测的唯一正确写法。
 *
 * 为什么值得单测
 * --------------
 * 这个函数存在的原因是 Node 22 与 Node 24 行为不一致:
 *
 *   Node 22: `await fs.promises.stat(p, { throwIfNoEntry: false })` 抛 ENOENT
 *   Node 24: 同样的调用返回 undefined
 *
 * CI(`node-version: 22`)与 Electron 44 都跑 Node 22,开发机是 Node 24,
 * 于是"探测可选文件"这类代码在本地全绿、在 CI 全红,而且红的是别人写的
 * 测试(profile-module-resolution / filesystem smoke),看起来毫不相关。
 *
 * 单测只能锁住"本机运行时的行为符合预期"这一层;版本差异本身由实现方式
 * 规避(不依赖那个选项)。所以这里断言的是契约,而不是某个版本的特例。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { statIfExists } from "../fs-util";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stat-if-exists-"));
  roots.push(root);
  return root;
}

describe("statIfExists", () => {
  it("returns Stats for an existing file", async () => {
    const root = await tmpRoot();
    const file = join(root, "a.txt");
    await writeFile(file, "x");

    const stats = await statIfExists(file);
    expect(stats?.isFile()).toBe(true);
  });

  it("returns Stats for an existing directory", async () => {
    const root = await tmpRoot();
    const stats = await statIfExists(root);
    expect(stats?.isDirectory()).toBe(true);
  });

  it("returns undefined for a missing path instead of throwing (Node 22 regression)", async () => {
    // 这一条就是回归点:Node 22 上 `stat(p, { throwIfNoEntry: false })`
    // 会在这里抛 ENOENT,把整个调用方(比如 profile 模块解析)拖垮。
    const root = await tmpRoot();
    await expect(statIfExists(join(root, "nope.txt"))).resolves.toBeUndefined();
  });

  it("returns undefined when a path segment is not a directory (ENOTDIR)", async () => {
    // 探测"a.txt/index.js"这种候选时,中间段是文件会让 stat 抛 ENOTDIR;
    // 对调用方来说这和"不存在"是同一件事。
    const root = await tmpRoot();
    const file = join(root, "a.txt");
    await writeFile(file, "x");

    await expect(statIfExists(join(file, "child.js"))).resolves.toBeUndefined();
  });

  it("does not swallow a symlink loop (ELOOP) as absence", async () => {
    // 权限/IO/循环链接不是"不存在"。静默返回 undefined 会让真正的故障
    // 伪装成"文件怎么不见了"。
    const root = await tmpRoot();
    const { symlink } = await import("node:fs/promises");
    const loop = join(root, "loop");
    try {
      await symlink(loop, loop);
    } catch {
      return; // 平台不支持创建自环链接时跳过(不影响其它断言)。
    }

    await expect(statIfExists(loop)).rejects.toThrow();
  });
});
