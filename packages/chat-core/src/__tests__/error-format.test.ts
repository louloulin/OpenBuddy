import { describe, it, expect } from "vitest";
import { describeError, errorCode, formatAgentError, friendlyError } from "../error-format";
import { ProtocolError } from "@openbuddy/protocol/errors";

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
    expect(result).toContain("API Key 无效或已过期");
  });

  it("maps rate limits, context overflow and IPC wrappers to plain words", () => {
    expect(friendlyError("Error invoking remote method 'agent_prompt': Error: 429 Too Many Requests")).toContain("已达到模型用量上限");
    expect(friendlyError("prompt is too long: context length exceeded")).toContain("超出了模型的上下文");
    // G1-28: context overflow offers in-place compaction, not just retry.
    expect(describeError("prompt is too long: context length exceeded").action).toBe("compact");
    expect(friendlyError("Error invoking remote method 'agent_prompt': Error: 会话未加载")).toContain("任务已关闭或不存在");
  });

  it("falls back to raw string for unparseable errors", () => {
    const raw = "something went wrong";
    expect(friendlyError(raw)).toBe(raw);
  });

  it("handles Error objects", () => {
    const err = new Error("connection timeout");
    const result = friendlyError(err);
    expect(result).toContain("无法连接到模型服务");
  });
});

describe("protocol error codes (pii W0.6)", () => {
  const ipc = (message: string) => new Error(`Error invoking remote method 'openbuddy:invoke': Error: ${message}`);

  it("maps codes that crossed IPC to Chinese copy, with the field for invalid payloads", () => {
    expect(describeError(ipc("invalid_payload: query"))).toMatchObject({ title: "请求内容无效", raw: "invalid_payload: query" });
    expect(describeError(ipc("invalid_payload: query")).hint).toContain("字段：query");
    expect(friendlyError(ipc("session_not_loaded: s1"))).toBe("任务已关闭或不存在：从侧栏重新打开该任务");
    expect(describeError(ipc("workspace_not_authorized: select a folder using the native dialog"))).toMatchObject({ title: "工作空间未授权", action: "retry" });
    expect(describeError(ipc("model_auth_missing: fixture")).action).toBe("settings");
    expect(describeError(ipc("export_path_not_authorized")).title).toBe("导出位置未授权");
    expect(describeError(ipc("path_outside_workspace: /etc/passwd")).title).toBe("路径不在当前工作空间内");
  });

  it("maps preload and renderer-bridge not_implemented rejections the same way", () => {
    expect(describeError(new Error("not_implemented: agents_list"))).toMatchObject({ title: "当前版本还不支持这个功能", action: undefined });
    expect(describeError(new Error("此功能在 Electron MVP 中暂不可用：agents_list")).title).toBe("当前版本还不支持这个功能");
  });

  it("reads ProtocolError instances and { code } objects directly", () => {
    expect(describeError(new ProtocolError("already_exists", "写作助手")).title).toBe("同名的项目已经存在");
    expect(describeError({ code: "session_busy", message: "session_busy" }).action).toBe("wait");
    expect(errorCode(ipc("not_found: expert x"))).toBe("not_found");
    expect(errorCode(new Error("connection timeout"))).toBeUndefined();
  });

  it("falls back to the existing heuristics for unknown codes and plain text", () => {
    expect(describeError(ipc("too_many_running: 3")).title).toBe("同时运行的任务已达上限");
    expect(describeError(ipc("file_changed: /a.txt")).title).toBe("附件需要重新选择");
    expect(describeError("some_unknown_code: detail").title).toBe("some_unknown_code: detail");
  });
});
