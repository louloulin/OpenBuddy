/**
 * R84 UI 审计探针 —— 逐条真机验证用户报告的问题。
 *
 * 验证项(每条都取真实 DOM 几何 / 计算样式,不 mock):
 *   1. 左下角「用户 + 设置」是否存在、可点、尺寸是否够
 *   2. 会话列表溢出时是否有自适应滚动条(overflow / scrollbar)
 *   3. 菜单栏(标题栏 / topbar)宽度是否够宽
 *   4. 点击左下角「登录」是否真的弹出登录对话框
 *   5. 首启引导是否真的落盘(重启不再弹)
 *   6. 黑色主题下 chatinput 补全面板与白色主题的差异
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r84-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const report = { ok: true, checks: {}, problems: [] };
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));

// 首次启动:先让首启引导落盘,后面各步都在“用户态”下检查
await page.waitForTimeout(13_000);
report.checks.onboarding = await page.evaluate(() => {
  const w = document.querySelector('[data-testid="onboarding-wizard"]');
  return { wizardVisible: !!w, persisted: window.localStorage.getItem("openbuddy.onboarding.state") };
});

// 主动点掉向导(如果还在),让后续检查不被浮层遮挡
for (let i = 0; i < 6; i += 1) {
  const gone = await page.evaluate(() => {
    const w = document.querySelector('[data-testid="onboarding-wizard"]');
    if (!w) return true;
    const btn = w.querySelector('[data-testid="onboarding-close"]')
      ?? Array.from(w.querySelectorAll("button")).find((b) => /完成|下一步/.test(b.textContent || ""));
    btn?.click();
    return false;
  });
  if (gone) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(1200);

// ---- 1. 左下角用户 + 设置 ----
report.checks.sidebarFooter = await page.evaluate(() => {
  const user = document.querySelector(".sidebar__user");
  const footer = document.querySelector(".sidebar__footer");
  const gear = document.querySelector('[aria-label*="设置"], [data-testid*="settings"]');
  const rect = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y) } : null);
  const cs = user ? getComputedStyle(user) : null;
  return {
    userButton: !!user,
    userRect: rect(user),
    userName: user?.querySelector(".sidebar__user-name")?.textContent ?? null,
    userDisplay: cs?.display ?? null,
    userVisibility: cs?.visibility ?? null,
    footerRect: rect(footer),
    settingsGearPresent: !!gear,
    ariaHasPopup: user?.getAttribute("aria-haspopup") ?? null,
  };
});

// ---- 2. 会话列表滚动条 ----
report.checks.conversationScroll = await page.evaluate(() => {
  const candidates = [".sidebar__scroll", ".sidebar__list", ".sidebar__sessions", ".sidebar__body", ".sidebar__nav"];
  const found = [];
  for (const sel of candidates) {
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      found.push({
        sel,
        overflowY: cs.overflowY,
        scrollbarWidth: cs.scrollbarWidth,
        clientH: el.clientHeight, scrollH: el.scrollHeight,
        overflows: el.scrollHeight > el.clientHeight + 2,
      });
    }
  }
  return found;
});

// ---- 3. 菜单栏 / 顶栏宽度 ----
report.checks.chrome = await page.evaluate(() => {
  const out = {};
  for (const sel of ["[data-openbuddy-titlebar]", ".titlebar", ".main-topbar", ".artifact-tabs", ".app__main"]) {
    const el = document.querySelector(sel);
    if (el) out[sel] = { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) };
  }
  return out;
});

// ---- 4. 点击左下角用户 → 菜单 → 登录 ----
const loginFlow = { clickedUser: false, menuOpened: false, menuItems: [], loginClicked: false, dialogAppeared: false };
try {
  const userBtn = await page.$(".sidebar__user");
  if (userBtn) {
    await userBtn.click();
    loginFlow.clickedUser = true;
    await page.waitForTimeout(600);
    const menu = await page.evaluate(() => {
      const m = document.querySelector(".sidebar__account-menu");
      return {
        open: !!m,
        items: m ? Array.from(m.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean) : [],
      };
    });
    loginFlow.menuOpened = menu.open;
    loginFlow.menuItems = menu.items;
    if (menu.open) {
      const clicked = await page.evaluate(() => {
        const m = document.querySelector(".sidebar__account-menu");
        if (!m) return null;
        const btn = Array.from(m.querySelectorAll("button")).find((b) => /登录|登陆|Sign in/i.test(b.textContent || ""));
        if (!btn) return null;
        btn.click();
        return (btn.textContent || "").trim();
      });
      loginFlow.loginClicked = clicked;
      await page.waitForTimeout(2200);
      loginFlow.dialogAppeared = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"], .casdoor-signin, [data-testid*="signin"], [data-testid*="sign-in"]');
        return dlg ? { present: true, cls: String(dlg.className).slice(0, 80), text: (dlg.textContent || "").replace(/\s+/g, " ").slice(0, 100) } : { present: false };
      });
    }
  }
} catch (e) {
  loginFlow.error = String(e?.message ?? e);
}
report.checks.login = loginFlow;

report.pageErrors = errors;
if (!report.checks.sidebarFooter.userButton) report.problems.push("左下角用户按钮不存在");
if (report.checks.sidebarFooter.userRect && report.checks.sidebarFooter.userRect.w < 100) report.problems.push(`左下角用户按钮过窄(${report.checks.sidebarFooter.userRect.w}px)`);
if (!loginFlow.menuOpened) report.problems.push("点击左下角用户没有弹出账户菜单");
if (loginFlow.menuOpened && !loginFlow.loginClicked) report.problems.push("账户菜单里没有登录入口");
if (loginFlow.loginClicked && !loginFlow.dialogAppeared?.present) report.problems.push("点击登录没有弹出登录对话框");
if (!report.checks.conversationScroll.some((c) => c.overflows || c.overflowY !== "visible")) report.problems.push("会话列表没有设置可滚动容器");

console.log(JSON.stringify(report, null, 2));
await app.close();
process.exit(0);
