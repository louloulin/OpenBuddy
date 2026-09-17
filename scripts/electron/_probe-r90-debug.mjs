import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r90d-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r90d-agent-"));
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
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
    window.localStorage.removeItem("expertsRoot");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/tmp/r90d-pre-nav.png" });
  const nav = page.locator(".sidebar__nav-item", { hasText: "专家" }).first();
  console.log("nav count:", await nav.count(), "nav text:", await nav.first().textContent().catch(()=>null));
  if (await nav.count() > 0) {
    await nav.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "/tmp/r90d-post-nav.png" });
    const active = await page.evaluate(() => ({
      url: location.href,
      activeSidebar: document.querySelector(".sidebar__nav-item--active")?.textContent?.trim() ?? null,
      umPage: !!document.querySelector(".um-page"),
      ecPage: !!document.querySelector(".ec-page-split"),
      ecEmpty: document.querySelector(".ec-empty")?.textContent?.trim() ?? null,
      ecLoading: document.querySelector(".ec-loading")?.textContent?.trim() ?? null,
      ecScene: document.querySelectorAll(".ec-scene-card").length,
      ecGrid: document.querySelectorAll(".ec-card").length,
      ecSource: document.querySelector(".ec-source-label")?.textContent?.trim() ?? null,
      ecChips: Array.from(document.querySelectorAll(".ec-chips .um-chip, .ec-chips button")).map(b => b.textContent.trim()),
      bodyTitle: document.title,
      mainHash: location.hash,
    }));
    console.log("ACTIVE:", JSON.stringify(active, null, 2));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "/tmp/r90d-after-3s.png" });
    const after = await page.evaluate(() => ({
      ecGrid: document.querySelectorAll(".ec-card").length,
      ecLoading: document.querySelector(".ec-loading")?.textContent?.trim() ?? null,
      ecSource: document.querySelector(".ec-source-label")?.textContent?.trim() ?? null,
      ecEmpty: document.querySelector(".ec-empty")?.textContent?.trim() ?? null,
    }));
    console.log("AFTER 3s:", JSON.stringify(after, null, 2));
  }
} finally { await app.close(); }
