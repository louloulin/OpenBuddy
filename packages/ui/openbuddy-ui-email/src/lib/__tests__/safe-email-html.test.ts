import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "../safe-email-html";

describe("sanitizeEmailHtml", () => {
  it("removes active content and unsafe attributes", () => {
    const html = sanitizeEmailHtml('<script>alert(1)</script><p onclick="alert(2)" style="color:red">Hello</p><a href="javascript:alert(3)" target="_blank">link</a>');
    expect(html).toContain("Hello");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("style");
    expect(html).not.toContain("javascript:");
  });

  it("keeps safe links and adds noopener for new tabs", () => {
    const html = sanitizeEmailHtml('<a href="https://example.com" target="_blank" data-tracking="x">Open</a>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("data-tracking");
  });

  it("blocks remote images instead of loading them", () => {
    expect(sanitizeEmailHtml('<img src="https://tracker.example/pixel.gif" alt="tracking">')).toContain("[远程图片已阻止]");
  });
});
