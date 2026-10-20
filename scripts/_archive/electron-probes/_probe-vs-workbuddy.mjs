/**
 * Phase 7 — WorkBuddy 对齐的 DOM 探针脚本(A13)。
 *
 * 与 _diag-quick.mjs 共享启动框架;不一样的这一步要:
 *   1. home 视图断言右栏 (.app__right-panel 或 .home-overview-panel) 出现;
 *   2. 断言 `.status-bar` 出现且包含 4 个 `.status-bar__item`;
 *   3. sidebar 项目 tab → 断言 `.project-templates-panel` 出现 + 5 张模板卡;
 *   4. sidebar 专家 tab → 断言 `.experts-grid` 出现 + 9 张 expert 卡;
 *   5. 任何 PAGEERROR 都计为失败。
 *
 * 不抛,而是把失败累积,最后 exit = 失败数 > 0 ? 1 : 0。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-vs-wb-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

console.log("[probe-vs-workbuddy] launching electron...");
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--enable-logging"],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});

const pageErrors = [];
const page = await app.firstWindow({ timeout: 30_000 });
page.on("pageerror", (err) => pageErrors.push(err.message));

// 给 main + renderer 充足的启动时间(renderer 包括 slot 装配 / theme init / chat
// boot 都比较重),然后等 home overview 出现(或者超时)。
await page.waitForTimeout(15_000);
try {
  await page.waitForSelector(".status-bar", { timeout: 15_000 });
} catch {
  // 继续执行,后续断言会把 missing 项计为 false
}

const results = {};
let failed = 0;
function check(name, value, expect) {
  const ok = value === expect;
  results[name] = { value, expect, ok };
  if (!ok) failed += 1;
}

async function clickNav(label) {
  const tab = page.locator(`.sidebar button:has-text("${label}")`).first();
  await tab.click({ timeout: 5_000 });
  await page.waitForTimeout(1_500);
}

// 1) Home / right panel
const home = await page.evaluate(() => ({
  rightPanelExists: !!document.querySelector(".app__right-panel, .home-overview-panel"),
  statusBarExists: !!document.querySelector(".status-bar"),
  statusItems: document.querySelectorAll(".status-bar__mode, .status-bar__model, .status-bar__workspace, .status-bar__network").length,
}));
check("rightPanelExists", home.rightPanelExists, true);
check("statusBarExists", home.statusBarExists, true);
check("statusItems", home.statusItems, 4);

// 2) 项目 tab → ProjectTemplatesPanel
await clickNav("项目");
const project = await page.evaluate(() => ({
  templatesPanelExists: !!document.querySelector(".project-templates-panel"),
  templateCards: document.querySelectorAll(".project-template-card").length,
}));
check("projectTemplatesPanelExists", project.templatesPanelExists, true);
check("projectTemplates", project.templateCards, 5);

// 3) 专家·技能·连接器 tab → ExpertsGrid
await clickNav("专家·技能·连接器");
const experts = await page.evaluate(() => ({
  expertsGridExists: !!document.querySelector(".experts-grid"),
  expertCards: document.querySelectorAll(".expert-card").length,
}));
check("expertsGridExists", experts.expertsGridExists, true);
check("experts", experts.expertCards, 9);

console.log("\n[probe-vs-workbuddy] ===== RESULTS =====");
console.log(JSON.stringify(results, null, 2));
console.log(`pageErrors: ${pageErrors.length}`);
if (pageErrors.length > 0) {
  console.log(pageErrors.slice(0, 5).join("\n"));
}

await app.close();
if (failed > 0 || pageErrors.length > 0) {
  console.error(`[probe-vs-workbuddy] FAIL: ${failed} assertion(s) failed; ${pageErrors.length} pageErrors`);
  process.exit(1);
}
console.log("[probe-vs-workbuddy] PASS");
