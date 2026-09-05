import { describe, it, expect } from "vitest";
import {
  createInputHistory,
  pushHistory,
  clearHistory,
  navigateHistory,
} from "../ui/input-history";

describe("createInputHistory", () => {
  it("默认 limit 50", () => {
    const h = createInputHistory();
    expect(h.items).toEqual([]);
    expect(h.limit).toBe(50);
  });
  it("自定义 limit(clamp ≥1)", () => {
    expect(createInputHistory(10).limit).toBe(10);
    expect(createInputHistory(0).limit).toBe(1);
  });
});

describe("pushHistory", () => {
  it("追加到末尾", () => {
    const h = pushHistory(createInputHistory(), "a");
    expect(h.items).toEqual(["a"]);
  });

  it("空白不追加(返回原容器)", () => {
    const h = createInputHistory();
    expect(pushHistory(h, "   ")).toBe(h);
    expect(pushHistory(h, "")).toBe(h);
  });

  it("与最后一条相同不重复追加", () => {
    let h = pushHistory(createInputHistory(), "a");
    h = pushHistory(h, "a");
    expect(h.items).toEqual(["a"]);
  });

  it("已存在则移到末尾(去重 + 重排)", () => {
    let h = createInputHistory();
    h = pushHistory(h, "a");
    h = pushHistory(h, "b");
    h = pushHistory(h, "c");
    h = pushHistory(h, "a"); // a 挪到末尾
    expect(h.items).toEqual(["b", "c", "a"]);
  });

  it("超限截断保留最新", () => {
    let h = createInputHistory(3);
    h = pushHistory(h, "a");
    h = pushHistory(h, "b");
    h = pushHistory(h, "c");
    h = pushHistory(h, "d"); // 超限,丢弃 a
    expect(h.items).toEqual(["b", "c", "d"]);
  });

  it("不修改原容器(不可变)", () => {
    const h = createInputHistory();
    pushHistory(h, "a");
    expect(h.items).toEqual([]);
  });
});

describe("clearHistory", () => {
  it("清空 items", () => {
    let h = pushHistory(createInputHistory(), "a");
    h = clearHistory(h);
    expect(h.items).toEqual([]);
    expect(h.limit).toBe(50);
  });
});

describe("navigateHistory", () => {
  const h = (() => {
    let x = createInputHistory();
    x = pushHistory(x, "a");
    x = pushHistory(x, "b");
    x = pushHistory(x, "c");
    return x;
  })(); // items: [a, b, c]

  it("↑ 从输入框(cursor=length)跳到最新一条", () => {
    const r = navigateHistory(h, h.items.length, "up");
    expect(r.text).toBe("c");
    expect(r.cursor).toBe(2);
  });

  it("↑ 连续上翻到最旧", () => {
    let r = navigateHistory(h, h.items.length, "up"); // → c(2)
    r = navigateHistory(h, r.cursor, "up"); // → b(1)
    expect(r.text).toBe("b");
    r = navigateHistory(h, r.cursor, "up"); // → a(0)
    expect(r.text).toBe("a");
    r = navigateHistory(h, r.cursor, "up"); // clamp 0
    expect(r.cursor).toBe(0);
    expect(r.text).toBe("a");
  });

  it("↓ 下翻回到输入框(draft)", () => {
    let r = navigateHistory(h, 0, "down"); // a → b
    expect(r.text).toBe("b");
    r = navigateHistory(h, r.cursor, "down"); // b → c
    expect(r.text).toBe("c");
    r = navigateHistory(h, r.cursor, "down"); // c → 回到输入框(draft)
    expect(r.cursor).toBe(h.items.length);
    expect(r.text).toBe("");
  });

  it("↓ 使用 draft 回填", () => {
    const r = navigateHistory(h, h.items.length - 1, "down", "正在打字");
    expect(r.text).toBe("正在打字");
    expect(r.cursor).toBe(h.items.length);
  });

  it("空历史返回 draft", () => {
    const empty = createInputHistory();
    const r = navigateHistory(empty, 0, "up", "x");
    expect(r.text).toBe("x");
  });
});
