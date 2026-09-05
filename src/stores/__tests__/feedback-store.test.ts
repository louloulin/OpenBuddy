import { describe, it, expect, beforeEach } from "vitest";
import { useFeedbackStore, normalizeStars, type FeedbackMap } from "../feedback-store";

/** 清空 store + localStorage,并在内存里重置初始 entries。 */
const resetStore = () => {
  window.localStorage.removeItem("openbuddy.feedback");
  useFeedbackStore.setState({ entries: {} });
};

describe("feedback-store", () => {
  beforeEach(resetStore);

  it("setRating 写入复合 key", () => {
    useFeedbackStore.getState().setRating("s1", "m1", "up");
    const e = useFeedbackStore.getState().entries["s1:m1"];
    expect(e).toBeDefined();
    expect(e.rating).toBe("up");
    expect(typeof e.ts).toBe("number");
  });

  it("setRating 再点同向 → toggle 取消", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "up");
    expect(useFeedbackStore.getState().entries["s1:m1"]?.rating).toBe("up");
    s.setRating("s1", "m1", "up");
    expect(useFeedbackStore.getState().entries["s1:m1"]).toBeUndefined();
  });

  it("setRating 切换方向(up → down)", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "up");
    s.setRating("s1", "m1", "down");
    expect(useFeedbackStore.getState().entries["s1:m1"]?.rating).toBe("down");
  });

  it("不同会话/消息隔离", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "up");
    s.setRating("s1", "m2", "down");
    s.setRating("s2", "m1", "up");
    const e = useFeedbackStore.getState().entries;
    expect(e["s1:m1"]?.rating).toBe("up");
    expect(e["s1:m2"]?.rating).toBe("down");
    expect(e["s2:m1"]?.rating).toBe("up");
  });

  it("clearRating 移除指定条目", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "up");
    s.clearRating("s1", "m1");
    expect(useFeedbackStore.getState().entries["s1:m1"]).toBeUndefined();
  });

  it("clearRating 不存在的条目无副作用(目标条目仍在,localStorage 不变)", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "up");
    const rawBefore = window.localStorage.getItem("openbuddy.feedback");
    s.clearRating("s1", "nope");
    // 目标条目仍在。
    expect(useFeedbackStore.getState().entries["s1:m1"]).toBeDefined();
    // localStorage 内容不变(未被无谓重写)。
    expect(window.localStorage.getItem("openbuddy.feedback")).toBe(rawBefore);
  });

  it("getRating 返回条目或 null", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "down");
    expect(s.getRating("s1", "m1")?.rating).toBe("down");
    expect(s.getRating("s1", "missing")).toBeNull();
    expect(s.getRating("no", "m1")).toBeNull();
  });

  it("持久化到 localStorage(setRating / __replace / clearRating 均同步)", () => {
    // setRating 写入后 localStorage 应同步。
    useFeedbackStore.getState().setRating("s1", "m1", "up");
    let parsed = JSON.parse(window.localStorage.getItem("openbuddy.feedback")!);
    expect(parsed["s1:m1"].rating).toBe("up");

    // __replace 整体替换后 localStorage 同步。
    const fresh: FeedbackMap = { "s2:m2": { rating: "down", ts: 1 } };
    useFeedbackStore.getState().__replace(fresh);
    parsed = JSON.parse(window.localStorage.getItem("openbuddy.feedback")!);
    expect(parsed["s1:m1"]).toBeUndefined();
    expect(parsed["s2:m2"].rating).toBe("down");

    // clearRating 后 localStorage 同步移除。
    useFeedbackStore.getState().clearRating("s2", "m2");
    parsed = JSON.parse(window.localStorage.getItem("openbuddy.feedback")!);
    expect(parsed["s2:m2"]).toBeUndefined();
  });

  it("toggle 取消后 localStorage 同步移除", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "up");
    expect(JSON.parse(window.localStorage.getItem("openbuddy.feedback")!)["s1:m1"]).toBeDefined();
    s.setRating("s1", "m1", "up"); // 同向 → 取消
    expect(
      JSON.parse(window.localStorage.getItem("openbuddy.feedback")!)["s1:m1"],
    ).toBeUndefined();
  });

  // 分叉会话迁移:把源会话所有反馈条目 re-key 到新 id,避免 fork 后
  // 历史评分丢失(Issue: 历史会话不展示分)。
  it("renameSession 迁移源会话的所有反馈条目到目标 id", () => {
    const s = useFeedbackStore.getState();
    s.setRating("src", "m1", "up");
    s.setRating("src", "m2", "down");
    s.setDetailed("src", "m3", { rating: "up", stars: 5, note: "很好" });
    s.setRating("other", "m1", "up"); // 不应被影响

    s.renameSession("src", "fork");
    const entries = useFeedbackStore.getState().entries;
    expect(entries["src:m1"]).toBeUndefined();
    expect(entries["src:m2"]).toBeUndefined();
    expect(entries["src:m3"]).toBeUndefined();
    expect(entries["fork:m1"]?.rating).toBe("up");
    expect(entries["fork:m2"]?.rating).toBe("down");
    expect(entries["fork:m3"]?.rating).toBe("up");
    expect(entries["fork:m3"]?.stars).toBe(5);
    expect(entries["fork:m3"]?.note).toBe("很好");
    expect(entries["other:m1"]?.rating).toBe("up"); // 不受影响
  });

  it("renameSession 同步到 localStorage", () => {
    const s = useFeedbackStore.getState();
    s.setRating("src", "m1", "up");
    s.renameSession("src", "fork");
    const parsed = JSON.parse(window.localStorage.getItem("openbuddy.feedback")!);
    expect(parsed["src:m1"]).toBeUndefined();
    expect(parsed["fork:m1"]?.rating).toBe("up");
  });

  it("renameSession oldId === newId 是 no-op(状态引用保持)", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "up");
    const before = useFeedbackStore.getState();
    s.renameSession("s1", "s1");
    const after = useFeedbackStore.getState();
    expect(after.entries["s1:m1"]?.rating).toBe("up");
    // set() 返回原 state → 引用相等
    expect(after).toBe(before);
  });

  it("renameSession 源 id 无反馈时是 no-op(localStorage 不被无谓重写)", () => {
    const s = useFeedbackStore.getState();
    s.setRating("s1", "m1", "up");
    const rawBefore = window.localStorage.getItem("openbuddy.feedback");
    s.renameSession("absent", "fork");
    const rawAfter = window.localStorage.getItem("openbuddy.feedback");
    expect(rawAfter).toBe(rawBefore);
    expect(useFeedbackStore.getState().entries["s1:m1"]?.rating).toBe("up");
  });

  it("renameSession 保留 messageId 中可能存在的 ':' 字符", () => {
    const s = useFeedbackStore.getState();
    s.setRating("src", "m:weird:id", "up");
    s.renameSession("src", "fork");
    const entries = useFeedbackStore.getState().entries;
    expect(entries["src:m:weird:id"]).toBeUndefined();
    expect(entries["fork:m:weird:id"]?.rating).toBe("up");
  });
});

describe("feedback-store — setDetailed(完整评分)", () => {
  beforeEach(resetStore);

  it("写入 rating + stars + note", () => {
    useFeedbackStore.getState().setDetailed("s1", "m1", {
      rating: "up",
      stars: 5,
      note: "很有帮助",
    });
    const e = useFeedbackStore.getState().entries["s1:m1"];
    expect(e.rating).toBe("up");
    expect(e.stars).toBe(5);
    expect(e.note).toBe("很有帮助");
  });

  it("stars 被 clamp 到 1–5", () => {
    useFeedbackStore.getState().setDetailed("s1", "m1", { rating: "down", stars: 9 });
    expect(useFeedbackStore.getState().entries["s1:m1"].stars).toBe(5);
    useFeedbackStore.getState().setDetailed("s1", "m1", { rating: "down", stars: 0 });
    expect(useFeedbackStore.getState().entries["s1:m1"].stars).toBe(1);
  });

  it("stars 四舍五入", () => {
    useFeedbackStore.getState().setDetailed("s1", "m1", { rating: "up", stars: 3.6 });
    expect(useFeedbackStore.getState().entries["s1:m1"].stars).toBe(4);
  });

  it("stars 缺省(undefined)保留为 undefined", () => {
    useFeedbackStore.getState().setDetailed("s1", "m1", { rating: "up" });
    expect(useFeedbackStore.getState().entries["s1:m1"].stars).toBeUndefined();
  });

  it("空白 note 不写入(undefined)", () => {
    useFeedbackStore.getState().setDetailed("s1", "m1", { rating: "up", note: "   " });
    expect(useFeedbackStore.getState().entries["s1:m1"].note).toBeUndefined();
  });

  it("持久化到 localStorage", () => {
    useFeedbackStore.getState().setDetailed("s1", "m1", { rating: "down", stars: 2, note: "x" });
    const parsed = JSON.parse(window.localStorage.getItem("openbuddy.feedback")!);
    expect(parsed["s1:m1"].stars).toBe(2);
    expect(parsed["s1:m1"].note).toBe("x");
  });
});

describe("normalizeStars", () => {
  it("1–5 内四舍五入保留", () => {
    expect(normalizeStars(1)).toBe(1);
    expect(normalizeStars(5)).toBe(5);
    expect(normalizeStars(2.4)).toBe(2);
    expect(normalizeStars(2.5)).toBe(3);
  });
  it("超出范围 clamp", () => {
    expect(normalizeStars(0)).toBe(1);
    expect(normalizeStars(-3)).toBe(1);
    expect(normalizeStars(99)).toBe(5);
  });
  it("undefined / 非有限值 返回 undefined", () => {
    expect(normalizeStars(undefined)).toBeUndefined();
    expect(normalizeStars(NaN)).toBeUndefined();
    expect(normalizeStars(Infinity)).toBeUndefined();
  });
});
