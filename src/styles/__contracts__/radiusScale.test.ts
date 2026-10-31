/** 圆角契约（plan1030 批 1）：border-radius 必须走 token/var()。 */
import { describe, it } from "vitest";
import { expectNoGrowth } from "./contract-harness";

describe("视觉契约 — border-radius 裸值", () => {
  it("裸圆角声明数不许超过快照基线", () => {
    expectNoGrowth("radiusBare");
  });
});
