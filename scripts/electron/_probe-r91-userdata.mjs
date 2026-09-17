import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = join(process.env.HOME, "Library", "Application Support", "OpenBuddy-dev");
// Use the user's real session storage at ~/.openbuddy/agent by NOT overriding it.
mkdirSync(userData, { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const problems = [];
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1252, height: 796 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await page.waitForTimeout(3500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  const audit = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cs = (el) => el ? getComputedStyle(el) : null;
    const aside = document.querySelector("aside.sidebar");
    const rows = Array.from(document.querySelectorAll(".sidebar__conv"));
    const titleEls = Array.from(document.querySelectorAll(".sidebar__conv-title"));
    const wrapped = titleEls.map((t) => {
      const c = cs(t);
      const r = t.getBoundingClientRect();
      const lh = parseFloat(c.lineHeight || "99");
      return { text: (t.textContent || "").trim().slice(0, 30), h: Math.round(r.height), lh, ws: c.whiteSpace, w: Math.round(r.width), wrap: r.height > lh + 3 };
    });
    const footer = document.querySelector(".sidebar__footer");
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      aside: { rect: rect(aside) },
      rowCount: rows.length,
      rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
      rowWidths: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().width)))],
      wrapped: wrapped.filter((t) => t.wrap).slice(0, 5),
      wrappedCount: wrapped.filter((t) => t.wrap).length,
      footer: rect(footer),
      scroll: rect(document.querySelector(".sidebar__scroll")),
      sectionLabels: Array.from(document.querySelectorAll(".sidebar__section-label")).map((s) => s.textContent?.trim()),
      firstFewRowTexts: rows.slice(0, 4).map((r) => r.querySelector(".sidebar__conv-title")?.textContent?.trim()?.slice(0, 30)),
    };
  });
  console.log(JSON.stringify(audit, null, 2));
  await page.screenshot({ path: "/tmp/r91-real-sidebar.png", clip: { x: 0, y: 0, width: 360, height: 796 } });
  await page.screenshot({ path: "/tmp/r91-real-full.png" });
} finally { await app.close(); }
