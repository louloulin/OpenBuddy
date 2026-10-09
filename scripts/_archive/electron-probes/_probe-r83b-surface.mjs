/** R83b — 量补全菜单与它周围表面的「分层可辨识度」。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { themes: {}, problems: [] };
const userData = mkdtempSync(join(tmpdir(), "ob-r83b-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({ version: 1, status: "done", index: 0, steps: [], startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now() }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });

  async function run(theme) {
    // 主题 store 的键:openbuddy.theme(name) + openbuddy.theme.name + mode。
    // mode 必须置 manual,否则 Match-system 会把 name 覆盖成系统偏好的那一套。
    await page.evaluate((t) => {
      window.localStorage.setItem("openbuddy.theme", t);
      window.localStorage.setItem("openbuddy.theme.name", t);
      window.localStorage.setItem("openbuddy.theme.mode", "manual");
    }, theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
    await new Promise((r) => setTimeout(r, 2200));
    const c = page.locator("textarea.wb-composer__input").first();
    await c.waitFor({ state: "visible", timeout: 30_000 });
    await c.click(); await c.fill(""); await c.type("/", { delay: 25 });
    await new Promise((r) => setTimeout(r, 1000));

    report.themes[theme] = await page.evaluate(() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      const pix = (input, backdrop) => {
        if (!input) return null;
        ctx.clearRect(0, 0, 1, 1);
        if (backdrop) { ctx.fillStyle = `rgb(${backdrop.r} ${backdrop.g} ${backdrop.b})`; ctx.fillRect(0, 0, 1, 1); }
        ctx.fillStyle = "#000001";
        const before = ctx.fillStyle;
        ctx.fillStyle = String(input);
        if (ctx.fillStyle === before && String(input).replace(/\s/g, "").toLowerCase() !== "#000001") return backdrop ?? null;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      const lum = ({ r, g, b }) => {
        const f = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => { if (!a || !b) return null; const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

      const menu = document.querySelector(".slash-commands");
      const composerEl = document.querySelector(".wb-composer, .wb-composer__card, section");
      const rootCS = getComputedStyle(document.documentElement);
      const menuStyle = menu ? getComputedStyle(menu) : null;
      // 页面底色(菜单"浮"在什么上面)
      const pageBgRaw = getComputedStyle(document.body).backgroundColor;
      const composerBgRaw = composerEl ? getComputedStyle(composerEl).backgroundColor : null;

      const menuBg = pix(menuStyle?.backgroundColor);
      const pageBg = pix(pageBgRaw);
      const composerBg = pix(composerBgRaw, pageBg);

      const borderW = menuStyle?.borderTopWidth;
      const borderC = pix(menuStyle?.borderTopColor, menuBg);
      const shadow = menuStyle?.boxShadow;

      return {
        themeAttr: document.documentElement.getAttribute("data-theme"),
        themeName: document.documentElement.getAttribute("data-theme-name"),
        tokens: {
          bgElevated: rootCS.getPropertyValue("--wb-bg-elevated").trim(),
          shadowMd: rootCS.getPropertyValue("--wb-shadow-md").trim(),
          shadowLg: rootCS.getPropertyValue("--wb-shadow-lg").trim(),
          borderDefault: rootCS.getPropertyValue("--wb-border-default").trim(),
        },
        menuBgRaw: menuStyle?.backgroundColor,
        menuBg,
        pageBgRaw,
        pageBg,
        composerBgRaw,
        composerBg,
        borderWidth: borderW,
        borderColor: menuStyle?.borderTopColor,
        boxShadow: shadow,
        // 关键指标:菜单表面 vs 页面底色 / 菜单表面 vs 输入卡表面
        contrastVsPage: ratio(menuBg, pageBg),
        contrastVsComposer: ratio(menuBg, composerBg),
        borderVsMenu: ratio(borderC, menuBg),
      };
    });
  }
  await run("openbuddy");
  await run("openbuddy-dark");

  for (const [t, d] of Object.entries(report.themes)) {
    if (d.contrastVsPage !== null && d.contrastVsPage < 1.05 && !/rgba?\([^)]*0,\s*0,\s*0\)?/.test(d.boxShadow ?? "")) {
      // 表面几乎同色 + 阴影又是黑的 → 在深色下等于没有分层
    }
    if (d.contrastVsComposer !== null && d.contrastVsComposer < 1.05) {
      report.problems.push(`${t}: 菜单背景与输入卡背景几乎同色(对比 ${d.contrastVsComposer.toFixed(3)}),只靠 1px 边框区分`);
    }
    if (d.contrastVsPage !== null && d.contrastVsPage < 1.05) {
      report.problems.push(`${t}: 菜单背景与页面背景几乎同色(对比 ${d.contrastVsPage.toFixed(3)})`);
    }
  }
} catch (e) { report.error = String(e?.message ?? e); }
finally {
  try { await app.close(); } catch {}
  console.log(JSON.stringify(report, null, 2));
}
