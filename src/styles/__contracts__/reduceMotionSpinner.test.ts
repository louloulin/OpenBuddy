/**
 * reduceMotionSpinner — reduce-motion「降速不停转」契约（plan1030 批 5e）。
 *
 * lumos 教训（globals.css:2469）：完全冻结的 spinner 读作「挂死」。
 * base.css 的全局 reduce-motion 清零必须保留 spinner carve-out
 * （2.4s 慢速旋转），且闪烁/脉冲类不被 carve-out 误伤。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const base = readFileSync(join(import.meta.dirname, "..", "base.css"), "utf8");

describe("视觉契约 — reduce-motion spinner 降速不停转", () => {
  it("base.css 的 reduce-motion 块包含 2.4s 慢速旋转 carve-out", () => {
    expect(base).toMatch(/animation-duration:\s*2\.4s\s*!important/);
    expect(base).toMatch(/animation-iteration-count:\s*infinite\s*!important/);
  });

  it("carve-out 覆盖已知的全局 spinner 选择器", () => {
    // 关键的三个：工具栏通用 .spin、sidebar 任务、workspace picker。
    expect(base).toContain(".spin,");
    expect(base).toContain(".sidebar__project-task-spinner");
    expect(base).toContain(".workspace-picker__spinner");
  });

  it("全局清零仍然存在（闪烁/脉冲类保持冻结）", () => {
    expect(base).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
    expect(base).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });
});
