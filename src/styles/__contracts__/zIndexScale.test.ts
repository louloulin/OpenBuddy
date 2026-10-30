/**
 * z-index 契约（plan1030 批 1）：z-index 必须走 --z-* 刻度。
 * 背景：home.css 曾有 1100/1200/1300 散值，modal/dropdown/toast
 * 之间没有定义过的排序（plan1030 §2 P0-3）。
 */
import { describe, it } from "vitest";
import { expectNoGrowth } from "./contract-harness";

describe("视觉契约 — z-index 裸值", () => {
  it("裸 z-index 声明数不许超过快照基线", () => {
    expectNoGrowth("zIndexBare");
  });
});
