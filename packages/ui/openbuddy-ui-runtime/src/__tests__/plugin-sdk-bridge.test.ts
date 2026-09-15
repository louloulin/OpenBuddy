/**
 * plugin-sdk-bridge.test.ts — `@openbuddy/plugin-sdk` → 微内核 的接线验证。
 *
 * 背景：SDK 的 `defineExtension()` 只派发 DOM CustomEvent
 * (`openbuddy:register-slot` 等)。Phase K.3 之前**没有任何监听者**，
 * 于是三个示例插件（hello / toolbar / slash）跑完 setup() 等于什么都没发生。
 *
 * 本测试用一个假的 EventTarget 替代 window，断言：
 *   - 事件被接进内核（entries 真的多出来）
 *   - payload 可被 useSlotPayloads 的读取路径拿到
 *   - unregister 后 entry 归还
 *   - 重复 register 同 id 幂等
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installPluginSdkBridge, getRuntime, registerAllBuiltinUis } from "../client";
import { createSlotCore } from "../slot-core";

/** 造一个最小 EventTarget 作为 window 替身。 */
function makeFakeTarget() {
  return new EventTarget() as unknown as Window & typeof globalThis;
}

function fire(target: Window, type: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

describe("plugin-sdk 桥接", () => {
  let target: Window & typeof globalThis;
  let dispose: () => void;
  let core: ReturnType<typeof createSlotCore>;

  beforeEach(() => {
    registerAllBuiltinUis();
    core = getRuntime().slots as ReturnType<typeof createSlotCore>;
    target = makeFakeTarget();
    dispose = installPluginSdkBridge({ target });
  });

  afterEach(() => {
    // 桥的 disposer 会把插件注册进来的 entry 全部归还给内核，
    // 因此这里不需要再手工清理 —— 反过来也是这条契约的隐式断言。
    dispose();
    vi.restoreAllMocks();
  });

  it("register-slot 事件把 entry 注册进内核", () => {
    const before = core.entriesOfSlot("home.scene.tab").length;
    fire(target, "openbuddy:register-slot", {
      name: "home.scene.tab",
      kind: "list",
      scope: "root",
      payload: { id: "meeting-minutes", label: "会议纪要" },
    });
    const entries = core.entriesOfSlot("home.scene.tab");
    expect(entries).toHaveLength(before + 1);
    const added = entries[entries.length - 1];
    expect(added.registrant).toBe("@openbuddy/plugin-sdk");
    expect((added.options.payload as { id: string }).id).toBe("meeting-minutes");
  });

  it("未带 name 的事件被忽略(不抛错)", () => {
    expect(() => fire(target, "openbuddy:register-slot", { kind: "list" })).not.toThrow();
  });

  it("unregister-slot 撤掉该 slot 下所有插件 entry", () => {
    fire(target, "openbuddy:register-slot", {
      name: "home.scene.tab", kind: "list", scope: "root",
      payload: { id: "a", label: "A" },
    });
    fire(target, "openbuddy:register-slot", {
      name: "home.scene.tab", kind: "list", scope: "root",
      payload: { id: "b", label: "B" },
    });
    const withPlugin = core.entriesOfSlot("home.scene.tab").filter((e) => e.registrant === "@openbuddy/plugin-sdk");
    expect(withPlugin).toHaveLength(2);

    fire(target, "openbuddy:unregister-slot", { name: "home.scene.tab" });
    const remaining = core.entriesOfSlot("home.scene.tab").filter((e) => e.registrant === "@openbuddy/plugin-sdk");
    expect(remaining).toHaveLength(0);
  });

  it("同 id 重复注册是幂等的(插件重复 setup 不叠加)", () => {
    const payload = { id: "dup", label: "Dup" };
    fire(target, "openbuddy:register-slot", { name: "home.scene.tab", kind: "list", scope: "root", payload });
    const first = core.entriesOfSlot("home.scene.tab").length;
    fire(target, "openbuddy:register-slot", { name: "home.scene.tab", kind: "list", scope: "root", payload });
    expect(core.entriesOfSlot("home.scene.tab")).toHaveLength(first);
  });

  it("register-command 进 plugin.command slot", () => {
    const before = core.entriesOfSlot("plugin.command").length;
    fire(target, "openbuddy:register-command", { id: "greet", label: "/greet", onExecute: () => {} });
    expect(core.entriesOfSlot("plugin.command")).toHaveLength(before + 1);
  });

  it("内核变更会通知该 slot 的订阅者(界面能重渲染)", () => {
    let hits = 0;
    const off = core.subscribe?.("home.scene.tab", () => { hits++; });
    fire(target, "openbuddy:register-slot", {
      name: "home.scene.tab", kind: "list", scope: "root", payload: { id: "x", label: "X" },
    });
    off?.();
    expect(hits).toBeGreaterThan(0);
  });

  it("session scope 的事件按 session 记录", () => {
    fire(target, "openbuddy:register-slot", {
      name: "composer.toolbar.action", kind: "list", scope: "session",
      payload: { id: "insert-timestamp", label: "插入时间戳" },
    });
    const entries = core.entriesOfSlot("composer.toolbar.action");
    const added = entries.find((e) => (e.options.payload as { id?: string })?.id === "insert-timestamp");
    expect(added?.options.scope).toBe("session");
  });

  it("dispose() 归还全部插件 entry(不留残留)", () => {
    const beforeScene = core.entriesOfSlot("home.scene.tab").length;
    const beforeCmd = core.entriesOfSlot("plugin.command").length;
    fire(target, "openbuddy:register-slot", {
      name: "home.scene.tab", kind: "list", scope: "root", payload: { id: "x", label: "X" },
    });
    fire(target, "openbuddy:register-command", { id: "greet", label: "/greet", onExecute: () => {} });
    expect(core.entriesOfSlot("home.scene.tab").length).toBe(beforeScene + 1);
    expect(core.entriesOfSlot("plugin.command").length).toBe(beforeCmd + 1);

    dispose();
    expect(core.entriesOfSlot("home.scene.tab")).toHaveLength(beforeScene);
    expect(core.entriesOfSlot("plugin.command")).toHaveLength(beforeCmd);
    // 重新装一个，交给 afterEach 收尾
    dispose = installPluginSdkBridge({ target });
  });

  it("installPluginSdkBridge 幂等 — 重复安装不重复监听", () => {
    const second = installPluginSdkBridge({ target });
    fire(target, "openbuddy:register-slot", {
      name: "home.scene.tab", kind: "list", scope: "root", payload: { id: "once", label: "Once" },
    });
    const matches = core.entriesOfSlot("home.scene.tab").filter(
      (e) => (e.options.payload as { id?: string })?.id === "once",
    );
    expect(matches).toHaveLength(1);
    second();
  });
});
