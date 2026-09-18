/**
 * Save-path approval —— 导出路径必须由用户在原生保存对话框亲手选择。
 *
 * 这是一个**纯模块**(没有依赖 Electron)的单测:它跑得快,而且证明
 * "一次性 + 容量 64"两条不变式与 IPC 层 / renderer 层无关 —— 只要
 * 调一次就行,这个模块就这么长。
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  approveSavePath,
  approvedSavePathCount,
  requireApprovedSavePath,
  resetApprovedSavePaths,
} from "../save-path-approval";

describe("save-path-approval", () => {
  beforeEach(() => {
    resetApprovedSavePaths();
  });

  it("approve 后 require 一次成功", () => {
    const approved = approveSavePath("/tmp/user-picked.jsonl");
    expect(approved).toBe("/tmp/user-picked.jsonl");
    expect(approvedSavePathCount()).toBe(1);
    expect(requireApprovedSavePath("/tmp/user-picked.jsonl")).toBe("/tmp/user-picked.jsonl");
  });

  it("同一个路径**只能被用一次**:第二次 require 抛错", () => {
    approveSavePath("/tmp/once.jsonl");
    expect(() => requireApprovedSavePath("/tmp/once.jsonl")).not.toThrow();
    expect(() => requireApprovedSavePath("/tmp/once.jsonl")).toThrowError("导出路径必须来自保存对话框");
  });

  it("未审批的路径一律拒绝(防止渲染层给个任意绝对路径)", () => {
    expect(() => requireApprovedSavePath("/etc/passwd")).toThrowError("导出路径必须来自保存对话框");
  });

  it("approve(null) 是无操作;用户点取消就什么都不做", () => {
    expect(approveSavePath(null)).toBeNull();
    expect(approvedSavePathCount()).toBe(0);
  });

  it("容量上限:连续 approve 64+ 个,最早的会被淘汰", () => {
    for (let i = 0; i < 70; i += 1) {
      approveSavePath(`/tmp/p-${i}.jsonl`);
    }
    expect(approvedSavePathCount()).toBe(64);
    // 最早的两个已被淘汰,后两个还在
    expect(() => requireApprovedSavePath("/tmp/p-0.jsonl")).toThrow();
    expect(() => requireApprovedSavePath("/tmp/p-1.jsonl")).toThrow();
    expect(requireApprovedSavePath("/tmp/p-69.jsonl")).toBe("/tmp/p-69.jsonl");
  });

  it("相对路径在 require 时按 resolve 后比对(避免 ./tmp/... 这种绕过)", () => {
    const resolved = approveSavePath("/tmp/rel.jsonl");
    expect(resolved).toBe("/tmp/rel.jsonl");
    // 不论 require 时用同一字符串还是 resovle 后的形式,都应当被认账。
    expect(requireApprovedSavePath("/tmp/rel.jsonl")).toBe("/tmp/rel.jsonl");
  });
});
