/**
 * _probe-microkernel.mjs — 在真实 Electron 渲染进程里验证微内核装配。
 *
 * 读取 window.__ob_builtin_report（由 registerAllBuiltinUis() 写入），
 * 断言 21 个内置包全部 ok，并检查结构性 slot 都有实现。
 *
 * 用法：node scripts/electron/_probe-microkernel.mjs
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-microkernel-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

const page = await app.firstWindow();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/api\/events\.(mux|host)/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
// 等 SlotProvider 的 effect 跑完 registerAllBuiltinUis()。
await page.waitForFunction(() => Array.isArray(window.__ob_builtin_report), undefined, { timeout: 20_000 });

const result = await page.evaluate(() => {
  const report = window.__ob_builtin_report ?? [];
  const failed = report.filter((r) => !r.ok);
  const noSlots = report.filter((r) => r.ok && r.slotsRegistered === 0).map((r) => r.pkg);
  return {
    total: report.length,
    ok: report.filter((r) => r.ok).length,
    failed: failed.map((r) => ({ pkg: r.pkg, error: r.error })),
    // 这几个包设计上不注册 slot（纯工具/类型/no-op apply）
    noSlots,
    rows: report.map((r) => `${r.pkg} ok=${r.ok} slots=${r.slotsRegistered} [${r.slotNames.join(",")}]`),
    overlays: report.filter((r) => r.slotNames.includes("shell.overlay")).map((r) => r.pkg),
  };
});

// 结构性 slot 是否真的被 AppShell 用上：sidebar / conversation / home 内容非空
const dom = await page.evaluate(() => ({
  sidebar: document.querySelectorAll(".sidebar__nav-item").length,
  appFlex: getComputedStyle(document.querySelector(".app") ?? document.body).display,
  appHeight: (document.querySelector(".app")?.getBoundingClientRect().height ?? 0),
  viewport: window.innerHeight,
  footerVisible: (() => {
    const f = document.querySelector(".sidebar__footer");
    if (!f) return null;
    return Math.round(f.getBoundingClientRect().bottom) <= window.innerHeight + 1;
  })(),
  homeTitle: document.querySelector(".home__title")?.textContent?.trim() ?? null,
  sceneTabs: document.querySelectorAll(".home__scenes .home__scene").length,
}));

console.log("=== 微内核装配报告 ===");
console.log(`total=${result.total} ok=${result.ok}`);
console.log(`failed=${JSON.stringify(result.failed)}`);
console.log(`shell.overlay providers=${JSON.stringify(result.overlays)}`);
for (const row of result.rows) console.log("  " + row);
console.log("=== DOM 检查（slot 提供的 UI 真的渲染了）===");
console.log(JSON.stringify(dom, null, 2));
console.log("=== renderer errors ===");
console.log(errors.length ? errors.join("\n") : "(none)");

const ok =
  result.total === 21 &&
  result.ok === 21 &&
  result.failed.length === 0 &&
  dom.sidebar > 0 &&
  dom.homeTitle !== null &&
  errors.length === 0;

console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");
await app.close();
process.exit(ok ? 0 : 1);
