/**
 * 字重契约（plan1030 批 1）：font-weight ≤ 600。
 * 背景：700 出现 46 次——若实际渲染字体无 700 档则是合成加粗（糊）。
 */
import { describe, it } from "vitest";
import { expectNoGrowth } from "./contract-harness";

describe("视觉契约 — font-weight", () => {
  it("font-weight > 600（含 bold）的声明数不许超过快照基线", () => {
    expectNoGrowth("heavyWeight");
  });
});
