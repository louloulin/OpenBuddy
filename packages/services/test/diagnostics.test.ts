// @vitest-environment node
// 反馈诊断 (pii W6.5): local preview only, no API keys and no absolute paths.
import { describe, expect, it } from "vitest";
import { buildDiagnostics, sanitizeDiagnostics } from "../src/support/diagnostics";

const base = {
  app: "OpenBuddy 1.0.0",
  versions: { node: "v22.0.0", chromium: "130.0.0", electron: undefined },
  platform: "darwin",
  arch: "arm64",
  providerIds: ["fixture"],
  model: { provider: "fixture", modelId: "fixture-model" },
  permissionMode: "ask",
  ruleCount: 2,
  protectedPaths: [".env", "*.pem"],
  extensions: [{ name: "example.ts" }, { name: "broken.ts", error: "boom" }],
  sessionId: "s1",
  messageCount: 4,
  feedback: "点导出按钮没有反应",
};

describe("诊断报告 (pii W6.5)", () => {
  it("includes the environment, model, permissions and feedback", () => {
    const text = buildDiagnostics(base);
    expect(text).toContain("# OpenBuddy 诊断报告");
    expect(text).toContain("fixture/fixture-model");
    expect(text).toContain("受保护路径：.env、*.pem");
    expect(text).toContain("会话 id：s1");
    expect(text).toContain("消息数：4");
    expect(text).toContain("点导出按钮没有反应");
    expect(text).toContain("broken.ts：boom");
    // Empty version values are dropped.
    expect(text).not.toContain("electron：");
  });

  it("never carries absolute paths or credential-looking tokens", () => {
    const text = buildDiagnostics({
      ...base,
      extensions: [{ name: "/Users/alice/project/ext.ts", error: "failed at /home/alice/secret" }],
      feedback: "我的 key 是 sk-abcdefgh12345678，路径 /Users/alice/.env，头 Bearer abcdefghijklmnop",
    });
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("/home/alice");
    expect(text).not.toContain("sk-abcdefgh12345678");
    expect(text).not.toContain("Bearer abcdefghijklmnop");
    expect(text).toContain("[path]");
    expect(text).toContain("[redacted]");
  });

  it("sanitizeDiagnostics leaves ordinary text alone", () => {
    expect(sanitizeDiagnostics("普通反馈：导出失败 2 次")).toBe("普通反馈：导出失败 2 次");
  });
});
