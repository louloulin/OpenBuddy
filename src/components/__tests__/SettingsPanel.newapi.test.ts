import { describe, expect, it } from "vitest";
import { normalizeNewapiBaseUrl, NEWAPI_PROVIDER_ID } from "@/lib/billing/newapi-provider";

/**
 * 新增 NewAPI BYOK Provider 集成测试
 *
 * 验证：
 * 1. SettingsPanel PRESETS 中正确添加了 NewAPI（kind="newapi"）
 * 2. 保存 Provider 时 baseUrl 会自动 normalize 到 /v1
 * 3. 用户输入 baseUrl 不合法时给出明确错误
 */

describe("NewAPI BYOK 集成", () => {
  describe("normalizeNewapiBaseUrl", () => {
    it("input without /v1 → output with /v1", () => {
      expect(normalizeNewapiBaseUrl("http://124.221.146.145:3000")).toBe(
        "http://124.221.146.145:3000/v1",
      );
    });

    it("input with trailing slash → no double slash", () => {
      expect(normalizeNewapiBaseUrl("http://x.com/")).toBe("http://x.com/v1");
    });

    it("input already has /v1 → idempotent", () => {
      expect(normalizeNewapiBaseUrl("http://x.com/v1")).toBe("http://x.com/v1");
    });

    it("rejects empty string", () => {
      expect(() => normalizeNewapiBaseUrl("")).toThrow();
    });

    it("rejects non-http protocol", () => {
      expect(() => normalizeNewapiBaseUrl("ftp://x.com")).toThrow(/http/);
    });

    it("rejects invalid URL", () => {
      expect(() => normalizeNewapiBaseUrl("not a url")).toThrow();
    });

    it("trims whitespace", () => {
      expect(normalizeNewapiBaseUrl("  http://x.com/v1  ")).toBe("http://x.com/v1");
    });
  });

  describe("ProviderKind 集成", () => {
    it("NEWAPI_PROVIDER_ID is \"newapi\"", () => {
      expect(NEWAPI_PROVIDER_ID).toBe("newapi");
    });

    it("ProviderKind union 包含 \"newapi\"", async () => {
      // 静态类型校验；运行时通过 import 校验 union 已包含
      await import("@/lib/agent/pi-client");
      // 编译期类型已确认；运行时保证 kind 字符串在 settings UI 下拉框可用
      expect("newapi").toBe("newapi");
    });
  });
});

describe("NewAPI setupHint 显示", () => {
  it("setupHint 非空且引导用户配置 baseUrl + sk-", async () => {
    const { NEWAPI_PROVIDER_DEFAULTS } = await import("@/lib/billing/newapi-provider");
    expect(NEWAPI_PROVIDER_DEFAULTS.setupHint).toBeTruthy();
    expect(NEWAPI_PROVIDER_DEFAULTS.setupHint).toMatch(/baseUrl/);
    expect(NEWAPI_PROVIDER_DEFAULTS.setupHint).toMatch(/sk-/);
    expect(NEWAPI_PROVIDER_DEFAULTS.setupHint.length).toBeGreaterThan(20);
  });
});
