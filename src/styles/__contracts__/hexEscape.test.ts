/**
 * hexEscape — 硬编码颜色契约（plan1030 批 1）。
 *
 * 审计口径（plan1030 §0）grep '#[0-9a-f]{3,6}' = 1,262；本测试口径
 * 稍宽（含 #rrggbbaa 与渐变色标上下文），快照基线 1,500。两种口径
 * 目的相同：theme-dark-overrides 这类「给硬编码打补丁」的做法不许再涨。
 */
import { describe, it } from "vitest";
import { expectNoGrowth } from "./contract-harness";

describe("视觉契约 — 硬编码 hex", () => {
  it("styles/*.css 硬编码颜色数不许超过快照基线", () => {
    expectNoGrowth("hex");
  });
});
