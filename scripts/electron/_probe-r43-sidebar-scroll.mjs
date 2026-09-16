/**
 * R43 真机探针:侧栏任务/空间分组自适应滚动条。
 *
 * 验证 4 件事:
 *   1. `<aside class="sidebar">` 内存在 `.sidebar__scroll` 滚动容器 +
 *      `.sidebar__scroll-inner` 内层,data-testid 也匹配。
 *   2. `.sidebar__scroll` 计算样式:`overflow-y: auto`、`scrollbar-width: thin`、
 *      `flex: 1`(占满 logo/搜索/导航 与 footer 之间的高度)。
 *   3. 内层初始不带 overflow class(没有会话时不显示渐变遮罩)。
 *   4. 默认 1 个任务分组场景下,DOM 布局不破。
 *
 * 截图默认不写盘;OPENBUDDY_PROBE_SHOTS=1 时输出到 tests/screenshots/。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r43-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r43-agent-"));

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) =>
  report.steps.push({ step: name, ok: Boolean(ok), detail });

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

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2500);

  page.on("pageerror", (err) => report.pageErrors.push(String(err)));

  // 关掉首次启动的 onboarding 向导(它会拦截 sidebar 点击)。
  try {
    const closeBtn = page.locator("[data-testid='onboarding-close']").first();
    if (await closeBtn.isVisible({ timeout: 2000 })) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {
    /* not shown */
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // 等侧栏出现
  const aside = page.locator("aside.sidebar").first();
  await aside.waitFor({ state: "visible", timeout: 5000 });
  step("侧栏 (aside.sidebar) 可见", true, "ok");

  // 1+2. 容器结构 + 计算样式
  const layout = await page.evaluate(() => {
    const aside = document.querySelector("aside.sidebar");
    const scroll = aside?.querySelector(".sidebar__scroll");
    const inner = scroll?.querySelector(".sidebar__scroll-inner");
    if (!aside || !scroll || !inner)
      return {
        ok: false,
        hasAside: Boolean(aside),
        hasScroll: Boolean(scroll),
        hasInner: Boolean(inner),
      };
    const cs = getComputedStyle(scroll);
    return {
      ok: true,
      hasAside: true,
      hasScroll: true,
      hasInner: true,
      scrollTestId: scroll.getAttribute("data-testid"),
      innerTestId: inner.getAttribute("data-testid"),
      overflowY: cs.overflowY,
      flex: cs.flex,
      scrollbarWidth: cs.scrollbarWidth,
      overflowTop: inner.classList.contains("sidebar__scroll-inner--overflow-top"),
      overflowBottom: inner.classList.contains("sidebar__scroll-inner--overflow-bottom"),
    };
  });
  step(
    "滚动容器 .sidebar__scroll 挂载 + data-testid 匹配",
    layout.ok && layout.scrollTestId === "sidebar-scroll",
    JSON.stringify(layout),
  );
  step(
    ".sidebar__scroll 计算样式: overflow-y=auto + flex:1 + scrollbar-width=thin",
    layout.overflowY === "auto" &&
      layout.flex.startsWith("1") &&
      layout.scrollbarWidth === "thin",
    JSON.stringify({
      overflowY: layout.overflowY,
      flex: layout.flex,
      scrollbarWidth: layout.scrollbarWidth,
    }),
  );
  step(
    "内层 .sidebar__scroll-inner 挂载 + data-testid 匹配",
    layout.innerTestId === "sidebar-scroll-inner",
    JSON.stringify({ innerTestId: layout.innerTestId }),
  );

  // 3. 默认态(可能 0 会话)内层不带 overflow class
  step(
    "无溢出时内层不带 overflow-top / overflow-bottom class",
    !layout.overflowTop && !layout.overflowBottom,
    JSON.stringify({ overflowTop: layout.overflowTop, overflowBottom: layout.overflowBottom }),
  );

  // 4. 制造溢出:新建 30 个会话 + 滚动验证
  // 通过 IPC 创建真 session,触发 Sidebar 重渲。
  const sessionOverflow = await page.evaluate(async () => {
    const aside = document.querySelector("aside.sidebar");
    const scroll = aside?.querySelector(".sidebar__scroll");
    const inner = scroll?.querySelector(".sidebar__scroll-inner");
    if (!aside || !scroll || !inner) return { ok: false, reason: "no scroll container" };
    // 真实场景:不在探针里造 30 个 session(会污染 userData),
    // 直接调用 store.setState 把 30 条 fake session 塞进去。
    // 但 store 不是 window 全局。我们通过 dispatch scroll 事件,
    // 然后 mock 改 innerHeight 让 scrollHeight > clientHeight。
    Object.defineProperty(scroll, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(scroll, "clientHeight", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(scroll, "scrollTop", {
      value: 0,
      configurable: true,
    });
    scroll.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));
    return {
      ok: true,
      overflowTop: inner.classList.contains("sidebar__scroll-inner--overflow-top"),
      overflowBottom: inner.classList.contains("sidebar__scroll-inner--overflow-bottom"),
    };
  });
  step(
    "scrollTop=0 + 内容溢出:overflow-bottom 出现,overflow-top 不出现",
    sessionOverflow.ok &&
      !sessionOverflow.overflowTop &&
      sessionOverflow.overflowBottom,
    JSON.stringify(sessionOverflow),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r43-sidebar-scroll.png" });
  }

  report.ok = report.steps.every((s) => s.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
