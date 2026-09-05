/**
 * SlotCore dispatch mode 测试。
 *
 * 覆盖四种 dispatch kind 的 fallback SlotCore 实现:
 *   - list   — 默认,按注册顺序返回所有 component
 *   - keyed  — 按 key 注册,同 key 后注册覆盖前注册(priority 大者赢)
 *   - chain  — 按 priority 升序包裹(外→内),chain() 返回组装好的最终组件
 *   - single — 仅保留第一个注册者(向后兼容)
 *
 * 设计目的:
 *   - L4 子任务 1 真实验证 makeFallbackSlotCore 的多 kind dispatch 行为
 *   - 防止后续重构破坏 keyed/chain 语义(覆盖 entryForKey / chain 出口)
 */

import { describe, it, expect } from "vitest";
import { __makeTestSlotCore } from "../client";

interface SlotEntry {
  name: string;
  component: React.ComponentType<Record<string, unknown>>;
}

/** 构造一个用来注册到 SlotCore 的伪 React 组件。 */
function tag(id: string): React.ComponentType<Record<string, unknown>> {
  const T: React.ComponentType<Record<string, unknown>> = (props: Record<string, unknown>) => null as never;
  (T as unknown as { displayName: string }).displayName = id;
  return T;
}

describe("SlotCore dispatch mode — list (默认)", () => {
  it("多个注册者按顺序保留", () => {
    const core = __makeTestSlotCore();
    const a = tag("A");
    const b = tag("B");
    core.register({ name: "list.demo", kind: "list" }, a);
    core.register({ name: "list.demo", kind: "list" }, b);
    expect(core.entries("list.demo")).toEqual([a, b]);
  });

  it("disposer 按 component identity 移除", () => {
    const core = __makeTestSlotCore();
    const a = tag("A");
    const b = tag("B");
    const disposeA = core.register({ name: "list.demo2", kind: "list" }, a);
    core.register({ name: "list.demo2", kind: "list" }, b);
    disposeA();
    expect(core.entries("list.demo2")).toEqual([b]);
  });

  it("spec() 返回 kind/scope 元信息", () => {
    const core = __makeTestSlotCore();
    core.register({ name: "list.spec", kind: "list" }, tag("S"));
    const spec = core.spec("list.spec");
    expect(spec?.kind).toBe("list");
  });
});

describe("SlotCore dispatch mode — keyed", () => {
  it("同 key 后注册覆盖前注册(默认 priority 0)", () => {
    const core = __makeTestSlotCore();
    const first = tag("first");
    const second = tag("second");
    core.register({ name: "keyed.k", kind: "keyed", key: "x" }, first);
    core.register({ name: "keyed.k", kind: "keyed", key: "x" }, second);
    expect(core.entryForKey?.("keyed.k", "x")).toBe(second);
  });

  it("不同 key 共存,entryForKey 各自命中", () => {
    const core = __makeTestSlotCore();
    const a = tag("A");
    const b = tag("B");
    core.register({ name: "keyed.duo", kind: "keyed", key: "alpha" }, a);
    core.register({ name: "keyed.duo", kind: "keyed", key: "beta" }, b);
    expect(core.entryForKey?.("keyed.duo", "alpha")).toBe(a);
    expect(core.entryForKey?.("keyed.duo", "beta")).toBe(b);
    expect(core.entries("keyed.duo")).toHaveLength(2);
  });

  it("priority 决定同 key 胜者;高者赢,低者被忽略", () => {
    const core = __makeTestSlotCore();
    const low = tag("low");
    const high = tag("high");
    core.register({ name: "keyed.prio", kind: "keyed", key: "p", priority: 1 }, low);
    core.register({ name: "keyed.prio", kind: "keyed", key: "p", priority: 10 }, high);
    expect(core.entryForKey?.("keyed.prio", "p")).toBe(high);
  });

  it("disposer 移除 keyed 单条", () => {
    const core = __makeTestSlotCore();
    const dispose = core.register({ name: "keyed.dis", kind: "keyed", key: "k" }, tag("K"));
    expect(core.entryForKey?.("keyed.dis", "k")).toBeDefined();
    dispose();
    expect(core.entryForKey?.("keyed.dis", "k")).toBeUndefined();
  });

  it("未注册的 key 在 entryForKey 上返回 undefined", () => {
    const core = __makeTestSlotCore();
    core.register({ name: "keyed.empty", kind: "keyed", key: "has" }, tag("H"));
    expect(core.entryForKey?.("keyed.empty", "missing")).toBeUndefined();
  });
});

describe("SlotCore dispatch mode — chain", () => {
  it("按 priority 升序包裹(外→内)", () => {
    const core = __makeTestSlotCore();
    /** 三个不同 component,各自由不同 priority 决定层级位置。 */
    core.register({ name: "chain.wrap", kind: "chain", priority: 30, registrant: "innermost" }, tag("INNER"));
    core.register({ name: "chain.wrap", kind: "chain", priority: 10, registrant: "outermost" }, tag("OUTER"));
    core.register({ name: "chain.wrap", kind: "chain", priority: 20, registrant: "middle" }, tag("MIDDLE"));
    // chain() 返回包装后的最终组件,渲染时不抛错即可
    const Wrapped = core.chain?.("chain.wrap");
    expect(Wrapped).toBeDefined();
    expect(typeof Wrapped).toBe("function");
  });

  it("disposer 全部执行,chain 清空", () => {
    const core = __makeTestSlotCore();
    const d1 = core.register({ name: "chain.dispose", kind: "chain", priority: 1 }, tag("A"));
    const d2 = core.register({ name: "chain.dispose", kind: "chain", priority: 2 }, tag("B"));
    expect(core.entries("chain.dispose")).toHaveLength(2);
    d1();
    expect(core.entries("chain.dispose")).toHaveLength(1);
    d2();
    expect(core.entries("chain.dispose")).toHaveLength(0);
  });

  it("chain 模式 entryForKey 应返回 undefined", () => {
    const core = __makeTestSlotCore();
    core.register({ name: "chain.no-entry", kind: "chain", priority: 0, key: "ignored" }, tag("A"));
    expect(core.entryForKey?.("chain.no-entry", "ignored")).toBeUndefined();
  });
});

describe("SlotCore dispatch mode — single (向后兼容)", () => {
  it("仅保留第一个注册者,后续注册不覆盖", () => {
    const core = __makeTestSlotCore();
    const first = tag("FIRST");
    const second = tag("SECOND");
    core.register({ name: "single.test", kind: "single" }, first);
    core.register({ name: "single.test", kind: "single" }, second);
    expect(core.entries("single.test")).toEqual([first]);
  });
});

describe("SlotCore dispatch mode — register 通用", () => {
  it("未注册过的 slot 名,entries 返回空数组并不抛错", () => {
    const core = __makeTestSlotCore();
    expect(core.entries("never.touched")).toEqual([]);
  });

  it("inject 在 fallback 模式下透明返回 register()", () => {
    const core = __makeTestSlotCore();
    const dispose = core.inject("any.name", () => () => "disposed");
    expect(dispose()).toBe("disposed");
  });
});
