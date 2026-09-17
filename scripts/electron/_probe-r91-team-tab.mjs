import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r91team-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r91team-agent-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({ version:1, status:"done", index:2, steps:[{id:"welcome",status:"done"},{id:"first-task",status:"done"},{id:"done",status:"done"}], startedAt:Date.now(), updatedAt:Date.now(), completedAt:Date.now() }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
    window.localStorage.removeItem("expertsRoot");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.locator(".sidebar__nav-item", { hasText: "专家" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ec-card").length >= 5, undefined, { timeout: 20_000 });
  await page.waitForTimeout(1200);

  // Click the 专家团 segment tab
  const teamTab = page.locator(".ec-list-tabs .um-segment-item", { hasText: "专家团" }).first();
  console.log("teamTab count:", await teamTab.count());
  await teamTab.click();
  await page.waitForTimeout(2000);

  const dump = await page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll(".ec-list-tabs .um-segment-item")).map((t) => ({ text: t.textContent?.trim(), aria: t.getAttribute("aria-selected"), cls: t.className })),
    cards: Array.from(document.querySelectorAll(".ec-card")).map((c) => ({
      title: c.querySelector(".ec-card-title")?.textContent?.trim() ?? null,
      ribbon: c.querySelector(".ec-card-ribbon, .ec-card-ribbon span")?.textContent?.trim() ?? null,
      cls: c.className,
    })),
    empty: document.querySelector(".ec-empty")?.textContent?.trim()?.slice(0, 80) ?? null,
    chips: Array.from(document.querySelectorAll(".ec-chips button")).map((b) => b.textContent?.trim()),
  }));
  console.log(JSON.stringify(dump, null, 2));
  await page.screenshot({ path: "/tmp/r91-team-tab.png" });
} finally { await app.close(); }
