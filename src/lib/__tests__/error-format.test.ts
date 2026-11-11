import { describe, it, expect } from "vitest";
import { formatAgentError, friendlyError } from "../error-format";

describe("formatAgentError", () => {
  it("parses 429 TPM rate limit from Rust Debug string", () => {
    const raw = `Error { code: -32003: Unknown error, message: "Rate limited", data: Some(Object {"message": String("API error (status 429 Too Many Requests): runtime_error: tpm rate limit exceeded"), "promptUsage": Object {"inputTokens": Number(219848), "outputTokens": Number(10094), "totalTokens": Number(229942), "cachedReadTokens": Number(0), "reasoningTokens": Number(2163), "modelCalls": Number(15), "apiDurationMs": Number(211574), "modelUsage": Object {"glm-5": Object {"inputTokens": Number(219848)}}, "numTurns": Number(4)}}) }`;
    const result = formatAgentError(raw);
    expect(result).not.toBeNull();
    expect(result).toContain("TPM");
    expect(result).toContain("219.8k");
    expect(result).toContain("15 次");
    expect(result).toContain("4 轮");
    expect(result).toContain("glm-5");
    expect(result).toContain("等待");
  });

  it("parses 429 RPM rate limit", () => {
    const raw = JSON.stringify({
      code: -32003,
      message: "Rate limited",
      data: {
        message: "API error (status 429): rpm rate limit exceeded",
        promptUsage: { inputTokens: 5000, modelCalls: 3 },
      },
    });
    const result = formatAgentError(raw);
    expect(result).not.toBeNull();
    expect(result).toContain("RPM");
  });

  it("handles auth error", () => {
    const raw = JSON.stringify({
      code: -32003,
      data: { message: "401 Unauthorized: invalid API key" },
    });
    const result = formatAgentError(raw);
    expect(result).not.toBeNull();
    expect(result).toContain("认证失败");
  });

  it("handles connection error", () => {
    const raw = JSON.stringify({
      data: { message: "connection refused: ECONNREFUSED" },
    });
    const result = formatAgentError(raw);
    expect(result).not.toBeNull();
    expect(result).toContain("网络连接失败");
  });

  it("returns null for unparseable string", () => {
    expect(formatAgentError("some random error")).toBeNull();
  });
});

describe("friendlyError", () => {
  it("formats parseable errors", () => {
    const raw = JSON.stringify({
      code: -32003,
      data: { message: "401 Unauthorized" },
    });
    const result = friendlyError(raw);
    expect(result).toContain("认证失败");
  });

  it("falls back to raw string for unparseable errors", () => {
    const raw = "something went wrong";
    expect(friendlyError(raw)).toBe(raw);
  });

  it("handles Error objects", () => {
    const err = new Error("connection timeout");
    const result = friendlyError(err);
    expect(result).toContain("网络连接失败");
  });
});
