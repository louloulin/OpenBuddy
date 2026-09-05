import { describe, it, expect } from "vitest";
import { LOADING_TIPS } from "../platform/loading-tips";

describe("LOADING_TIPS", () => {
  it("exposes a non-empty carousel pool", () => {
    expect(LOADING_TIPS.length).toBeGreaterThan(20);
  });

  it("keeps every tip as a non-empty Chinese-leaning string of reasonable length", () => {
    for (const tip of LOADING_TIPS) {
      expect(typeof tip).toBe("string");
      expect(tip.trim().length).toBeGreaterThan(0);
      expect(tip.length).toBeLessThanOrEqual(40);
    }
  });

  it("does not advertise OpenBuddy-unsupported features (积分/腾讯文档/GenFlow)", () => {
    const banned = ["GenFlow", "腾讯文档", "积分", "Tencent Docs", "工作空间自动化推送"];
    for (const tip of LOADING_TIPS) {
      for (const needle of banned) {
        expect(tip.includes(needle), `tip "${tip}" must not mention ${needle}`).toBe(false);
      }
    }
  });

  it("keeps practical hints mentioning OpenBuddy-supported affordances", () => {
    const expectedAffordances = ["@", "/", "工作目录", "深度思考", "总结", "截图", "拖"];
    const hasAtLeastOne = expectedAffordances.some((needle) =>
      LOADING_TIPS.some((tip) => tip.includes(needle)),
    );
    expect(hasAtLeastOne).toBe(true);
  });

  it("contains no duplicate tips so the carousel does not repeat within a single rotation", () => {
    const seen = new Set<string>();
    for (const tip of LOADING_TIPS) {
      expect(seen.has(tip), `duplicate tip: ${tip}`).toBe(false);
      seen.add(tip);
    }
  });
});
