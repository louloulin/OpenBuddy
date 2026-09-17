import { describe, it, expect } from "vitest";
import {
  EXPERTS_ROUTE_LABEL,
  PLACEHOLDER_ROUTE_LABELS,
  isPlaceholderRouteLabel,
} from "../placeholder-routes";

describe("placeholder-routes", () => {
  it("专家页 label 唯一来源 — 改动会触发 R93 隐藏 TasksSurface 的行为变化", () => {
    expect(EXPERTS_ROUTE_LABEL).toBe("专家·技能·连接器");
    expect(PLACEHOLDER_ROUTE_LABELS).toContain(EXPERTS_ROUTE_LABEL);
  });

  it("isPlaceholderRouteLabel 正确判别合法/非法值", () => {
    expect(isPlaceholderRouteLabel(EXPERTS_ROUTE_LABEL)).toBe(true);
    expect(isPlaceholderRouteLabel("智能体")).toBe(false);
    expect(isPlaceholderRouteLabel("")).toBe(false);
    expect(isPlaceholderRouteLabel(null)).toBe(false);
    expect(isPlaceholderRouteLabel(undefined)).toBe(false);
    expect(isPlaceholderRouteLabel(42)).toBe(false);
  });
});
