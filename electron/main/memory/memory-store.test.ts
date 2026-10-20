import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addMemory,
  deleteMemory,
  listMemories,
  recallMemories,
  updateMemory,
  workspaceKey,
} from "./memory-store";

/**
 * 两层记忆的语义断言(阶段 1.5)。重点是三条边界:
 *   - 不传 cwd 时**看不到**任何工作区记忆(不跨工作区串味);
 *   - agent 召回**两层都要**(它代表用户干活);
 *   - 并发 add 不丢条目(串行化的读-改-写)。
 */
describe("memory-store", () => {
  let home: string;
  let previous: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "openbuddy-memory-"));
    previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = home;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(home, { recursive: true, force: true });
  });

  it("落盘位置是 agentHome/memory.json,且可读回", async () => {
    const entry = await addMemory({ title: "偏好", body: "回答用中文" });
    expect(entry.scope).toBe("user");
    const raw = JSON.parse(await readFile(join(home, "memory.json"), "utf8")) as { entries: unknown[] };
    expect(raw.entries).toHaveLength(1);
    expect((await listMemories({ query: "中文" }))[0]?.id).toBe(entry.id);
  });

  it("工作区记忆不跨工作区串味,且不传 cwd 时不可见", async () => {
    const a = workspaceKey("/tmp/ws-a");
    const b = workspaceKey("/tmp/ws-b");
    await addMemory({ scope: "workspace", cwd: a, title: "A 的约定", body: "只在 A 用" });

    expect(await listMemories({ cwd: a, query: "约定" })).toHaveLength(1);
    expect(await listMemories({ cwd: b, query: "约定" })).toHaveLength(0);
    expect(await listMemories({ query: "约定" })).toHaveLength(0);
  });

  it("agent 召回覆盖用户层 + 当前工作区层", async () => {
    const a = workspaceKey("/tmp/ws-a");
    await addMemory({ title: "全局口径", body: "术语 X 指 Y" });
    await addMemory({ scope: "workspace", cwd: a, title: "本仓库约定", body: "跑测试用 pnpm test" });
    const other = await recallMemories({ query: "约定", cwd: workspaceKey("/tmp/ws-other") });
    expect(other).toHaveLength(0);
    const mine = await recallMemories({ query: "约定", cwd: a });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.cwd).toBe(a);
    const global = await recallMemories({ query: "术语" });
    expect(global.map((entry) => entry.title)).toEqual(["全局口径"]);
  });

  it("更新/删除按 id 作用,未知 id 不报错", async () => {
    const entry = await addMemory({ title: "旧标题", body: "b", tags: ["x"] });
    const updated = await updateMemory(entry.id, { title: "新标题", tags: ["y", "z"] });
    expect(updated?.title).toBe("新标题");
    expect(updated?.tags).toEqual(["y", "z"]);
    expect(await updateMemory("不存在", { title: "x" })).toBeNull();
    expect(await deleteMemory(entry.id)).toBe(true);
    expect(await deleteMemory(entry.id)).toBe(false);
    expect(await listMemories()).toHaveLength(0);
  });

  it("并发写不丢条目(读-改-写串行化)", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, index) => addMemory({ title: `t-${index}`, body: `b-${index}` })));
    expect(await listMemories()).toHaveLength(25);
  });
});
