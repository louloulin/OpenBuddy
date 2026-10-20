/** 全面审计当前 OpenBuddy 渲染状态：
 *  - 全部 nav item
 *  - 全部 panel 入口
 *  - 全部 placeholder
 *  - 关键 console 错误
 *  - 主题/侧栏/底部按钮完整性
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-aud-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(4000);

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const audit = await page.evaluate(() => {
  const root = document.documentElement;
  return {
    theme: {
      dataTheme: root.getAttribute("data-theme"),
      dataThemeName: root.getAttribute("data-theme-name"),
      accent: root.style.getPropertyValue("--wb-accent"),
    },
    sidebar: {
      width: Math.round(document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0),
      navItems: Array.from(document.querySelectorAll(".sidebar__nav-item, .sidebar-nav__item")).map(el => el.textContent?.trim().slice(0, 30)),
      sessionCount: document.querySelectorAll(".sidebar__conv, [class*='conv']").length,
      footerChildren: Array.from(document.querySelector(".sidebar__footer")?.children ?? []).map(el => ({
        tag: el.tagName.toLowerCase(),
        aria: el.getAttribute("aria-label"),
        cls: (el.className ?? "").toString().slice(0, 50),
      })),
    },
    header: {
      topbar: document.querySelector(".main-topbar")?.textContent?.trim().slice(0, 200),
    },
    main: {
      hasComposer: !!document.querySelector(".wb-composer__input, [class*='composer']"),
      sceneTabs: Array.from(document.querySelectorAll("[class*='scene-tab'], [class*='SceneTab']")).map(el => el.textContent?.trim().slice(0, 30)).slice(0, 10),
    },
    builtinReport: window.__ob_builtin_report?.map(r => `${r.pkg}: slots=${r.slotsRegistered}`) ?? null,
    statusBar: document.querySelector(".app__statusbar, [class*='statusbar'], [class*='StatusBar']")?.textContent?.trim().slice(0, 100),
  };
});

console.log(JSON.stringify(audit, null, 2));
console.log("\nPageErrors:", pageErrors.length);
for (const e of pageErrors.slice(0, 5)) console.log("  -", e.slice(0, 200));

await app.close();
