/**
 * R91 真机探针:侧栏会话行几何契约。
 *
 * 背景:用户反复反馈「会话多了以后左侧列表样式错位」——长标题折行、行高
 * 不齐、底部账户/设置区被滚动区压住。光看 CSS 看不出问题(flex 子项的
 * `min-width: auto` 默认值会盖掉父级 `overflow: hidden`,只在内容超宽时
 * 才暴露),所以这里用真机 + 真实渲染几何做断言。
 *
 * 要证的 4 件事(全部读 getBoundingClientRect,不看源码):
 *   1. 长中文标题 + 长英文标题的会话行,高度必须一律 30px(不折行)。
 *      折行会让某一行的 `height > lineHeight`,这条能直接抓到。
 *   2. 所有会话行宽度一致(不会某行被内容撑宽而错位)。
 *   3. 底部 footer 与滚动区不重叠(footer.top >= scroll.bottom)。
 *   4. footer 里账户/设置入口真实可点(用户曾反馈「左下角不见了」)。
 *
 * 会话数据靠 IPC 现造:`agent:new-session` 建会话 + `sessions:rename` 改名。
 * 只用磁盘 fixture 造不出来 —— main 侧的 `listSessions` 会过滤掉
 * `messageCount === 0` 的空壳会话。
 *
 * 跑前先 `pnpm exec electron-vite build`。截图落 /tmp/r91-sidebar-geom.png。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r91-geom-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r91-geom-agent-"));

/** Deliberately hostile titles: the CJK one is far wider than the 320px
 *  sidebar, the ASCII ones have no spaces to break at. */
const TITLES = [
  "通过 pi 查看 current_working_directory 的完整测试用例与边界条件",
  "给 OpenBuddy 做一套不依赖外部数据目录的内置专家包",
  "supercalifragilisticexpialidocious_without_any_breakable_spaces_at_all",
  "Next.js 优化",
  "帮我找人",
  "你是哪个模型",
  "写一个斐波那契",
  "解释一下量子计算",
  "为什么每次都弹出引导,引导过了就不需要弹出,需要存储这个状态",
  "使用中文说明目前完成进度百分比,并说明后续计划",
  "New Chat",
  "New Chat",
];

const report = { steps: [], ok: false, pageErrors: [], geometry: null };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  // The user's screenshot is a 2504x1592 window; at dpr 1 that is ~1252x796 CSS.
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
  await page.waitForTimeout(400);

  // --- seed sessions through the real IPC surface -------------------------
  const seeded = await page.evaluate(async (titles) => {
    const api = window.api;
    const created = [];
    const errors = [];
    // `agent:new-session` returns the session's own cwd — that is the one the
    // rename handler needs, because the host resolves the session file from it.
    let cwd = "";
    for (const title of titles) {
      try {
        const session = await api.invoke("agent:new-session", cwd ? { cwd } : {});
        const sessionId = session?.sessionId ?? session?.id;
        if (!sessionId) { errors.push(`no sessionId for "${title.slice(0, 12)}"`); continue; }
        if (!cwd && typeof session?.cwd === "string") cwd = session.cwd;
        await api.invoke("sessions:rename", { sessionId, title, cwd });
        created.push(sessionId);
      } catch (error) {
        errors.push(`${String(error).slice(0, 70)}`);
      }
    }
    return { created: created.length, errors: errors.slice(0, 3) };
  }, TITLES);
  report.seeded = seeded;
  step("通过 IPC 种下多会话", seeded.created >= 4, JSON.stringify(seeded));
  await page.waitForTimeout(1200);

  // --- geometry contract ---------------------------------------------------
  const geometry = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
    const rows = Array.from(document.querySelectorAll(".sidebar__conv"));
    const titles = Array.from(document.querySelectorAll(".sidebar__conv-title"));
    const scroll = document.querySelector(".sidebar__scroll");
    const footer = document.querySelector(".sidebar__footer");
    const user = document.querySelector(".sidebar__user");
    const lineHeight = titles[0] ? parseFloat(getComputedStyle(titles[0]).lineHeight || "0") : 0;
    return {
      rowCount: rows.length,
      rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))].sort((a, b) => a - b),
      rowWidths: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().width)))].sort((a, b) => a - b),
      titleLineHeight: lineHeight,
      // A wrapped title is taller than one line box. Guard on the box, not the
      // computed style, because `white-space: nowrap` is exactly what we are
      // trying to prove is in effect.
      wrappedTitles: titles
        .filter((t) => t.getBoundingClientRect().height > lineHeight + 3)
        .map((t) => ({ text: (t.textContent || "").trim().slice(0, 28), h: Math.round(t.getBoundingClientRect().height), lineHeight })),
      scroll: rect(scroll),
      footer: rect(footer),
      user: rect(user),
      // Every row must fit inside the sidebar without clipping the tail.
      rowsOverflowRight: rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length,
      accountMenuOpens: null,
    };
  });

  // --- the footer affordance must actually work ----------------------------
  let menuOpened = false;
  try {
    await page.locator(".sidebar__user").first().click({ timeout: 4000 });
    await page.waitForTimeout(400);
    menuOpened = await page.evaluate(() => Boolean(document.querySelector(".sidebar__account-menu, .sidebar__account-menu--portal")));
    await page.keyboard.press("Escape");
  } catch { /* leave false; the assertion below reports it */ }
  geometry.accountMenuOpens = menuOpened;
  report.geometry = geometry;

  const heights = geometry.rowHeights;
  step("侧栏真的渲染出多条会话", geometry.rowCount >= 4, `rowCount=${geometry.rowCount}`);
  step("所有会话行等高(30px),无折行", heights.length === 1 && heights[0] === 30, `rowHeights=[${heights.join(",")}]`);
  step("折行标题为 0", geometry.wrappedTitles.length === 0, JSON.stringify(geometry.wrappedTitles));
  step("会话行宽度一致", geometry.rowWidths.length === 1, `rowWidths=[${geometry.rowWidths.join(",")}]`);
  step(
    "footer 与滚动区不重叠",
    Boolean(geometry.footer && geometry.scroll) && geometry.footer.top >= geometry.scroll.bottom - 1,
    `footer.top=${geometry.footer?.top} scroll.bottom=${geometry.scroll?.bottom}`,
  );
  step("左下角账户入口可见", Boolean(geometry.user && geometry.user.h > 0), JSON.stringify(geometry.user));
  step("点击左下角弹出账户菜单", menuOpened === true, `menuOpened=${menuOpened}`);

  if (process.env.OPENBUDDY_PROBE_SHOTS === "1") {
    await page.screenshot({ path: "/tmp/r91-sidebar-geom.png" });
  }
} finally {
  await app.close();
}

report.ok = report.pageErrors.length === 0 && report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
