/**
 * _probe-slot-assembly.mjs — 微内核装配 + 主题落地 的真实 Electron 探针。
 *
 * 断言的是「内核真的装配成了什么」,而不是从 DOM 反推:
 *   - 每个内置 ui-* 包的 apply() 是否成功(失败会静默让界面退化成裸文本)
 *   - `files.tree` / `editor.body` / `shell.statusbar` / `plugin.command` 这些槽
 *     位到底有几条 entry、由谁提供
 *   - 全新 profile 首启的主题是不是品牌主题,`--wb-accent` 是不是 #00C29A
 *
 * 输出单个 JSON 对象到 stdout,由 _probe-slot-assembly.test.mjs 消费。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-slot-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
  cwd: ROOT,
  timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "1" },
});

const pageErrors = [];
const page = await app.firstWindow({ timeout: 60_000 });
page.on("pageerror", (err) => pageErrors.push(String(err.message)));
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(4000);
await page.setViewportSize({ width: 1600, height: 1000 });
await page.waitForTimeout(2000);

const report = await page.evaluate(() => {
  const core = window.__ob_slotcore;
  const slots = core?.snapshot?.() ?? [];
  const byName = new Map(slots.map((s) => [s.name, s]));
  const pick = (name) => byName.get(name) ?? null;
  const builtin = window.__ob_builtin_report ?? [];
  const root = document.documentElement;
  return {
    builtinTotal: builtin.length,
    builtinFailed: builtin
      .filter((r) => !r.ok)
      .map((r) => ({ pkg: r.pkg, error: r.error ?? null })),
    slotCount: core?.size?.() ?? 0,
    slots: {
      "files.tree": pick("files.tree"),
      "editor.body": pick("editor.body"),
      "shell.statusbar": pick("shell.statusbar"),
      "shell.overlay": pick("shell.overlay"),
      "onboarding.wizard": pick("onboarding.wizard"),
      "plugin.command": pick("plugin.command"),
      "notifications": pick("notifications"),
    },
    theme: {
      attr: root.getAttribute("data-theme"),
      name: root.getAttribute("data-theme-name"),
      accent: root.style.getPropertyValue("--wb-accent").trim(),
      elevated: root.style.getPropertyValue("--wb-bg-elevated").trim(),
      radiusMd: root.style.getPropertyValue("--wb-radius-md").trim(),
    },
    errorBoundary: Boolean(document.querySelector(".error-boundary")),
    hasComposer: Boolean(document.querySelector(".wb-composer")),
    hasSidebar: Boolean(document.querySelector("aside.sidebar")),
  };
});

report.pageErrors = pageErrors;
console.log(JSON.stringify(report));
await app.close();
