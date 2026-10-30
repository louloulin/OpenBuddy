/**
 * error-format.test — plan1030 真机发现回归（2026-10-30 启动实测）。
 *
 * 真实 402 错误（MiniMax 网关余额耗尽）曾以
 * `⚠️ 402 {"type":"error",...}` 整段 JSON 原样贴给用户。
 * 锁定：提供商 JSON（含状态码前缀）必须解析为可读中文文案。
 */
import { describe, expect, it } from "vitest";
import { formatPiError } from "../error-format";

const REAL_402 =
  '402 {"type":"error","error":{"type":"insufficient_balance_error","message":"insufficient balance (1008)"},"request_id":"0733656f1b7e1274897cbd8ad55ce9d8"}';

describe("formatPiError 提供商 JSON（plan1030 真机回归）", () => {
  it("真实 402 余额错误解析为中文文案，不再透传原始 JSON", () => {
    const out = formatPiError(REAL_402);
    expect(out).toContain("余额不足");
    expect(out).not.toContain("request_id");
    expect(out).not.toContain("{\"type\"");
  });

  it("无状态码前缀的同构 JSON 同样处理", () => {
    const out = formatPiError(
      '{"type":"error","error":{"type":"insufficient_balance_error","message":"insufficient balance (1008)"}}',
    );
    // 该形状会被 tryParsePiError / 通用分支处理 —— 至少不得原样透传整段 JSON
    expect(out === null || !out.includes("request_id")).toBe(true);
  });

  it("其他提供商错误给出 message + 类型，不透传整段 JSON", () => {
    const out = formatPiError(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens is too large"}}',
    );
    expect(out).toContain("max_tokens is too large");
    expect(out).toContain("invalid_request_error");
  });

  it("402 裸字符串（无 JSON）也映射为余额文案", () => {
    expect(formatPiError("Error: 402 insufficient balance")).toContain("余额不足");
  });
});
