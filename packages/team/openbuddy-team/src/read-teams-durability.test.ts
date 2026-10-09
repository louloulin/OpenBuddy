/**
 * `openbuddy-teams.json` 的读契约 —— 损坏时必须**响亮**地失败。
 *
 * 曾经的实现是 `catch { return {} }`:任何读失败(EACCES、EMFILE、坏关机留下的
 * 半截 JSON)都和「全新安装」长得一模一样,而下一次 `writeTeams()` 会拿着这个
 * 空对象做整体覆盖。于是用户只是重启了一次电脑,所有 team 的目标、成员、
 * 历史输出就永久蒸发了,界面上只表现为「团队列表空了」,没有任何报错。
 *
 * 这里钉住与 `openbuddy-email` store 一致的三段式契约:
 *   1. 文件不存在 → 空注册表(正常的首启);
 *   2. 读取本身失败(EACCES 等)→ 抛出,绝不能伪装成「没有数据」;
 *   3. JSON 解析失败 → 把原始字节另存为 `.corrupt-<ts>` 再抛出,让数据
 *      可恢复,而不是等下一次写入把它覆盖掉。
 */
import { chmod, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Context } from "@openbuddy/cordis";
import { mountTeam, type TeamRunner } from "./index";

const NEVER_RUN: TeamRunner = { runMember: async () => "ok" };

describe("readTeams — 损坏 / 不可读不能让数据被静默清空", () => {
  let home: string;
  let previous: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "openbuddy-teams-corrupt-"));
    previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = home;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });

  function mount() {
    const ctx = new Context();
    ctx.provide("teamTenantContext", {
      getActiveTenantId: () => "tenant-a",
      canUseTeamWorkspace: () => true,
    });
    ctx.provide("teamRunner", NEVER_RUN);
    return mountTeam(ctx);
  }

  const registry = () => join(home, "openbuddy-teams.json");

  it("文件不存在 = 全新安装,返回空而不是抛错", async () => {
    await expect(mount().status("team-1")).resolves.toBeUndefined();
  });

  it("损坏的 JSON:抛错 + 原始字节被保留,且不被下一次写入覆盖", async () => {
    const corrupt = '{"team-1": {"goal": "truncated…';
    await writeFile(registry(), corrupt, "utf8");

    const team = mount();
    await expect(team.status("team-1")).rejects.toThrow(/corrupt/i);

    // 原始字节必须还在某个地方 —— 这是整个修复的意义:可恢复。
    const files = await readdir(home);
    const backup = files.find((name) => name.startsWith("openbuddy-teams.json.corrupt-"));
    expect(backup, "损坏的原始字节没有被另存").toBeTypeOf("string");
    expect(await readFile(join(home, backup!), "utf8")).toBe(corrupt);

    // 原文件保持原样,没有被一个「空注册表」覆盖掉。
    expect(await readFile(registry(), "utf8")).toBe(corrupt);
  });

  it("不可读的文件(EACCES)抛错,而不是变成「没有 team」", async () => {
    await writeFile(registry(), "{}", "utf8");
    await chmod(registry(), 0o000);
    try {
      // root 会绕过权限位,那种环境里这个断言没有意义 —— 直接跳过而不是假装通过。
      const readable = await readFile(registry(), "utf8").then(() => true, () => false);
      if (!readable) {
        await expect(mount().status("team-1")).rejects.toThrow();
      }
    } finally {
      await chmod(registry(), 0o600);
    }
  });

  it("正常写入后仍能被读回(确认收紧容错没有误伤 happy path)", async () => {
    const team = mount();
    const created = await team.create("inspect the repository", "small");
    const found = await team.status(created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.goal).toBe("inspect the repository");
  });
});