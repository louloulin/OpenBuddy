// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sessionModule } from "./session";
import type { HostContext } from "../module";
import type { WorkspaceInfo } from "@openbuddy/client/api/session";

/**
 * 工作空间列表 (fix: 默认空间的交付目标).
 *
 * 自动化在界面上把「工作空间」做成可选：留空 = 默认空间。宿主因此必须
 * 始终把默认空间列出来（哪怕还没有会话），并用 `isHome` 标出来，
 * 这样界面才能把任务卡片上的内部目录名显示成「默认空间」。
 */
function context(engine: unknown) {
  return { options: {}, settings: {}, emit: () => {}, engine } as unknown as HostContext;
}

const engine = {
  inbox: "/default/space",
  all: async () => [
    { cwd: "/ws", name: "写周报" },
    { cwd: "/ws", name: "写日报" },
    { cwd: "/other", firstMessage: " hello " },
  ],
};

describe("session module · 工作空间列表", () => {
  it("默认空间永远在列表里，并被标成 isHome", async () => {
    const { commands } = sessionModule(context(engine));
    const list = (await commands.agent_list_workspaces({})) as WorkspaceInfo[];
    const home = list.find((w) => w.cwd === "/default/space");
    expect(home).toMatchObject({ cwd: "/default/space", sessionCount: 0, isHome: true });
    expect(list.find((w) => w.cwd === "/ws")).toMatchObject({ sessionCount: 2 });
    expect(list.find((w) => w.cwd === "/other")?.isHome).toBeUndefined();
  });

  it("默认空间已有会话时保留会话数", async () => {
    const { commands } = sessionModule(
      context({ ...engine, all: async () => [{ cwd: "/default/space", name: "默认空间的会话" }] }),
    );
    const list = (await commands.agent_list_workspaces({})) as WorkspaceInfo[];
    expect(list.find((w) => w.cwd === "/default/space")).toMatchObject({
      sessionCount: 1,
      isHome: true,
    });
  });
});
