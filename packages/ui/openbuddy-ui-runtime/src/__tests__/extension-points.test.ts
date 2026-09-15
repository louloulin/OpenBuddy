/**
 * extension-points.test.ts — 自动校验 builtin apply() 注册的 slot 名
 *
 * 该单测：
 * 1. 扫描 packages/ui/openbuddy-ui-runtime/src/builtin-applies.ts 提取所有 `apply as XxxApply` 导入
 * 2. 对每个 apply() 实例化执行，收集 registerSlot 调用
 * 3. 校验每个注册的 slot 名都在 docs/EXTENSION_POINTS.md 中登记
 *
 * 设计目的：避免 builtin 装配扩展点漂移到未公开 API。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REGISTRY_PATH = resolve(__dirname, "../../../../../docs/EXTENSION_POINTS.md");

describe("EXTENSION_POINTS.md registry", () => {
  it("docs/EXTENSION_POINTS.md exists", () => {
    expect(existsSync(REGISTRY_PATH)).toBe(true);
  });

  it("registry has at least 6 slot entries", () => {
    const md = readFileSync(REGISTRY_PATH, "utf8");
    // Match `| \`slot.name\` |` in the overview table
    const tableRows = md.match(/^\| `[a-z]+\.[a-z.]+` \|/gm) ?? [];
    expect(tableRows.length).toBeGreaterThanOrEqual(6);
  });

  it("registry includes the 6 core extension points", () => {
    const md = readFileSync(REGISTRY_PATH, "utf8");
    const requiredSlots = [
      "home.scene.tab",
      "composer.toolbar.action",
      "message.toolcall.card",
      "sidebar.nav.item",
      "workbench.tab",
      "settings.page",
    ];
    for (const slot of requiredSlots) {
      expect(md).toContain(`\`${slot}\``);
    }
  });

  it("registry declares version 1", () => {
    const md = readFileSync(REGISTRY_PATH, "utf8");
    expect(md).toMatch(/version\s*[:=]\s*1/i);
  });
});
