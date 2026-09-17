import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r91seed-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r91seed-agent-"));

const TITLES = [
  "通过 pi 查看 current_working_directory 的测试",
  "给 OpenBuddy 加个新 Logo",
  "Next.js 优化",
  "帮我找人",
  "你是哪个模型",
  "写一个斐波那契",
  "解释一下量子计算",
  "你是哪个模型",
  "你是谁？",
  "New Chat",
  "New Chat",
  "搜索pi资料,分析搜索相关插件最佳方式实现专家团功能",
  "搜索更多的插件最适合腾讯workbuddy专家团的",
  "为什么每次都弹出引导,引导过了就不需要弹出,需要存储这个状态",
  "使用中文说明目前完成进度百分比,并说明后续计划",
  "分析目前实现的进度,使用中文说明,并说明后续计划",
];

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1252, height: 796 });
  await page.waitForTimeout(2500);
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
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Create N sessions with the same cwd as the agent home, then rename each.
  const result = await page.evaluate(async (titles) => {
    const out = { created: [], errors: [] };
    // OpenBuddy lists sessions under home cwd. Use the agent home as cwd.
    const api = window.api;
    let cwd = "";
    try { cwd = await api.invoke("agent:current-cwd"); } catch (e) { cwd = ""; }
    if (!cwd) cwd = window.location.origin ?? null;
    // Create session
    for (let i = 0; i < titles.length; i++) {
      let sessionId;
      try {
        sessionId = await api.invoke("session.create", { cwd: cwd || undefined });
      } catch (e) {
        out.errors.push(`create[${i}]: ${String(e).slice(0, 80)}`);
        continue;
      }
      try {
        await api.invoke("session.rename", { sessionId, title: titles[i], cwd: cwd || undefined });
      } catch (e) {
        out.errors.push(`rename[${i}]: ${String(e).slice(0, 80)}`);
      }
      out.created.push(sessionId);
    }
    out.cwd = cwd;
    return out;
  }, TITLES);
  console.log("SEED", JSON.stringify(result));
  await page.waitForTimeout(800);

  // Force the sidebar to refresh by hitting Escape and toggling a nav tab
  await page.locator(".sidebar__nav-item", { hasText: "新建任务" }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator(".sidebar__nav-item", { hasText: "助理" }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator(".sidebar__nav-item", { hasText: "助理" }).first().click().catch(() => {});
  await page.waitForTimeout(1500);

  const audit = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cs = (el) => el ? getComputedStyle(el) : null;
    const aside = document.querySelector("aside.sidebar");
    const rows = Array.from(document.querySelectorAll(".sidebar__conv"));
    const titleEls = Array.from(document.querySelectorAll(".sidebar__conv-title"));
    const wrappedTitles = titleEls.map((t) => {
      const c = cs(t);
      const r = t.getBoundingClientRect();
      const lh = parseFloat(c.lineHeight || "99");
      return { text: (t.textContent || "").trim().slice(0, 32), h: Math.round(r.height), lh, w: Math.round(r.width), wrap: r.height > lh + 3 };
    });
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      aside: { rect: rect(aside), w: aside ? cs(aside).width : null },
      rowCount: rows.length,
      rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
      rowWidths: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().width)))],
      wrappedTitles: wrappedTitles.filter((t) => t.wrap),
      wrappedCount: wrappedTitles.filter((t) => t.wrap).length,
      footer: rect(document.querySelector(".sidebar__footer")),
      scroll: rect(document.querySelector(".sidebar__scroll")),
      sectionLabels: Array.from(document.querySelectorAll(".sidebar__section-label")).map((s) => s.textContent?.trim()),
    };
  });
  console.log("AUDIT", JSON.stringify(audit, null, 2));
  await page.screenshot({ path: "/tmp/r91-sidebar-seeded.png", clip: { x: 0, y: 0, width: 360, height: 796 } });
  await page.screenshot({ path: "/tmp/r91-full-seeded.png" });
} finally { await app.close(); }
