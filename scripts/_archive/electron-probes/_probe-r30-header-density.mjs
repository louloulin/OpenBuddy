/**
 * R30 真机探针:顶栏信息密度 + 首页输入卡提示去重。
 *
 * 两件事都是"量出来才发现的":
 *
 * 1. **顶栏搜索框在窄窗口溢出容器。** `.main-topbar__search` 硬写
 *    `min-width: 280px`,而中间区 `.main-topbar__center` 是 `flex: 1`。
 *    窗口收到 760px(侧栏 320 → 主区 440 → 中间区只剩 232px)时搜索框
 *    x=456..736,与左组(结束于 480)和右组主题按钮(x=712)各重叠 24px。
 *    修法:`.main-topbar__center` 变容器(`container-type: inline-size`),
 *    搜索框 `min-width: min(280px, 100%)`,并在容器 ≤300px 时退化成 34px
 *    纯图标按钮(aria-label 仍在),≤96px 时整块收起。
 *
 * 2. **首页输入卡把"请先配置 API Key"画了两遍。** `.wb-composer__setup-hint`
 *    是覆盖整卡的点击热区,但它 `inset:0` + `align-items:center`,文字被垂直
 *    居中到输入区/底栏接缝(y≈390–405,底栏从 410 开始),而 textarea 的
 *    placeholder 写着同一句话(y≈352)→ 一屏两遍,其中一遍压着底栏。
 *    修法:热区保留全卡,文字改 sr-only(读屏仍念得出按钮名),视觉只留
 *    placeholder 那一处。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * 截图默认不写盘 —— 探针每次跑都会重排像素,提交进来的 PNG 会被无意义地
 * 反复改写(真正的 CSS 改动反而淹没在二进制 diff 里)。需要更新视觉资产时:
 *   OPENBUDDY_PROBE_SHOTS=1 node scripts/electron/<probe>.mjs
 */
const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r30-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r30-agent-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

const report = { widths: {}, composer: null, pageErrors: [] };

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.message ?? error)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
  await page.waitForTimeout(500);

  const measure = () =>
    page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) };
      };
      const left = rect(".main-topbar__left");
      const right = rect(".main-topbar__right");
      const center = rect(".main-topbar__center");
      const search = rect(".main-topbar__search");
      const cs = search ? getComputedStyle(document.querySelector(".main-topbar__search")) : null;
      const label = document.querySelector(".main-topbar__search-label");
      return {
        window: window.innerWidth,
        centerWidth: center?.w ?? null,
        searchWidth: search?.w ?? null,
        searchDisplay: cs?.display ?? null,
        labelVisible: label ? getComputedStyle(label).display !== "none" : false,
        // > 0 表示搜索框压到了邻居
        overlapLeft: search && left ? Math.round(left.right - search.x) : null,
        overlapRight: search && right ? Math.round(search.right - right.x) : null,
      };
    });

  for (const width of [1280, 1100, 980, 860, 760]) {
    await page.setViewportSize({ width, height: 860 }).catch(() => {});
    await page.waitForTimeout(600);
    report.widths[width] = await measure();
  }

  await page.setViewportSize({ width: 1100, height: 900 }).catch(() => {});
  await page.waitForTimeout(700);
  report.composer = await page.evaluate(() => {
    const overlay = document.querySelector(".wb-composer__setup-hint");
    if (!overlay) return { found: false };
    const footer = document.querySelector(".wb-composer__footer")?.getBoundingClientRect();
    // 热区里除了 sr-only 之外,还有没有"看得见"的文字落在底栏那一带?
    const intruders = Array.from(overlay.querySelectorAll("*"))
      .filter((el) => !el.closest(".wb-sr-only"))
      .filter((el) => {
        const text = (el.textContent ?? "").trim();
        if (!text) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && footer && r.top >= footer.top - 20 && r.top <= footer.bottom;
      })
      .map((el) => (el.textContent ?? "").trim().slice(0, 40));
    const label = overlay.querySelector(".wb-sr-only");
    return {
      found: true,
      overlayCoversCard: Math.round(overlay.getBoundingClientRect().height) > 100,
      srOnlyLabel: label?.textContent?.trim() ?? null,
      footerIntruders: intruders,
    };
  });

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r30-header-density.png" });
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}
console.log(JSON.stringify(report, null, 2));
process.exit(0);
