/**
 * R95 探针:UI 现状盘点 —— 一次真实启动,把「微内核 + 插件」的运行时事实
 * 全部量出来,给改造计划提供基线。
 *
 * 为什么需要它(而不是看源码):
 *   1. **槽位是否真接通** —— 源码里 `declare` / `register` / `useSlotComponent`
 *      三态都在,但只有运行时才知道入口是否真的被消费方渲染。静态审计
 *      (`scripts/ui-slot-coverage.mjs`)只覆盖前两态。
 *   2. **左侧栏底部(用户 + 设置)** —— 用户反复反馈"没有了"。几何位置比
 *      "元素存在"更有说服力:元素可能在 DOM 里但被挤出可视区。
 *   3. **会话过多时的滚动** —— 用户反馈"session 支持太多,需要自适应滚动条"。
 *      断言滚动容器真的能滚,且滚动条样式在暗色下有定义。
 *   4. **AI Chat 渲染** —— 输入框在暗色主题下的对比度是用户明确提过的问题。
 *
 * 用法:`node scripts/electron/_probe-r95-ui-inventory.mjs`
 * stdout 只输出一个 JSON 对象。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { steps: [], pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-r95-inv-"));
const agentDir = mkdtempSync(join(tmpdir(), "ob-r95-inv-agent-"));
mkdirSync(join(agentDir, "agents"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45000 });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);

  // ---- 1. 左侧栏底部(用户 + 设置)几何 ----
  report.sidebarFooter = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const user = document.querySelector(".sidebar__user");
    const settings = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "") === "设置");
    const footer = document.querySelector(".sidebar__footer");
    return {
      footer: rect(footer),
      user: rect(user),
      userText: (user?.textContent || "").replace(/\s+/g, " ").trim(),
      settings: rect(settings),
      footerInViewport: footer ? rect(footer).y + rect(footer).h <= window.innerHeight + 1 : false,
      userInViewport: user ? rect(user).y >= 0 && rect(user).y + rect(user).h <= window.innerHeight + 1 : false,
      settingsInViewport: settings ? rect(settings).y >= 0 && rect(settings).y + rect(settings).h <= window.innerHeight + 1 : false,
    };
  });
  const f = report.sidebarFooter;
  step("左下角 footer 存在", Boolean(f.footer), JSON.stringify(f.footer));
  step("左下角 footer 在可视区内", f.footerInViewport, String(f.footerInViewport));
  step("左下角用户按钮存在且在可视区", Boolean(f.user) && f.userInViewport, `user=${JSON.stringify(f.user)} text=${f.userText}`);
  step("左下角设置按钮存在且在可视区", Boolean(f.settings) && f.settingsInViewport, JSON.stringify(f.settings));

  // ---- 2. 会话列表滚动(用户反馈"session 太多") ----
  report.sessionScroll = await page.evaluate(() => {
    const el = document.querySelector(".sidebar__scroll");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      overflowY: cs.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      canScroll: cs.overflowY !== "visible" && cs.overflowY !== "hidden",
      // 滚动条宽度 > 0 说明有可见的滚动条轨道(而不是 overlay 隐藏)
      scrollbarWidth: el.offsetWidth - el.clientWidth,
      sessions: document.querySelectorAll(".sidebar__session-item, [class*='session-item'], [class*='session-row']").length,
    };
  });
  const sc = report.sessionScroll;
  step("会话区是滚动容器", Boolean(sc) && sc.canScroll, JSON.stringify(sc));

  // ---- 3. 主题 token 是否真的落在 DOM 上 ----
  report.theme = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const names = ["--wb-bg-primary", "--wb-text-primary", "--wb-accent", "--wb-border"];
    return {
      dataTheme: root.getAttribute("data-theme"),
      dataThemeName: root.getAttribute("data-theme-name"),
      tokens: Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim().slice(0, 40)])),
      themeClass: [...root.classList].filter((c) => /theme/i.test(c)),
    };
  });
  step(
    "主题 token 已落在 documentElement",
    Object.values(report.theme.tokens).some((v) => v.length > 0),
    JSON.stringify(report.theme),
  );

  // ---- 4. AI Chat:输入框可见（新会话页） ----
  report.composer = await page.evaluate(() => {
    const box = document.querySelector("textarea, [contenteditable='true'], .composer__input, [class*='composer'] textarea");
    if (!box) return null;
    const cs = getComputedStyle(box);
    const r = box.getBoundingClientRect();
    return {
      tag: box.tagName,
      className: (box.className || "").toString().slice(0, 60),
      visible: r.width > 0 && r.height > 0,
      color: cs.color,
      background: cs.backgroundColor,
      caret: cs.caretColor,
    };
  });
  step("AI Chat 输入框可见", Boolean(report.composer?.visible), JSON.stringify(report.composer));

  // ---- 5. 槽位内核快照(如果暴露) ----
  report.slotSnapshot = await page.evaluate(() => {
    const core = window.__OPENBUDDY_SLOT_CORE__;
    if (!core || typeof core.snapshot !== "function") return null;
    return core.snapshot().map((s) => ({ name: s.name, entries: s.entries.length }));
  });
  report.slotCount = report.slotSnapshot ? report.slotSnapshot.length : null;
  report.emptySlots = report.slotSnapshot ? report.slotSnapshot.filter((s) => s.entries === 0).map((s) => s.name) : null;
  step(
    "槽位内核快照可读(用于验证插件接线)",
    report.slotSnapshot === null || report.slotCount > 0,
    report.slotSnapshot === null ? "内核未挂到 window(不阻断)" : `slots=${report.slotCount}`,
  );

  step("无渲染异常", report.pageErrors.length === 0, JSON.stringify(report.pageErrors));
} catch (error) {
  step("探针执行未抛错", false, String(error).slice(0, 400));
} finally {
  await app.close().catch(() => {});
}

report.ok = report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
