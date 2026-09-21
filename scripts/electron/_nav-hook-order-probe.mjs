/**
 * LUM-1321 诊断探针 —— 在**打包后的 app**(win-unpacked)里复现/验证
 * LUM-1315 报出的 P0:侧边栏在「邮件」与其它面板之间往返切换时,React
 * 抛 hook 顺序错误(#300/#310),工作台掉进 ErrorBoundary(「工作台视图出现错误」)。
 *
 * 用法:
 *   node scripts/electron/_nav-hook-order-probe.mjs <OpenBuddy.exe> <out.json> <shotDir> [label...]
 *
 * 输出(UTF-8 JSON):导航项列表、每一步的可见文本 / activeNav / 是否出现
 * ErrorBoundary、以及全部 console error / page error。另存每一步截图。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [exePath, outJson, shotDir, ...rawTargets] = process.argv.slice(2);
const targets = rawTargets.length ? rawTargets : ["邮件", "项目", "邮件", "项目"];
const ERROR_TEXT = "工作台视图出现错误";

const consoleErrors = [];
const pageErrors = [];
const steps = [];

const userData = mkdtempSync(join(tmpdir(), "ob-lum1321-"));
mkdirSync(shotDir, { recursive: true });

const app = await electron.launch({
  executablePath: exePath,
  args: [`--user-data-dir=${userData}`],
  timeout: 90_000,
});

const page = await app.firstWindow();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push({ where: "console", text: msg.text() });
});
page.on("pageerror", (err) => pageErrors.push({ where: "pageerror", text: String(err && err.message ? err.message : err) }));
app.on("window", (w) => {
  w.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ where: "console(win)", text: msg.text() });
  });
  w.on("pageerror", (err) => pageErrors.push({ where: "pageerror(win)", text: String(err && err.message ? err.message : err) }));
});

await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.api && window.api.apiVersion === 1), undefined, { timeout: 60_000 });
await page.waitForTimeout(3500);

// 首次启动的引导浮层会盖住侧边栏。
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

const navItems = await page.$$eval(".sidebar__nav-item", (els) => els.map((e) => e.textContent.trim()));
const navCount = navItems.length;

async function snapshot(name) {
  const state = await page.evaluate((errText) => {
    const active = document.querySelector(".sidebar__nav-item--act");
    const body = document.body.innerText || "";
    return {
      activeNav: active ? active.textContent.trim() : null,
      errorBoundary: body.includes(errText),
      bodyHead: body.replace(/\s+/g, " ").slice(0, 260),
    };
  }, ERROR_TEXT);
  const shot = join(shotDir, `${name}.png`);
  await page.screenshot({ path: shot }).catch(() => {});
  return { ...state, shot };
}

if (navCount === 0) {
  const fallback = await snapshot("no-sidebar");
  writeFileSync(
    outJson,
    JSON.stringify({ exePath, navItems, navCount, steps: [{ label: "<no sidebar>", ...fallback }], consoleErrors, pageErrors }, null, 2),
    "utf8",
  );
  await app.close();
  process.exit(0);
}

steps.push({ label: "<first window>", ...(await snapshot("00-first-window")) });

for (const target of targets) {
  const idx = navItems.findIndex((t) => t === target);
  const partial = idx === -1 ? navItems.findIndex((t) => t.includes(target)) : idx;
  const clickIdx = idx !== -1 ? idx : partial;
  if (clickIdx === -1) {
    steps.push({ label: target, missing: true, navItems });
    continue;
  }
  try {
    await page.locator(".sidebar__nav-item").nth(clickIdx).click({ timeout: 10_000 });
  } catch (e) {
    steps.push({ label: target, clickError: String(e && e.message ? e.message : e) });
  }
  await page.waitForTimeout(1500);
  steps.push({ label: target, navText: navItems[clickIdx], ...(await snapshot(`${String(steps.length).padStart(2, "0")}-${clickIdx}`)) });
}

writeFileSync(outJson, JSON.stringify({ exePath, userData, navItems, navCount, steps, consoleErrors, pageErrors }, null, 2), "utf8");
await app.close();
process.exit(0);
