import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSidebarLayout, useSessionsStore } from "../sessions-store";

const KEY = "openbuddy.sidebar-layout.v1";
const DEFAULT = { pinnedOpen: true, tasksOpen: true, spacesOpen: true, expanded: {} };

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  useSessionsStore.setState({
    pinnedOpen: true,
    tasksOpen: true,
    spacesOpen: true,
    expanded: {},
  });
});

describe("侧栏分区折叠状态持久化", () => {
  it("解析版本化布局，拒绝损坏数据与未知版本", () => {
    expect(parseSidebarLayout(null)).toEqual(DEFAULT);
    expect(parseSidebarLayout("not json")).toEqual(DEFAULT);
    expect(parseSidebarLayout(JSON.stringify({ version: 2, tasksOpen: false }))).toEqual(DEFAULT);
    expect(
      parseSidebarLayout(
        JSON.stringify({
          version: 1,
          tasksOpen: false,
          spacesOpen: true,
          expanded: { "/work/a": true, "/work/b": "yes", "/work/c": false },
        })
      )
    ).toEqual({
      pinnedOpen: true,
      tasksOpen: false,
      spacesOpen: true,
      expanded: { "/work/a": true, "/work/c": false },
    });
  });

  it("任务/空间分组与工作空间节点折叠后写入 localStorage", () => {
    useSessionsStore.getState().setTasksOpen(false);
    useSessionsStore.getState().setSpacesOpen(false);
    useSessionsStore.getState().setExpanded("/work/openbuddy", true);

    expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual({
      version: 1,
      pinnedOpen: true,
      tasksOpen: false,
      spacesOpen: false,
      expanded: { "/work/openbuddy": true },
    });
  });

  it("刷新后从 localStorage 恢复分区状态", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        pinnedOpen: false,
        tasksOpen: false,
        spacesOpen: true,
        expanded: { "/work/restored": true },
      })
    );

    const fresh = await import("../sessions-store");
    const state = fresh.useSessionsStore.getState();
    expect(state.pinnedOpen).toBe(false);
    expect(state.tasksOpen).toBe(false);
    expect(state.spacesOpen).toBe(true);
    expect(state.expanded).toEqual({ "/work/restored": true });
  });

  it("损坏的本地数据回退到默认展开状态", async () => {
    localStorage.setItem(KEY, "{broken");
    const fresh = await import("../sessions-store");
    expect(fresh.useSessionsStore.getState()).toMatchObject(DEFAULT);
  });

  it("最多保留 100 个工作空间节点，避免 localStorage 无限增长", () => {
    for (let i = 0; i < 105; i++) {
      useSessionsStore.getState().setExpanded(`/work/${i}`, true);
    }
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(Object.keys(saved.expanded)).toHaveLength(100);
    expect(Object.keys(useSessionsStore.getState().expanded)).toHaveLength(100);
    expect(Object.keys(saved.expanded)).not.toContain("/work/4");
    expect(Object.keys(saved.expanded)).toContain("/work/104");
  });

  it("其他窗口修改布局时同步到当前 store", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, pinnedOpen: false, tasksOpen: false, spacesOpen: false, expanded: { "/other": true } })
    );
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    expect(useSessionsStore.getState()).toMatchObject({
      pinnedOpen: false,
      tasksOpen: false,
      spacesOpen: false,
      expanded: { "/other": true },
    });
  });
});
