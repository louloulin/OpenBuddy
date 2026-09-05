import { afterEach, describe, expect, it } from "vitest";

describe("weknoraStatus (configuration surface)", () => {
  const original = {
    api: process.env.OPENBUDDY_WEKNORA_API_URL,
    exchange: process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL,
    tenants: process.env.OPENBUDDY_WEKNORA_TENANT_MAP,
  };
  afterEach(() => {
    if (original.api === undefined) delete process.env.OPENBUDDY_WEKNORA_API_URL;
    else process.env.OPENBUDDY_WEKNORA_API_URL = original.api;
    if (original.exchange === undefined) delete process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL;
    else process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL = original.exchange;
    if (original.tenants === undefined) delete process.env.OPENBUDDY_WEKNORA_TENANT_MAP;
    else process.env.OPENBUDDY_WEKNORA_TENANT_MAP = original.tenants;
  });

  it("returns configured=false when OPENBUDDY_WEKNORA_API_URL is empty", async () => {
    delete process.env.OPENBUDDY_WEKNORA_API_URL;
    delete process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL;
    delete process.env.OPENBUDDY_WEKNORA_TENANT_MAP;
    const { weknoraStatus } = await import("../casdoor/weknora-client");
    const status = weknoraStatus();
    expect(status.configured).toBe(false);
    expect(typeof status.reason).toBe("string");
    expect((status.reason ?? "").length).toBeGreaterThan(0);
  });

  it("rejects non-http URLs in OPENBUDDY_WEKNORA_API_URL", async () => {
    process.env.OPENBUDDY_WEKNORA_API_URL = "javascript:alert(1)";
    delete process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL;
    delete process.env.OPENBUDDY_WEKNORA_TENANT_MAP;
    const { weknoraStatus } = await import("../casdoor/weknora-client");
    expect(weknoraStatus().configured).toBe(false);
  });

  it("rejects URLs with embedded credentials", async () => {
    process.env.OPENBUDDY_WEKNORA_API_URL = "https://user:pw@example.com";
    process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL = "https://example.com/exchange";
    process.env.OPENBUDDY_WEKNORA_TENANT_MAP = JSON.stringify({ "tenant-a": 1 });
    const { weknoraStatus } = await import("../casdoor/weknora-client");
    expect(weknoraStatus().configured).toBe(false);
  });

  it("accepts fully-configured http endpoints and tenant map", async () => {
    process.env.OPENBUDDY_WEKNORA_API_URL = "https://weknora.example.com";
    process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL = "https://auth.example.com/exchange";
    process.env.OPENBUDDY_WEKNORA_TENANT_MAP = JSON.stringify({ "tenant-a": 1, "tenant-b": 2 });
    const { weknoraStatus } = await import("../casdoor/weknora-client");
    expect(weknoraStatus().configured).toBe(true);
  });

  it("filters out tenant entries with non-positive ids", async () => {
    process.env.OPENBUDDY_WEKNORA_API_URL = "https://weknora.example.com";
    process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL = "https://auth.example.com/exchange";
    process.env.OPENBUDDY_WEKNORA_TENANT_MAP = JSON.stringify({ "": 1, "tenant-a": 0, "tenant-b": -5, "tenant-c": "not-number" });
    const { weknoraStatus } = await import("../casdoor/weknora-client");
    expect(weknoraStatus().configured).toBe(false);
  });
});
