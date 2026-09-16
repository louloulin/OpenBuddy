import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r42-deep-"));
const agentDir = mkdtempSync(join(tmpdir(), "ob-r42-deep-agent-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_AGENT_DIR: agentDir,
  },
});

const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.setViewportSize({ width: 1600, height: 1000 });
await page.waitForTimeout(2500);

try {
  const closeBtn = page.locator("[data-testid='onboarding-close']").first();
  if (await closeBtn.isVisible({ timeout: 2000 })) await closeBtn.click();
  await page.waitForTimeout(500);
} catch { /* not shown */ }

const target = page.locator(".sidebar__nav-item", { hasText: "专家·技能·连接器" }).first();
await target.waitFor({ state: "visible", timeout: 5000 });
await target.click();
await page.waitForTimeout(2500);

await page.screenshot({ path: "/tmp/r42-layout.png", fullPage: false });

const dump = await page.evaluate(() => {
  const split = document.querySelector("[data-testid='experts-page-split']");
  const tasks = document.querySelector("[data-testid='tasks-panel']");
  const main = document.querySelector(".ec-page-main");
  const grid = document.querySelector(".ec-page-main .ec-grid");
  const pills = Array.from(document.querySelectorAll(".um-pill[aria-selected='true']"))
    .map((el) => el.textContent?.trim());
  const cards = document.querySelectorAll(".ec-card");

  const splitRect = split?.getBoundingClientRect();
  const tasksRect = tasks?.getBoundingClientRect();
  const mainRect = main?.getBoundingClientRect();
  const gridRect = grid?.getBoundingClientRect();

  const splitStyles = split ? {
    gridTemplateColumns: getComputedStyle(split).gridTemplateColumns,
    display: getComputedStyle(split).display,
    gap: getComputedStyle(split).gap,
  } : null;

  const gridStyles = grid ? {
    gridTemplateColumns: getComputedStyle(grid).gridTemplateColumns,
    display: getComputedStyle(grid).display,
  } : null;

  return {
    pillSelected: pills,
    hasSplit: Boolean(split),
    hasTasks: Boolean(tasks),
    hasMain: Boolean(main),
    hasGrid: Boolean(grid),
    cardCount: cards.length,
    splitStyles,
    gridStyles,
    splitRect: splitRect ? { x: splitRect.x, y: splitRect.y, w: splitRect.width, h: splitRect.height } : null,
    tasksRect: tasksRect ? { x: tasksRect.x, y: tasksRect.y, w: tasksRect.width, h: tasksRect.height } : null,
    mainRect: mainRect ? { x: mainRect.x, y: mainRect.y, w: mainRect.width, h: mainRect.height } : null,
    gridRect: gridRect ? { x: gridRect.x, y: gridRect.y, w: gridRect.width, h: gridRect.height } : null,
  };
});

writeFileSync("/tmp/r42-dom-dump.json", JSON.stringify(dump, null, 2));
console.log(JSON.stringify(dump, null, 2));
await app.close();
