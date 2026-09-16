/**
 * sidebar-width-r8.62.test.ts — guard spec for R8.62 侧栏（左侧菜单栏）加宽 + 拖拽修复。
 *
 * 两个回归点：
 *   1. 侧栏默认宽度 320px（R8.62.1 进一步加宽;Resizable defaultWidth /
 *      --ds-sidebar-width 回退值必须一致，否则没有 wrapper 包裹的侧栏会退回到旧的窄宽度）。
 *   2. `.sidebar` 自带 `position: relative; z-index: 20`（让「更多」flyout 溢出到
 *      主区），而 Resizable 的 handle 只有 z-index: 5 —— 把手被侧栏整条盖住，
 *      只剩越过侧栏右边缘的 ~2px 可命中，实测拖拽完全失效。shell.css 必须把
 *      `.app__sidebar-handle` 提到侧栏之上。
 *
 * Coverage:
 *   - AppShell 传入 defaultWidth 288 / min 240 / max 480 + handleClassName
 *   - shell.css 的 handle z-index 严格大于 sidebar-menus.css 里 .sidebar 的 20
 *   - sidebar.css 的 --ds-sidebar-width 回退值是 288
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const shellCss = readFileSync(join(__dirname, "..", "shell.css"), "utf8");
const sidebarCss = readFileSync(join(__dirname, "..", "sidebar.css"), "utf8");
const sidebarMenusCss = readFileSync(join(__dirname, "..", "sidebar-menus.css"), "utf8");
const appShell = readFileSync(join(repoRoot, "src", "features", "app", "AppShell.tsx"), "utf8");

function ruleBody(input: string, selector: string): string | null {
  const idx = input.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < input.length; i++) {
    const ch = input[i];
    if (ch === "{") {
      depth++;
      if (start < 0) start = i + 1;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return input.slice(start, i);
    }
  }
  return null;
}

const HANDLE_SELECTOR =
  '.app__sidebar-shell[data-resizable-edge="right"] > .app__sidebar-handle[role="separator"]';

describe("R8.62.1 侧栏宽度", () => {
  it("AppShell 以 320px 默认宽度包裹侧栏，clamp 260–480", () => {
    expect(appShell).toMatch(/defaultWidth=\{320\}/);
    expect(appShell).toMatch(/min=\{260\}/);
    expect(appShell).toMatch(/max=\{480\}/);
    expect(appShell).toMatch(/storageKey="openbuddy\.sidebar\.width"/);
    expect(appShell).toMatch(/handleClassName="app__sidebar-handle"/);
  });

  it("--ds-sidebar-width 回退值与默认宽度一致（无 wrapper 渲染时不回退到旧窄宽度）", () => {
    const body = ruleBody(sidebarCss, ".sidebar");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/width:\s*var\(--ds-sidebar-width,\s*320px\)/);
  });

  it("拖拽把手必须盖过 .sidebar 的 z-index:20，否则整条命中带被侧栏吃掉", () => {
    const sidebarBody = ruleBody(sidebarMenusCss, ".sidebar");
    expect(sidebarBody).toBeTruthy();
    const sidebarZ = /z-index:\s*(\d+)/.exec(sidebarBody!);
    expect(sidebarZ).toBeTruthy();

    const handleBody = ruleBody(shellCss, HANDLE_SELECTOR);
    expect(handleBody).toBeTruthy();
    const handleZ = /z-index:\s*(\d+)/.exec(handleBody!);
    expect(handleZ).toBeTruthy();
    expect(Number(handleZ![1])).toBeGreaterThan(Number(sidebarZ![1]));
    // 仍须低于 modal / toast 层，避免把手盖住弹层
    expect(Number(handleZ![1])).toBeLessThan(100);
  });
});
