/** 字号契约（plan1030 批 1）：font-size 必须走 token/var()。 */
import { describe, it } from "vitest";
import { expectNoGrowth } from "./contract-harness";

describe("视觉契约 — font-size 裸值", () => {
  it("裸字号声明数不许超过快照基线", () => {
    expectNoGrowth("fontSizeBare");
  });
});
