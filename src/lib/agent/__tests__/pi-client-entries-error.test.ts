import { describe, expect, it } from "vitest";

import {
  inferErrorCode,
  sessionEntriesToChatMessages,
} from "../pi-client";

describe("inferErrorCode — raw provider error → machine code", () => {
  it("classifies 429 / quota strings as rate_limit_error", () => {
    expect(inferErrorCode("429 速率限制：调用频率过高")).toBe("rate_limit_error");
    expect(inferErrorCode("rate limit exceeded")).toBe("rate_limit_error");
    expect(inferErrorCode("Token Plan 用量上限")).toBe("rate_limit_error");
  });
  it("classifies auth errors", () => {
    expect(inferErrorCode("401 unauthorized")).toBe("auth_error");
    expect(inferErrorCode("invalid_api_key")).toBe("auth_error");
  });
  it("classifies 5xx / provider outage", () => {
    expect(inferErrorCode("502 bad gateway")).toBe("provider_error");
    expect(inferErrorCode("server overloaded")).toBe("provider_error");
  });
  it("classifies timeouts and aborts", () => {
    expect(inferErrorCode("ETIMEDOUT")).toBe("network_error");
    expect(inferErrorCode("user aborted request")).toBe("aborted");
  });
  it("returns undefined for unknown shapes (UI falls back to raw text)", () => {
    expect(inferErrorCode("something novel broke")).toBeUndefined();
  });
});

describe("sessionEntriesToChatMessages — failed-turn projection", () => {
  it("skips empty assistant entries that have no content and no error", () => {
    const result = sessionEntriesToChatMessages([
      {
        type: "message",
        id: "a-1",
        message: { role: "assistant", content: [], timestamp: 0 },
      },
    ] as never);
    expect(result.messages).toHaveLength(0);
  });

  it("attaches a structured error to an assistant entry that has errorMessage and empty content", () => {
    const result = sessionEntriesToChatMessages([
      {
        type: "message",
        id: "a-1",
        message: {
          role: "assistant",
          content: [],
          timestamp: 0,
          stopReason: "error",
          errorMessage: "429 已达到 Token Plan 用量上限",
        },
      },
    ] as never);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].error).toBeTruthy();
    expect(result.messages[0].error?.code).toBe("rate_limit_error");
    expect(result.messages[0].error?.message).toMatch(/429/);
    expect(result.messages[0].parts).toHaveLength(0);
  });

  it("attaches an error to a failed turn that DID emit a tool call (preserve the tool, add the error)", () => {
    const result = sessionEntriesToChatMessages([
      {
        type: "message",
        id: "a-1",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "tc-1", name: "read_file", arguments: {}, result: [] },
          ],
          stopReason: "error",
          errorMessage: "boom",
        },
      },
    ] as never);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].parts).toHaveLength(1);
    expect(result.messages[0].parts[0]).toMatchObject({ kind: "tool_call" });
    expect(result.messages[0].error?.message).toBe("boom");
  });

  it("leaves healthy turns untouched (no error field)", () => {
    const result = sessionEntriesToChatMessages([
      {
        type: "message",
        id: "a-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          timestamp: 0,
          stopReason: "end_turn",
        },
      },
    ] as never);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].error).toBeUndefined();
  });
});
