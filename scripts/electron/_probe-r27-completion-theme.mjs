/**
 * R27 探针:补全菜单(`/` 命令)在浅色 / 深色主题下的实际观感差异。
 *
 * 用户的原始反馈:"黑色主题下 chatinput 框展示补全和白色主题存在差距"。
 * 这里不靠肉眼:把菜单容器 / 表头 / 选中项 / 描述文字的 computed 颜色全部抓出来,
 * 逐项对比两套主题,并检查"文字色 == 背景色"这种肉眼可见的失效。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 截图默认不写盘 —— 探针每次跑都会重排像素,提交进来的 PNG 会被无意义地
 * 反复改写(真正的 CSS 改动反而淹没在二进制 diff 里)。需要更新视觉资产时:
 *   OPENBUDDY_PROBE_SHOTS=1 node scripts/electron/<probe>.mjs
 */
const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r27cmp-"));
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const report = { ok: false, light: null, dark: null, pageErrors: [], diff: [] };

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
  await page.waitForTimeout(800);

  async function setTheme(mode) {
    await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
      const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
      if (t) t.click();
    });
    await page.waitForTimeout(900);
    await page.evaluate((m) => {
      const buttons = Array.from(document.querySelectorAll(".theme-toggle__btn"));
      const target = buttons.find((b) => (b.textContent ?? "").includes(m));
      if (target) target.click();
    }, mode === "light" ? "浅色" : "深色");
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
  }

  async function snapshot(label) {
    // 打开补全:聚焦输入框并敲一个 "/"
    await clearComposer();
    await page.evaluate(() => {
      const input =
        document.querySelector(".wb-composer__input") ?? document.querySelector("textarea");
      input?.focus();
    });
    await page.waitForTimeout(300);
    await page.keyboard.type("/", { delay: 40 });
    await page.waitForTimeout(900);

    const measured = await page.evaluate(() => {
      const menu = document.querySelector(".slash-commands");
      // WCAG 相对亮度对比:半透明色先按 alpha 合成到父表面,再算比值。
      // 用户的"看不看得见"最终就是这个数字。
      const parse = (value) => {
        const text = String(value);
        // 三种写法都要认:rgb() / rgba() / color(srgb r g b / a)。
        // 最后一种是 `color-mix(in srgb, …)` 的 computed 结果 —— 亮色主题的
        // --wb-bg-active 就落在这一支上,早期版本只认 rgba() 于是整条断言被跳过。
        const rgb = text.match(/rgba?\(([^)]+)\)/i);
        if (rgb) {
          const parts = rgb[1].split(/[,/]/).map((n) => Number.parseFloat(n.trim()));
          if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        }
        const srgb = text.match(/color\(srgb\s+([^)]+)\)/i);
        if (srgb) {
          const parts = srgb[1].split(/[\s/]+/).map((n) => Number.parseFloat(n.trim())).filter((n) => !Number.isNaN(n));
          if (parts.length < 3) return null;
          const alpha = parts.length > 3 ? parts[3] : 1;
          return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: alpha };
        }
        return null;
      };
      const over = (fg, bg) => {
        if (!fg) return null;
        if (fg.a >= 1) return fg;
        const base = bg ?? { r: 255, g: 255, b: 255, a: 1 };
        return {
          r: fg.r * fg.a + base.r * (1 - fg.a),
          g: fg.g * fg.a + base.g * (1 - fg.a),
          b: fg.b * fg.a + base.b * (1 - fg.a),
          a: 1,
        };
      };
      const luminance = (c) => {
        const channel = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
      };
      const ratio = (fgValue, bgValue, containerValue) => {
        const container = parse(containerValue);
        const bg = over(parse(bgValue), container);
        const fg = over(parse(fgValue), bg);
        if (!fg || !bg) return null;
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
        return Number((((hi + 0.05) / (lo + 0.05))).toFixed(2));
      };
      const pick = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          background: cs.backgroundColor,
          color: cs.color,
          borderColor: cs.borderColor,
          fontSize: cs.fontSize,
        };
      };
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        themeName: document.documentElement.getAttribute("data-theme-name"),
        menuFound: Boolean(menu),
        contrast: {
          // 被选中的第一行:命令名 / 描述 相对该行背景(已合成到菜单背景上)
          activeName: ratio(
            getComputedStyle(menu?.querySelector(".slash-commands__name") ?? document.body).color,
            getComputedStyle(menu?.querySelector(".slash-commands__item--active") ?? document.body)
              .backgroundColor,
            getComputedStyle(menu ?? document.body).backgroundColor,
          ),
          activeDesc: ratio(
            getComputedStyle(menu?.querySelector(".slash-commands__desc") ?? document.body).color,
            getComputedStyle(menu?.querySelector(".slash-commands__item--active") ?? document.body)
              .backgroundColor,
            getComputedStyle(menu ?? document.body).backgroundColor,
          ),
          idleName: ratio(
            getComputedStyle(menu?.querySelectorAll(".slash-commands__name")?.[1] ?? document.body).color,
            "rgba(0,0,0,0)",
            getComputedStyle(menu ?? document.body).backgroundColor,
          ),
        },
        menu: pick(menu),
        header: pick(menu?.querySelector(".slash-commands__header") ?? null),
        item: pick(menu?.querySelector(".slash-commands__item") ?? null),
        itemName: pick(menu?.querySelector(".slash-commands__name") ?? null),
        itemDesc: pick(menu?.querySelector(".slash-commands__desc") ?? null),
        itemCount: menu?.querySelectorAll(".slash-commands__item").length ?? 0,
        tokens: {
          bgElevated: getComputedStyle(document.documentElement).getPropertyValue("--wb-bg-elevated").trim(),
          textStrong: getComputedStyle(document.documentElement).getPropertyValue("--wb-text-strong").trim(),
          textMedium: getComputedStyle(document.documentElement).getPropertyValue("--wb-text-medium").trim(),
          borderDefault: getComputedStyle(document.documentElement).getPropertyValue("--wb-border-default").trim(),
        },
        // 候选"选中行"表面色:选中态不该复用实心 CTA 胶囊色(--wb-bg-pill-active),
        // 那是给"黑底白字按钮"用的。这里把可选的中性表面色一次性量出来。
        surfaceTokens: (() => {
          const cs = getComputedStyle(document.documentElement);
          const names = [
            "--wb-bg-primary",
            "--wb-bg-secondary",
            "--wb-bg-tertiary",
            "--wb-bg-elevated",
            "--wb-bg-hover",
            "--wb-bg-pill-active",
          ];
          const raw = Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
          const probe = document.createElement("div");
          probe.style.position = "absolute";
          probe.style.visibility = "hidden";
          document.body.appendChild(probe);
          const resolved = {};
          for (const [name, value] of Object.entries(raw)) {
            probe.style.backgroundColor = "";
            if (value) probe.style.backgroundColor = `var(${name})`;
            resolved[name] = getComputedStyle(probe).backgroundColor;
          }
          probe.remove();
          return { raw, resolved };
        })(),
      };
    });
    if (SHOTS_ENABLED) await page.screenshot({ path: join(ROOT, `tests/screenshots/r27-completion-${label}.png`) });
    // 关掉菜单,免得影响下一次
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await clearComposer();
    return measured;
  }

  /**
   * `@` mention 补全:同一类"列表行选中态"的另一处实现(见 misc.css)。
   * 它比 `/` 菜单更容易出问题 —— hover 与 active 共用同一条规则。
   */
  async function snapshotMention() {
    await clearComposer();
    await page.evaluate(() => {
      const input = document.querySelector(".wb-composer__input") ?? document.querySelector("textarea");
      input?.focus();
    });
    await page.waitForTimeout(300);
    await page.keyboard.type("@", { delay: 40 });
    await page.waitForTimeout(1200);
    const measured = await page.evaluate(() => {
      const picker = document.querySelector(".mention-picker");
      const item =
        picker?.querySelector(".mention-picker__item--active") ??
        picker?.querySelector(".mention-picker__item") ??
        null;
      return {
        found: Boolean(picker),
        itemCount: picker?.querySelectorAll(".mention-picker__item").length ?? 0,
        itemBg: item ? getComputedStyle(item).backgroundColor : null,
        itemColor: item ? getComputedStyle(item).color : null,
        pickerBg: picker ? getComputedStyle(picker).backgroundColor : null,
      };
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await clearComposer();
    return measured;
  }

  /**
   * 清空输入框。必须走键盘(全选 + 删除)—— 直接 `input.value = ""`
   * 不会通知 React,下一次输入会拼在旧文本后面(`@` + `/` 就不再触发 `/` 菜单)。
   */
  async function clearComposer() {
    await page.evaluate(() => {
      document.querySelector(".wb-composer__input")?.focus() ??
        document.querySelector("textarea")?.focus();
    });
    await page.keyboard.press("Meta+a").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await page.waitForTimeout(250);
  }

  await setTheme("light");
  report.lightMention = await snapshotMention();
  report.light = await snapshot("light");
  await setTheme("dark");
  report.darkMention = await snapshotMention();
  report.dark = await snapshot("dark");

  const fields = ["menu", "header", "item", "itemName", "itemDesc"];
  for (const field of fields) {
    const l = report.light?.[field];
    const d = report.dark?.[field];
    if (!l || !d) continue;
    report.diff.push({
      field,
      sameBackground: l.background === d.background,
      sameColor: l.color === d.color,
      light: { background: l.background, color: l.color },
      dark: { background: d.background, color: d.color },
    });
  }
  report.ok =
    report.pageErrors.length === 0 &&
    report.light?.menuFound === true &&
    report.dark?.menuFound === true;
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify(report, null, 2));
}
