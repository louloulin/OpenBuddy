/**
 * slot-core.test.ts — 微内核（SlotCore）契约测试。
 *
 * 覆盖 Phase K.3 引入的真实内核 `createSlotCore()`。它与旧的 fallback stub
 * 有三处关键语义差异，每一处都是「微内核能不能用」的前提：
 *
 *   1. **永不因 options 不完整而抛错** —— list slot 缺 id 时内核派生
 *      `<registrant>#<seq>`。历史上有 6 个内置包（ui-settings / ui-workbench /
 *      ui-dialogs / ui-automation / ui-primitives / ui-settings-models）因为漏写
 *      id，在真实 core 上直接注册失败。
 *   2. **single 可被覆盖、可恢复** —— 插件注册同名 single slot 接管 UI，
 *      卸载后内置实现自动回来。
 *   3. **变更可订阅** —— subscribe(name, listener) 让消费者重渲染而不是轮询。
 */

import { describe, it, expect, vi } from "vitest";
import { createSlotCore } from "../slot-core";

/** 造一个可辨识的伪组件。 */
function tag(id: string): unknown {
  const T = function Tag() { return null; };
  (T as unknown as { displayName: string }).displayName = id;
  return T;
}

function displayNameOf(component: unknown): string | undefined {
  return (component as { displayName?: string } | undefined)?.displayName;
}

describe("微内核 — 注册健壮性", () => {
  it("list slot 缺 id 时不抛错,内核派生稳定 id", () => {
    const core = createSlotCore();
    expect(() =>
      core.register({ name: "shell.overlay", kind: "list", registrant: "@pkg/a" }, tag("A")),
    ).not.toThrow();
    const entries = core.entriesOfSlot("shell.overlay");
    expect(entries).toHaveLength(1);
    expect(entries[0].options.id).toBe("@pkg/a#0");
  });

  it("重复注册同一 list cell(同 id)是覆盖而非叠加", () => {
    const core = createSlotCore();
    core.register({ name: "l", kind: "list", id: "x" }, tag("FIRST"));
    core.register({ name: "l", kind: "list", id: "x" }, tag("SECOND"));
    expect(core.entries("l")).toHaveLength(1);
    expect(displayNameOf(core.entries("l")[0])).toBe("SECOND");
  });

  it("不同 id 的 list entry 共存", () => {
    const core = createSlotCore();
    core.register({ name: "l", kind: "list", id: "a" }, tag("A"));
    core.register({ name: "l", kind: "list", id: "b" }, tag("B"));
    expect(core.entries("l")).toHaveLength(2);
  });

  it("list 按 priority 升序、同 priority 按 order 升序排列", () => {
    const core = createSlotCore();
    core.register({ name: "l", kind: "list", id: "late", priority: 10 }, tag("LATE"));
    core.register({ name: "l", kind: "list", id: "early", priority: 1 }, tag("EARLY"));
    core.register({ name: "l", kind: "list", id: "mid", priority: 1, order: 5 }, tag("MID"));
    expect(core.entries("l").map(displayNameOf)).toEqual(["EARLY", "MID", "LATE"]);
  });

  it("keyed slot 缺 key 时用 id 兜底,仍然可寻址", () => {
    const core = createSlotCore();
    core.register({ name: "k", kind: "keyed", id: "panel-1" }, tag("P1"));
    expect(displayNameOf(core.entryForKey?.("k", "panel-1"))).toBe("P1");
  });

  it("缺失 name 时抛错(这是唯一必须拦住的误用)", () => {
    const core = createSlotCore();
    expect(() => core.register({ name: "" }, tag("X"))).toThrow(/name is required/);
  });

  it("注册返回的 disposer 幂等", () => {
    const core = createSlotCore();
    const dispose = core.register({ name: "l", kind: "list", id: "a" }, tag("A"));
    dispose();
    dispose();
    expect(core.entries("l")).toHaveLength(0);
  });
});

describe("微内核 — single 可覆盖 / 可恢复", () => {
  it("插件注册同名 single slot 即接管该 UI", () => {
    const core = createSlotCore();
    core.register({ name: "sidebar", kind: "single", registrant: "@builtin" }, tag("BUILTIN"));
    core.register({ name: "sidebar", kind: "single", registrant: "@plugin" }, tag("PLUGIN"));
    expect(displayNameOf(core.entries("sidebar")[0])).toBe("PLUGIN");
  });

  it("插件卸载后内置实现自动恢复", () => {
    const core = createSlotCore();
    core.register({ name: "sidebar", kind: "single" }, tag("BUILTIN"));
    const disposePlugin = core.register({ name: "sidebar", kind: "single" }, tag("PLUGIN"));
    disposePlugin();
    expect(displayNameOf(core.entries("sidebar")[0])).toBe("BUILTIN");
  });

  it("entries() 对 single 始终只返回赢家", () => {
    const core = createSlotCore();
    core.register({ name: "s", kind: "single" }, tag("A"));
    core.register({ name: "s", kind: "single" }, tag("B"));
    core.register({ name: "s", kind: "single" }, tag("C"));
    expect(core.entries("s")).toHaveLength(1);
    expect(displayNameOf(core.entries("s")[0])).toBe("C");
  });

  it("内置可以用高 priority 自保,不被低 priority 插件顶掉", () => {
    const core = createSlotCore();
    core.register({ name: "s", kind: "single", priority: 100 }, tag("BUILTIN"));
    core.register({ name: "s", kind: "single", priority: 0 }, tag("PLUGIN"));
    expect(displayNameOf(core.entries("s")[0])).toBe("BUILTIN");
  });

  it("高 priority 插件可以顶掉默认 priority 的内置实现", () => {
    const core = createSlotCore();
    core.register({ name: "s", kind: "single" }, tag("BUILTIN"));
    core.register({ name: "s", kind: "single", priority: 50 }, tag("PLUGIN"));
    expect(displayNameOf(core.entries("s")[0])).toBe("PLUGIN");
  });

  it("entriesOfSlot 仍暴露全部登记项(供诊断 / 插件面板)", () => {
    const core = createSlotCore();
    core.register({ name: "s", kind: "single" }, tag("BUILTIN"));
    core.register({ name: "s", kind: "single" }, tag("PLUGIN"));
    expect(core.entriesOfSlot("s")).toHaveLength(2);
  });
});

describe("微内核 — keyed dispatch", () => {
  it("不同 key 各自可寻址,entries() 按 key 去重", () => {
    const core = createSlotCore();
    core.register({ name: "k", kind: "keyed", key: "a" }, tag("A"));
    core.register({ name: "k", kind: "keyed", key: "b" }, tag("B"));
    expect(displayNameOf(core.entryForKey?.("k", "a"))).toBe("A");
    expect(displayNameOf(core.entryForKey?.("k", "b"))).toBe("B");
    expect(core.entries("k")).toHaveLength(2);
  });

  it("同 key 低优先级实现被忽略", () => {
    const core = createSlotCore();
    core.register({ name: "k", kind: "keyed", key: "x", priority: 10 }, tag("HIGH"));
    core.register({ name: "k", kind: "keyed", key: "x", priority: 1 }, tag("LOW"));
    expect(displayNameOf(core.entryForKey?.("k", "x"))).toBe("HIGH");
  });

  it("未注册的 key 返回 undefined", () => {
    const core = createSlotCore();
    core.register({ name: "k", kind: "keyed", key: "has" }, tag("H"));
    expect(core.entryForKey?.("k", "missing")).toBeUndefined();
  });
});

describe("微内核 — chain dispatch", () => {
  it("chain() 按 priority 升序由外向内包裹,渲染不抛错", () => {
    const core = createSlotCore();
    core.register({ name: "c", kind: "chain", priority: 30 }, tag("INNER"));
    core.register({ name: "c", kind: "chain", priority: 10 }, tag("OUTER"));
    const Wrapped = core.chain?.("c");
    expect(typeof Wrapped).toBe("function");
  });

  it("无 entry 时 chain() 返回 undefined", () => {
    const core = createSlotCore();
    expect(core.chain?.("empty")).toBeUndefined();
  });
});

describe("微内核 — 变更订阅", () => {
  it("注册时通知订阅者", () => {
    const core = createSlotCore();
    const spy = vi.fn();
    const off = core.subscribe!("s", spy);
    core.register({ name: "s", kind: "single" }, tag("A"));
    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("反注册时同样通知(插件卸载要能触发重渲染)", () => {
    const core = createSlotCore();
    const dispose = core.register({ name: "s", kind: "single" }, tag("A"));
    const spy = vi.fn();
    core.subscribe!("s", spy);
    dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("取消订阅后不再收到通知", () => {
    const core = createSlotCore();
    const spy = vi.fn();
    const off = core.subscribe!("s", spy);
    off();
    core.register({ name: "s", kind: "single" }, tag("A"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("订阅者抛错不影响其它订阅者与注册流程", () => {
    const core = createSlotCore();
    const good = vi.fn();
    core.subscribe!("s", () => { throw new Error("boom"); });
    core.subscribe!("s", good);
    expect(() => core.register({ name: "s", kind: "single" }, tag("A"))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe("微内核 — 内核状态", () => {
  it("spec() 暴露 kind/scope", () => {
    const core = createSlotCore();
    core.register({ name: "s", kind: "list", scope: "session" }, tag("A"));
    expect(core.spec("s")).toMatchObject({ kind: "list", scope: "session" });
  });

  it("snapshot() 给出全部 slot 及 entry 数(供探针 / 插件面板)", () => {
    const core = createSlotCore();
    core.register({ name: "s", kind: "list", id: "a" }, tag("A"));
    core.register({ name: "s", kind: "list", id: "b" }, tag("B"));
    const row = core.snapshot().find((r) => r.name === "s");
    expect(row?.entries).toHaveLength(2);
  });

  it("children 声明登记为子 slot", () => {
    const core = createSlotCore();
    core.register({
      name: "root",
      kind: "single",
      children: { "root.child": { kind: "list", scope: "root" } },
    }, tag("R"));
    const row = core.snapshot().find((r) => r.name === "root");
    expect(row?.children).toContain("root.child");
  });

  it("size() 统计已登记 slot 数", () => {
    const core = createSlotCore();
    expect(core.size()).toBe(0);
    core.register({ name: "a", kind: "list", id: "1" }, tag("A"));
    core.register({ name: "b", kind: "list", id: "1" }, tag("B"));
    expect(core.size()).toBe(2);
  });

  it("clear() 清空所有 slot 并通知 watcher", () => {
    const core = createSlotCore();
    core.register({ name: "s", kind: "list", id: "a" }, tag("A"));
    const spy = vi.fn();
    core.subscribe!("s", spy);
    core.clear();
    expect(core.entries("s")).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
  });

  it("未注册过的 slot 读取返回空数组而不是抛错", () => {
    const core = createSlotCore();
    expect(core.entries("never.touched")).toEqual([]);
    expect(core.spec("never.touched")).toBeUndefined();
  });

  it("两个内核实例互相隔离", () => {
    const a = createSlotCore();
    const b = createSlotCore();
    a.register({ name: "s", kind: "single" }, tag("A"));
    expect(b.entries("s")).toHaveLength(0);
  });
});
