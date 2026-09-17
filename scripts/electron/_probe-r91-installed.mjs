import { _electron as electron } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const APP = "/Applications/OpenBuddy.app/Contents/MacOS/OpenBuddy";
const userData = join(process.env.HOME, "Library", "Application Support", "OpenBuddy-dev");
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, "--no-sandbox"],
  executablePath: APP, cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1252, height: 796 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({ version:1, status:"done", index:2, steps:[{id:"welcome",status:"done"},{id:"first-task",status:"done"},{id:"done",status:"done"}], startedAt:Date.now(), updatedAt:Date.now(), completedAt:Date.now() }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  const audit = await page.evaluate(() => {
    const aside = document.querySelector("aside.sidebar");
    const rows = Array.from(document.querySelectorAll(".sidebar__conv"));
    const titleEls = Array.from(document.querySelectorAll(".sidebar__conv-title"));
    const wrapped = titleEls.map((t) => {
      const c = getComputedStyle(t);
      const r = t.getBoundingClientRect();
      const lh = parseFloat(c.lineHeight || "99");
      return { text: (t.textContent || "").trim().slice(0, 28), h: Math.round(r.height), lh, ws: c.whiteSpace, wrap: r.height > lh + 3 };
    });
    const r0 = rows[0]?.getBoundingClientRect();
    const t0 = titleEls[0]?.getBoundingClientRect();
    return {
      appVersion: document.querySelector(".sidebar__version")?.textContent,
      asideW: aside ? Math.round(aside.getBoundingClientRect().width) : null,
      rowCount: rows.length,
      rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
      wrapped: wrapped.filter((t) => t.wrap).slice(0, 5),
      wrappedCount: wrapped.filter((t) => t.wrap).length,
      firstTitle: titleEls[0]?.textContent,
      firstTitleWidth: t0 ? Math.round(t0.width) : null,
      firstRowWidth: r0 ? Math.round(r0.width) : null,
      firstRowOverflowX: r0 ? Math.round(r0.right - (aside?.getBoundingClientRect().right ?? 0)) : null,
    };
  });
  console.log(JSON.stringify(audit, null, 2));
  await page.screenshot({ path: "/tmp/r91-installed-sidebar.png", clip: { x: 0, y: 0, width: 360, height: 796 } });
  await page.screenshot({ path: "/tmp/r91-installed-full.png" });
} finally { await app.close(); }
