import { describe, it, expect } from "vitest";
import { formatPiError, friendlyError } from "../platform/error-format";

describe("formatPiError", () => {
  it("parses 429 TPM rate limit from Rust Debug string", () => {
    const raw = `Error { code: -32003: Unknown error, message: "Rate limited", data: Some(Object {"message": String("API error (status 429 Too Many Requests): runtime_error: tpm rate limit exceeded"), "promptUsage": Object {"inputTokens": Number(219848), "outputTokens": Number(10094), "totalTokens": Number(229942), "cachedReadTokens": Number(0), "reasoningTokens": Number(2163), "modelCalls": Number(15), "apiDurationMs": Number(211574), "modelUsage": Object {"glm-5": Object {"inputTokens": Number(219848)}}, "numTurns": Number(4)}}) }`;
    const result = formatPiError(raw);
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
    const result = formatPiError(raw);
    expect(result).not.toBeNull();
    expect(result).toContain("RPM");
  });

  it("handles auth error", () => {
    const raw = JSON.stringify({
      code: -32003,
      data: { message: "401 Unauthorized: invalid API key" },
    });
    const result = formatPiError(raw);
    expect(result).not.toBeNull();
    expect(result).toContain("认证失败");
  });

  it("handles connection error", () => {
    const raw = JSON.stringify({
      data: { message: "connection refused: ECONNREFUSED" },
    });
    const result = formatPiError(raw);
    expect(result).not.toBeNull();
    expect(result).toContain("网络连接失败");
  });

  it("returns the cleaned inner message for unparseable string", () => {
    const result = formatPiError("some random error");
    expect(result).not.toBeNull();
    expect(result).toContain("some random error");
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

  it("falls back to the cleaned message for unparseable errors", () => {
    const raw = "something went wrong";
    const result = friendlyError(raw);
    expect(result).toContain("something went wrong");
    expect(result).toMatch(/^⚠️/);
  });

  it("handles Error objects", () => {
    const err = new Error("connection timeout");
    const result = friendlyError(err);
    expect(result).toContain("网络连接失败");
  });

  it("strips Electron IPC wrapper and surfaces the inner message", () => {
    const raw = "Error invoking remote method 'agent:prompt': Error: No API key found for the selected model.";
    const result = friendlyError(raw);
    expect(result).toContain("API Key");
    expect(result).toContain("Settings");
    // Must NOT contain the raw debug envelope anymore.
    expect(result).not.toContain("Error invoking remote method");
    expect(result).not.toContain("Error: Error:");
  });

  it("recognises 'No API key found' inside the inner message", () => {
    const raw = JSON.stringify({
      code: -32601,
      message: "No API key found for the selected model.",
    });
    const result = friendlyError(raw);
    expect(result).toContain("未配置 API Key");
    expect(result).toContain("Settings");
  });

  it("strips repeated Error: prefixes", () => {
    const raw = "Error: Error: Some downstream failure";
    const result = friendlyError(raw);
    expect(result).toContain("Some downstream failure");
    expect(result).not.toContain("Error: Error:");
  });
});
