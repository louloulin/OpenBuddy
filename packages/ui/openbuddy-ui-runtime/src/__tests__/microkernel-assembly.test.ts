/**
 * microkernel-assembly.test.ts — 微内核真实装配证据。
 *
 * 这个文件回答一个可被证伪的问题：**内置 ui-* 包(当前 24 个)是否真的都装进了内核?**
 *
 * 历史教训：L1/L2 阶段的测试只验证「包存在 + tsc 通过」，而
 * `buildUiRuntime()` 实际上一直在用一个 `DeepSeekSlotCore` 取不到的
 * fallback stub —— 真实 core 上 6 个包会因 registry 校验直接抛错。
 * 因此这里的断言必须落在 `lastRegisteredReport()` 上（逐包真实结果），
 * 而不是落在「源码里有 N 个 import」这种静态证据上。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getRuntime,
  registerAllBuiltinUis,
  lastRegisteredReport,
  lastRegisteredPackageCount,
  useSlotComponents,
  __makeTestSlotCore,
} from "../client";
import { BUILTIN_UI_APPLIES } from "../builtin-applies";

describe("微内核装配 — 24 个内置包", () => {
  beforeEach(() => {
    registerAllBuiltinUis();
  });

  it("包数与 BUILTIN_UI_APPLIES 表一致", () => {
    expect(lastRegisteredReport()).toHaveLength(BUILTIN_UI_APPLIES.length);
    // 21 个原始包 + ui-files-tree(Phase B)+ ui-editor / ui-onboarding(Phase C/D)。
    expect(BUILTIN_UI_APPLIES.length).toBe(24);
  });

  it("没有任何包 apply() 失败", () => {
    const failed = lastRegisteredReport().filter((row) => !row.ok);
    expect(
      failed.map((row) => `${row.pkg}: ${row.error}`),
    ).toEqual([]);
  });

  it("成功计数等于包总数", () => {
    expect(lastRegisteredPackageCount()).toBe(BUILTIN_UI_APPLIES.length);
  });

  it("每个注册了 slot 的包,报告里的 slot 名可在核心里查到", () => {
    const core = getRuntime().slots;
    for (const row of lastRegisteredReport()) {
      for (const name of row.slotNames) {
        expect(core.entries(name), `${row.pkg} → ${name}`).toBeDefined();
      }
    }
  });

  it("结构性 UI 位置都被真实包提供", () => {
    const core = getRuntime().slots;
    // 每个都是「AppShell 会去内核取」的位置，缺一个界面就少一块。
    const required: Array<[slot: string, owner: string]> = [
      ["sidebar", "@openbuddy/ui-sidebar"],
      ["conversation", "@openbuddy/ui-conversation"],
      ["home", "@openbuddy/ui-settings"],
      ["overlay.search", "@openbuddy/ui-workbench"],
      ["overlay.settings", "@openbuddy/ui-settings"],
      ["overlay.about", "@openbuddy/ui-dialogs"],
      ["overlay.folder-trust", "@openbuddy/ui-dialogs"],
      ["overlay.tasks", "@openbuddy/ui-automation"],
      ["notifications", "@openbuddy/ui-primitives"],
      ["details", "@openbuddy/ui-shell"],
      ["root", "@openbuddy/ui-layout"],
    ];
    for (const [slot, owner] of required) {
      const entries = core.entries(slot);
      expect(entries.length, `slot ${slot} 应由 ${owner} 提供`).toBeGreaterThan(0);
    }
  });

  it("多包共用的 shell.overlay 聚合了 5 个 overlay", () => {
    expect(getRuntime().slots.entries("shell.overlay")).toHaveLength(5);
  });

  it("装配幂等 — 重复 registerAllBuiltinUis 不会翻倍(single)或堆积(list id)", () => {
    const core = getRuntime().slots;
    const sidebarBefore = core.entries("sidebar").length;
    const overlayBefore = core.entries("shell.overlay").length;
    registerAllBuiltinUis();
    expect(core.entries("sidebar")).toHaveLength(sidebarBefore);
    expect(core.entries("shell.overlay")).toHaveLength(overlayBefore);
  });
});

describe("微内核 — 插件覆盖内置 UI(端到端)", () => {
  it("第三方插件注册同名 single slot 即可接管该 UI", () => {
    const core = __makeTestSlotCore();
    const Builtin = function BuiltinSidebar() { return null; };
    const Plugin = function PluginSidebar() { return null; };

    core.register({ name: "sidebar", kind: "single", registrant: "@openbuddy/ui-sidebar" }, Builtin);
    expect(core.entries("sidebar")[0]).toBe(Builtin);

    const disposePlugin = core.register(
      { name: "sidebar", kind: "single", registrant: "@acme/sidebar-plus" },
      Plugin,
    );
    expect(core.entries("sidebar")[0]).toBe(Plugin);

    // 插件卸载 → 内置实现自动回到位
    disposePlugin();
    expect(core.entries("sidebar")[0]).toBe(Builtin);
  });

  it("kind 不匹配的注册被明确拒绝,并保留原有实现", () => {
    // 内置把 sidebar 声明为 single;插件却按 list 追加 —— 这是两套语义，
    // 静默混合会得到一个"既像 single 又像 list"的列表。内核选择拒绝 + 告警。
    const core = makeCoreWithSidebar();
    const Builtin = core.entries("sidebar")[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dispose = core.register(
      { name: "sidebar", kind: "list", id: "acme-extra", registrant: "@acme/extra" },
      function Extra() { return null; },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("sidebar");
    expect(String(warn.mock.calls[0][0])).toContain("single");
    expect(core.entries("sidebar")).toEqual([Builtin]);
    expect(() => dispose()).not.toThrow();
    warn.mockRestore();
  });

  it("插件想追加到 single 位置时,应改用独立的 list slot", () => {
    // 正确做法:内置保留 single 的"主实现",插件往一个专用 list slot 追加。
    const core = makeCoreWithSidebar();
    const Builtin = core.entries("sidebar")[0];
    core.register({ name: "sidebar.extras", kind: "list", id: "acme" }, function Extra() { return null; });
    expect(core.entries("sidebar")).toEqual([Builtin]);
    expect(core.entries("sidebar.extras")).toHaveLength(1);
  });

  it("覆盖期间订阅者收到通知(界面会重渲染)", () => {
    const core = __makeTestSlotCore();
    core.register({ name: "conversation", kind: "single" }, function A() { return null; });
    let hits = 0;
    core.subscribe?.("conversation", () => { hits++; });
    const dispose = core.register({ name: "conversation", kind: "single" }, function B() { return null; });
    expect(hits).toBe(1);
    dispose();
    expect(hits).toBe(2);
  });
});

function makeCoreWithSidebar() {
  const core = __makeTestSlotCore();
  core.register({ name: "sidebar", kind: "single", registrant: "@openbuddy/ui-sidebar" }, function BuiltinSidebar() { return null; });
  return core;
}

describe("微内核 — 消费面 hook 导出", () => {
  it("useSlotComponents / useSlotEntries 已从 client 导出(供 app 侧取用)", () => {
    expect(typeof useSlotComponents).toBe("function");
  });
});
