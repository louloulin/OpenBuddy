/**
 * R1.4 — unit tests for the inline error extraction helper.
 *
 * Covers the priority chain: Error: prefix → apply_patch/command failed prefix
 * → exit code pattern → first non-empty line fallback.
 */
import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "../ToolCallCard";
import type { ToolCallView } from "@/stores/session-store";

function tc(texts: string[]): ToolCallView {
  return {
    toolCallId: "tc-1",
    title: "tool",
    kind: "bash",
    status: "failed",
    content: texts.map((text) => ({ type: "text" as const, text })),
  };
}

describe("extractErrorMessage", () => {
  it("extracts after 'Error:' prefix", () => {
    const msg = extractErrorMessage(tc(["Error: ENOENT: no such file or directory"]));
    expect(msg).toBe("ENOENT: no such file or directory");
  });

  it("extracts after 'apply_patch failed:' prefix", () => {
    const msg = extractErrorMessage(tc(["apply_patch failed: path outside the trusted workspace /tmp"]));
    expect(msg).toBe("path outside the trusted workspace /tmp");
  });

  it("extracts after 'apply_command failed:' prefix", () => {
    const msg = extractErrorMessage(tc(["apply_command failed: command timed out after 30s"]));
    expect(msg).toBe("command timed out after 30s");
  });

  it("extracts TypeError: prefix", () => {
    const msg = extractErrorMessage(tc(["TypeError: cannot read property 'foo' of undefined"]));
    expect(msg).toBe("cannot read property 'foo' of undefined");
  });

  it("extracts 中文-colon prefixed error", () => {
    const msg = extractErrorMessage(tc(["Error:文件不存在:foo.ts"]));
    expect(msg).toBe("文件不存在:foo.ts");
  });

  it("falls back to exit code pattern", () => {
    const msg = extractErrorMessage(tc(["Some output\nprocess exited with exit code 127\nmore text"]));
    expect(msg).toBe("进程退出码 127");
  });

  it("falls back to first non-empty line when no pattern matches", () => {
    const msg = extractErrorMessage(tc(["", "  ", "actual error text here"]));
    expect(msg).toBe("actual error text here");
  });

  it("truncates very long fallback messages at 240 chars", () => {
    const longLine = "x".repeat(500);
    const msg = extractErrorMessage(tc([longLine]));
    expect(msg.length).toBe(240);
  });

  it("returns the standard fallback when content is empty", () => {
    const msg = extractErrorMessage(tc([]));
    expect(msg).toBe("工具调用失败(无详细错误信息)");
  });

  it("returns the standard fallback when content is only whitespace", () => {
    const msg = extractErrorMessage(tc(["   ", "\n\n"]));
    expect(msg).toBe("工具调用失败(无详细错误信息)");
  });
});
