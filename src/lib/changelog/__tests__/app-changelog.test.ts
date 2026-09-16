import { describe, expect, it } from "vitest";

import {
  APP_RELEASES,
  WHATS_NEW_STORAGE_KEY,
  decideWhatsNew,
  latestKnownRelease,
  releaseFor,
} from "../app-changelog";

describe("app-changelog(真实 CHANGELOG.md)", () => {
  it("真的解析出条目(格式回归的看门狗)", () => {
    expect(APP_RELEASES.length).toBeGreaterThan(0);
    expect(APP_RELEASES[0].version).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP_RELEASES[0].items.length).toBeGreaterThan(0);
    for (const item of APP_RELEASES[0].items) {
      expect(item.title.length).toBeGreaterThan(0);
      // markdown 记号必须被清掉 —— 卡片按纯文本渲染
      expect(item.title).not.toContain("**");
      expect(item.title).not.toContain("](");
    }
  });

  it("releaseFor / latestKnownRelease 都指得到东西", () => {
    expect(latestKnownRelease()).toBe(APP_RELEASES[0]);
    expect(releaseFor(APP_RELEASES[0].version)).toBe(APP_RELEASES[0]);
    expect(releaseFor("0.0.0-does-not-exist")).toBeUndefined();
  });

  it("storage key 稳定(改了会让所有人重新看到摘要)", () => {
    expect(WHATS_NEW_STORAGE_KEY).toBe("openbuddy.whats-new.lastSeen");
  });
});

describe("decideWhatsNew", () => {
  const current = APP_RELEASES[0].version;

  it("首次安装不弹(首启已有引导向导)", () => {
    expect(decideWhatsNew(current, null).show).toBe(false);
    expect(decideWhatsNew(current, undefined).show).toBe(false);
  });

  it("从旧版本升上来才弹", () => {
    const decision = decideWhatsNew(current, "0.0.1-older");
    expect(decision.show).toBe(true);
    expect(decision.release?.version).toBe(current);
  });

  it("同一版本不重复弹", () => {
    expect(decideWhatsNew(current, current).show).toBe(false);
  });

  it("开发版(版本号领先 CHANGELOG)取最新已知条目", () => {
    const decision = decideWhatsNew("99.0.0-dev", "0.14.0");
    expect(decision.show).toBe(true);
    expect(decision.release?.version).toBe(current);
  });
});
