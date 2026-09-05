import { describe, it, expect } from "vitest";
import {
  nextYieldState,
  createYieldStore,
  requestYield,
  confirmYielded,
  clearYield,
  getYieldState,
  isYielding,
  isYielded,
} from "../ui/yield-state";

describe("nextYieldState", () => {
  it("request: idle → yielding", () => {
    expect(nextYieldState("idle", "request")).toBe("yielding");
  });
  it("request: yielding/yielded 无副作用", () => {
    expect(nextYieldState("yielding", "request")).toBe("yielding");
    expect(nextYieldState("yielded", "request")).toBe("yielded");
  });
  it("confirm: yielding → yielded", () => {
    expect(nextYieldState("yielding", "confirm")).toBe("yielded");
  });
  it("confirm: 非 yielding 无副作用", () => {
    expect(nextYieldState("idle", "confirm")).toBe("idle");
    expect(nextYieldState("yielded", "confirm")).toBe("yielded");
  });
  it("resume/cancel → idle", () => {
    expect(nextYieldState("yielding", "resume")).toBe("idle");
    expect(nextYieldState("yielded", "cancel")).toBe("idle");
    expect(nextYieldState("idle", "resume")).toBe("idle");
  });
});

describe("yield store 操作", () => {
  it("requestYield 标记 yielding", () => {
    const s = requestYield(createYieldStore(), "s1", 100);
    expect(s.s1.state).toBe("yielding");
    expect(s.s1.requestedAt).toBe(100);
  });

  it("confirmYielded 仅在 yielding 时生效", () => {
    let s = requestYield(createYieldStore(), "s1", 100);
    s = confirmYielded(s, "s1", 200);
    expect(s.s1.state).toBe("yielded");
    expect(s.s1.yieldedAt).toBe(200);
    // 非 yielding 状态 confirm 无副作用。
    s = confirmYielded(s, "s1", 300);
    expect(s.s1.state).toBe("yielded");
    expect(s.s1.yieldedAt).toBe(200);
  });

  it("confirmYielded 不存在/非 yielding 的会话无副作用(返回原 store)", () => {
    const s = createYieldStore();
    expect(confirmYielded(s, "nope")).toBe(s);
    const s2 = requestYield(s, "s1");
    const confirmed = confirmYielded(s2, "s1");
    expect(confirmYielded(confirmed, "s1")).toBe(confirmed);
  });

  it("clearYield 移除会话条目", () => {
    let s = requestYield(createYieldStore(), "s1");
    s = clearYield(s, "s1");
    expect(s.s1).toBeUndefined();
  });

  it("clearYield 不存在的会话无副作用(返回原 store)", () => {
    const s = createYieldStore();
    expect(clearYield(s, "nope")).toBe(s);
  });

  it("不同会话隔离", () => {
    let s = createYieldStore();
    s = requestYield(s, "s1");
    s = requestYield(s, "s2");
    s = confirmYielded(s, "s1");
    expect(s.s1.state).toBe("yielded");
    expect(s.s2.state).toBe("yielding");
  });
});

describe("查询 helpers", () => {
  it("getYieldState 默认 idle", () => {
    expect(getYieldState(createYieldStore(), "x").state).toBe("idle");
  });
  it("isYielding / isYielded", () => {
    let s = createYieldStore();
    expect(isYielding(s, "s1")).toBe(false);
    s = requestYield(s, "s1");
    expect(isYielding(s, "s1")).toBe(true);
    expect(isYielded(s, "s1")).toBe(false);
    s = confirmYielded(s, "s1");
    expect(isYielded(s, "s1")).toBe(true);
    expect(isYielding(s, "s1")).toBe(false);
  });
});
