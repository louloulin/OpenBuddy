import { describe, it, expect } from "vitest";
import {
  isPreviewableUrl,
  PREVIEW_SANDBOX,
  normalizePreviewUrl,
  previewTitle,
} from "../platform/browser-preview";

describe("isPreviewableUrl", () => {
  it("允许 http/https 公网", () => {
    expect(isPreviewableUrl("https://example.com")).toBe(true);
    expect(isPreviewableUrl("http://example.com/path")).toBe(true);
  });
  it("拒绝非 http(s) 协议", () => {
    expect(isPreviewableUrl("file:///etc/passwd")).toBe(false);
    expect(isPreviewableUrl("data:text/html,<x>")).toBe(false);
    expect(isPreviewableUrl("javascript:alert(1)")).toBe(false);
    expect(isPreviewableUrl("blob:https://x/y")).toBe(false);
  });
  it("拒绝回环地址", () => {
    expect(isPreviewableUrl("http://localhost")).toBe(false);
    expect(isPreviewableUrl("http://127.0.0.1")).toBe(false);
    expect(isPreviewableUrl("http://[::1]")).toBe(false);
  });
  it("拒绝内网/链路本地段", () => {
    expect(isPreviewableUrl("http://10.0.0.1")).toBe(false);
    expect(isPreviewableUrl("http://192.168.1.1")).toBe(false);
    expect(isPreviewableUrl("http://169.254.1.1")).toBe(false);
    expect(isPreviewableUrl("http://172.16.0.1")).toBe(false);
    expect(isPreviewableUrl("http://172.31.255.255")).toBe(false);
  });
  it("172.15/172.32 不在内网段,允许", () => {
    expect(isPreviewableUrl("http://172.15.0.1")).toBe(true);
    expect(isPreviewableUrl("http://172.32.0.1")).toBe(true);
  });
  it("无效 URL 返回 false", () => {
    expect(isPreviewableUrl("not a url")).toBe(false);
    expect(isPreviewableUrl("")).toBe(false);
  });
});

describe("PREVIEW_SANDBOX", () => {
  it("包含 allow-scripts 但不含 allow-top-navigation", () => {
    expect(PREVIEW_SANDBOX).toContain("allow-scripts");
    expect(PREVIEW_SANDBOX).not.toContain("allow-top-navigation");
  });
});

describe("normalizePreviewUrl", () => {
  it("补全 https 协议", () => {
    expect(normalizePreviewUrl("example.com")).toBe("https://example.com/");
  });
  it("保留已有协议", () => {
    expect(normalizePreviewUrl("http://example.com")).toBe("http://example.com/");
  });
  it("去锚点", () => {
    expect(normalizePreviewUrl("https://example.com/a#x")).toBe("https://example.com/a");
  });
  it("拒绝不可预览(返回 null)", () => {
    expect(normalizePreviewUrl("localhost")).toBeNull();
    expect(normalizePreviewUrl("file:///x")).toBeNull();
  });
  it("空串返回 null", () => {
    expect(normalizePreviewUrl("")).toBeNull();
    expect(normalizePreviewUrl("   ")).toBeNull();
  });
});

describe("previewTitle", () => {
  it("用 hostname", () => {
    expect(previewTitle("https://docs.example.com/x")).toBe("docs.example.com");
  });
  it("无效 URL 回退", () => {
    expect(previewTitle("noturl")).toBe("网页预览");
  });
});
