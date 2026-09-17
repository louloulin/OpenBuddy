// Boot the installed app (Sep 16 23:14 build) and seed many long-title sessions, then audit.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r91repro-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r91repro-agent-"));

// Seed a Pi sessions.json with the titles we see in the user's screenshot, so
// the agentHost.listSessions() returns ~12 rows of long CJK titles.
const titles = [
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
  "搜索pi资料",
];
writeFileSync(join(agentDir, "sessions.json"), JSON.stringify({
  version: 1,
  sessions: titles.map((t, i) => ({
    id: `seed-${i}`,
    title: t,
    cwd: agentDir,
    createdAt: Date.now() - (i + 1) * 60_000,
    updatedAt: Date.now() - (i + 1) * 30_000,
    archived: false,
    pinned: i === 0,
  })),
}, null, 2));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});
const problems = [];
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

  const audit = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cs = (el) => el ? getComputedStyle(el) : null;
    const dump = (el) => el ? {
      cls: el.className?.toString?.().slice(0, 60),
      rect: rect(el),
      display: cs(el).display, whiteSpace: cs(el).whiteSpace, overflow: cs(el).overflow,
      textOverflow: cs(el).textOverflow, height: cs(el).height, fontSize: cs(el).fontSize,
      text: (el.textContent || "").trim().slice(0, 40),
    } : null;
    const aside = document.querySelector("aside.sidebar");
    const rows = Array.from(document.querySelectorAll(".sidebar__conv"));
    const titleEls = Array.from(document.querySelectorAll(".sidebar__conv-title"));
    const wrappedTitles = titleEls.map((t) => {
      const c = cs(t);
      const r = t.getBoundingClientRect();
      const lh = parseFloat(c.lineHeight || "99");
      return { text: (t.textContent || "").trim().slice(0, 30), h: Math.round(r.height), lh, w: Math.round(r.width), wrap: r.height > lh + 3 };
    });
    const footer = document.querySelector(".sidebar__footer");
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      aside: dump(aside),
      footer: dump(footer),
      footerRect: rect(footer),
      rowCount: rows.length,
      rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
      rowWidths: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().width)))],
      rowSample: rows.slice(0, 3).map(dump),
      wrappedTitles: wrappedTitles.filter((t) => t.wrap),
    };
  });
  console.log(JSON.stringify(audit, null, 2));
  await page.screenshot({ path: "/tmp/r91-sidebar-repro.png", clip: { x: 0, y: 0, width: 320, height: 796 } });
  await page.screenshot({ path: "/tmp/r91-full-repro.png" });
} finally { await app.close(); }
