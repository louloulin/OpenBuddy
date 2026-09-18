/**
 * R83 — ChatInput 补全菜单(slash / mention)在亮暗两套主题下的对比度真机体检。
 *
 * 用户报告:「黑色主题下 chatinput 框展示补全和白色主题存在差距」。
 *
 * 这条探针不猜、不肉眼比,直接把两套主题下**同一批元素**的 computed style 抓出来:
 *   - 菜单容器:背景 / 边框 / 文字色
 *   - header:背景 / 文字色
 *   - 普通项 / 选中项:背景 / 文字色
 * 然后算 WCAG 对比度。任何一项 < 3.0(非正文元素的宽松下限)都会点名报出来。
 *
 * 关键点:必须真打开菜单(输入 "/" 触发),不能只看静态 CSS —— 主题变量
 * 来自运行时注入,静态读 CSS 只能读到最后一级 fallback。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { ok: false, themes: {}, problems: [], pageErrors: [] };

const userData = mkdtempSync(join(tmpdir(), "ob-r83-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await new Promise((r) => setTimeout(r, 2500));

  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 0, steps: [], startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await new Promise((r) => setTimeout(r, 2500));

  /** 抓一批元素的 computed style + 算对比度。 */
  const sample = () => page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const rootCS = getComputedStyle(document.documentElement);
    const menu = document.querySelector(".slash-commands");
    const header = document.querySelector(".slash-commands__header");
    const items = [...document.querySelectorAll(".slash-commands__item")];
    const active = document.querySelector(".slash-commands__item--active");
    const name = document.querySelector(".slash-commands__name");
    const desc = document.querySelector(".slash-commands__desc");
    const source = document.querySelector(".slash-commands__source");
    const pick = (el, props) => {
      const s = cs(el);
      if (!s) return null;
      const out = {};
      for (const p of props) out[p] = s.getPropertyValue(p);
      return out;
    };
    const BOX = ["background-color", "color", "border-top-color", "border-top-width"];
    return {
      themeAttr: document.documentElement.getAttribute("data-theme"),
      themeName: document.documentElement.getAttribute("data-theme-name"),
      menuFound: Boolean(menu),
      itemCount: items.length,
      tokens: {
        bgElevated: rootCS.getPropertyValue("--wb-bg-elevated").trim(),
        bgSecondary: rootCS.getPropertyValue("--wb-bg-secondary").trim(),
        bgTertiary: rootCS.getPropertyValue("--wb-bg-tertiary").trim(),
        bgHover: rootCS.getPropertyValue("--wb-bg-hover").trim(),
        bgActive: rootCS.getPropertyValue("--wb-bg-active").trim(),
        textStrong: rootCS.getPropertyValue("--wb-text-strong").trim(),
        textMedium: rootCS.getPropertyValue("--wb-text-medium").trim(),
        textTertiary: rootCS.getPropertyValue("--wb-text-tertiary").trim(),
        borderDefault: rootCS.getPropertyValue("--wb-border-default").trim(),
      },
      menu: pick(menu, BOX),
      header: pick(header, [...BOX, "font-size"]),
      item: pick(items[0], BOX),
      activeItem: pick(active, BOX),
      name: pick(name, ["color", "font-size"]),
      desc: pick(desc, ["color", "font-size"]),
      source: pick(source, ["color", "font-size"]),
    };
  });

  /** 在指定主题下:切主题 → 打开补全菜单 → 采样。 */
  async function runTheme(themeName, expectAttr) {
    await page.evaluate((name) => {
      window.localStorage.setItem("openbuddy.theme.name", name);
      // 主题 store 的 key 随版本变化过,两个都写,避免"设了没生效"
      window.localStorage.setItem("openbuddy.theme", name);
    }, themeName);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
    await new Promise((r) => setTimeout(r, 2500));

    const composer = page.locator("textarea.wb-composer__input").first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    await composer.click();
    await composer.fill("");
    await composer.type("/", { delay: 30 });
    await new Promise((r) => setTimeout(r, 1200));

    const data = await sample();
    report.themes[themeName] = data;
    return data;
  }

  await runTheme("openbuddy", "light");
  await runTheme("openbuddy-dark", "dark");

  /**
   * 对比度体检 —— 全部在 renderer 里算。
   *
   * 为什么不能留在 Node 侧自己解析:主题注入的是 `oklch(...)` / `color(srgb …)`
   * 这类现代颜色语法,而 `getComputedStyle().color` 会**保留**书写形式(不像
   * 老的 rgb() 会自动归一)。在 Node 里手写解析器等于重实现一遍 CSS 颜色规范。
   * 浏览器有现成的归一化器:`canvas` 的 `fillStyle` 会把任何合法颜色写回成
   * `#rrggbb`,顺带就校验了"这个字符串到底是不是合法颜色"。
   *
   * 同时必须做 **alpha 合成**:选中态背景是 `rgba(255,255,255,0.1)`,它的实际
   * 观感取决于下面垫着的那层菜单背景。只比较 rgba 三元组会得出"白底上白字"
   * 这种荒谬结论(上一版探针就是这么误报的)。
   */
  const contrast = await page.evaluate((themes) => {
    /**
     * 任意 CSS 颜色 → 实际像素 {r,g,b}。
     *
     * 为什么要**真的画出来再读像素**,而不是解析字符串:
     * 主题注入的是 `oklch(…)` / `color(srgb …)` 这类 CSS Color 4 语法,
     * 而 `getComputedStyle().color` 按规范**保留书写形式**(不会归一成 rgb)。
     * 手写解析器等于重实现一遍 CSS 颜色规范,而且一旦漏了某种语法就静默
     * 把元素判成"无法解析"(上一版探针在亮色主题上 7 项全是 n/a 就是这么来的)。
     *
     * 光栅化是唯一的地面真相:浏览器怎么画,像素就是什么。alpha 也一并处理 ——
     * 在半透明画布上画,读回来的就是合成后的颜色。
     */
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    /** input + 它下面垫的底色(可选)→ 合成后的 {r,g,b};非法返回 null。 */
    const toRgba = (input, backdrop) => {
      if (!input) return backdrop ?? null;
      ctx.clearRect(0, 0, 1, 1);
      if (backdrop) {
        ctx.fillStyle = `rgb(${backdrop.r} ${backdrop.g} ${backdrop.b})`;
        ctx.fillRect(0, 0, 1, 1);
      }
      // 哨兵:非法颜色不会改 fillStyle,发现没变就说明这个字符串无效。
      ctx.fillStyle = "#000001";
      const before = ctx.fillStyle;
      ctx.fillStyle = String(input);
      if (ctx.fillStyle === before && String(input).replace(/\s/g, "").toLowerCase() !== "#000001") {
        return backdrop ?? null;
      }
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    };
    const lum = ({ r, g, b }) => {
      const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      if (!a || !b) return null;
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    const problems = [];
    const measured = {};
    for (const [theme, d] of Object.entries(themes)) {
      if (!d.menuFound) { problems.push(`${theme}: 补全菜单没打开,无法体检`); continue; }
      // 菜单背景(菜单自身不透明,作为所有内部元素的垫底)
      const menuBg = toRgba(d.menu?.["background-color"]);
      // header / 选中项都是叠在菜单表面上的半透明或实心层 —— 让浏览器合成。
      const headerBg = toRgba(d.header?.["background-color"], menuBg);
      const activeBg = toRgba(d.activeItem?.["background-color"], menuBg);

      const rows = [];
      const check = (label, fgStr, baseBg) => {
        const fg = toRgba(fgStr, baseBg);
        const r = ratio(fg, baseBg);
        rows.push({ label, fg: fgStr, ratio: r });
        if (r !== null && r < 3.0) {
          problems.push(`${theme} · ${label}: 对比度 ${r.toFixed(2)} < 3.0 (fg=${fgStr})`);
        }
      };
      check("header 文字/header 背景", d.header?.color, headerBg);
      check("普通项文字/菜单背景", d.item?.color, menuBg);
      check("选中项文字/选中背景", d.activeItem?.color, activeBg);
      check("命令名/菜单背景", d.name?.color, menuBg);
      check("描述/菜单背景", d.desc?.color, menuBg);
      check("来源标签/菜单背景", d.source?.color, menuBg);

      // 选中态与菜单背景必须能分辨,否则"选中"这件事看不见
      const selDelta = ratio(activeBg, menuBg);
      rows.push({ label: "选中态表面 vs 菜单表面", ratio: selDelta });
      if (selDelta !== null && selDelta < 1.06) {
        problems.push(`${theme} · 选中态背景与菜单背景几乎同色(对比 ${selDelta.toFixed(3)})`);
      }
      measured[theme] = { rows, menuBgResolved: d.menu?.["background-color"], activeBgResolved: d.activeItem?.["background-color"] };
    }
    return { problems, measured };
  }, report.themes);

  report.problems.push(...contrast.problems);
  report.measured = contrast.measured;

  report.ok = report.problems.length === 0 && report.pageErrors.length === 0;
} catch (err) {
  report.error = String(err?.message ?? err);
} finally {
  try { await app.close(); } catch { /* */ }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
