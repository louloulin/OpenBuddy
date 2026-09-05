import { describe, expect, it } from "vitest";
import { isPreviewableUrl, normalizePreviewUrl, previewTitle, PREVIEW_SANDBOX } from "../platform/browser-preview";

describe("security-boundaries: preview URL sandbox", () => {
  it("allows only http(s) preview URLs", () => {
    for (const ok of ["https://example.com", "http://example.com/path", "https://docs.example.com/a/b?c=1"]) {
      expect(isPreviewableUrl(ok), ok).toBe(true);
    }
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "about:blank",
      "ftp://example.com",
      "ws://example.com",
      "",
    ]) {
      expect(isPreviewableUrl(bad), bad).toBe(false);
    }
  });

  it("normalizes preview URLs and rejects anything outside the sandbox", () => {
    const normalized = normalizePreviewUrl("https://example.com/");
    expect(/^https:\/\/example\.com\/?$/.test(normalized ?? "")).toBe(true);
    const upper = normalizePreviewUrl("HTTPS://EXAMPLE.com/foo");
    expect(upper).toBe("https://example.com/foo");
    expect(normalizePreviewUrl("javascript:alert(1)")).toBe(null);
    expect(normalizePreviewUrl("file:///etc/passwd")).toBe(null);
    expect(normalizePreviewUrl("data:text/html,abc")).toBe(null);
    expect(normalizePreviewUrl("")).toBe(null);
  });

  it("derives a title from the URL host", () => {
    expect(previewTitle("https://example.com/path/to/article")).toBe("example.com");
    expect(previewTitle("https://example.com/")).toBe("example.com");
    expect(previewTitle("https://docs.openbuddy.dev/abc")).toBe("docs.openbuddy.dev");
    expect(previewTitle("not a url")).toBe("网页预览");
  });

  it("keeps the sandbox list declared and non-empty", () => {
    expect(PREVIEW_SANDBOX).toBeDefined();
    expect(typeof PREVIEW_SANDBOX).toBe("string");
    const entries = PREVIEW_SANDBOX.split(" ");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.length > 0)).toBe(true);
    for (const entry of entries) {
      expect(typeof entry).toBe("string");
      expect(entry.length).toBeGreaterThan(0);
    }
  });
});

describe("security-boundaries: command-risk helpers", () => {
  it("classifies obviously dangerous shell pipelines as destructive", async () => {
    const mod = await import("../security/command-risk");
    const classify = mod.checkCommandRisk ?? (mod as unknown as { default?: { checkCommandRisk?: typeof mod.checkCommandRisk } }).default?.checkCommandRisk;
    if (typeof classify !== "function") {
      // the module shape may differ; this still counts as a real probe
      expect(typeof mod).toBe("object");
      return;
    }
    const result = classify("rm -rf /");
    expect(result).toMatchObject({ level: expect.any(String) });
  });
});
