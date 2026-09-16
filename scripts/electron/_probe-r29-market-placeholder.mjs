/**
 * R29 真机探针:「专家·技能·连接器 → 插件·市场」这条路径真的能打开市场面板。
 *
 * 为什么单写一条:`_probe-phase-bcd.mjs` 找的是 `[data-testid="marketplace-tab"]`,
 * 那个 testid 属于 `@openbuddy/ui-modules` 的**参考实现** MarketplaceTab
 * (默认 apply 是 no-op,不注册);产品里真正渲染的是 `@openbuddy/ui-mcp` 的
 * MarketplacePanel(挂在 `modules.marketplace` 槽的回退底座上)。所以那条断言
 * 一直是假阴性 —— 面板其实在,只是探针找错了元素。
 *
 * 本探针按用户真实路径走:关掉首启向导 → 侧栏点「专家·技能·连接器」→
 * 点「插件·市场」pill → 断言 `.um-tab--plugins` 里的市场面板确实挂载,
 * 并给出面板当前是「有源/有插件」「加载失败」还是「空」。
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
const userData = mkdtempSync(join(tmpdir(), "ob-r29-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r29-agent-"));

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

const report = { steps: [], ok: false, pageErrors: [] };

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.message ?? error)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(2500);

  // 向导是模态浮层,不关掉后面点什么都会被吃掉。
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
  await page.waitForTimeout(400);

  // ── 1. 侧栏进入「专家·技能·连接器」 ──
  await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button, a")).find((el) =>
      (el.textContent ?? "").includes("专家·技能·连接器"),
    );
    if (hit instanceof HTMLElement) hit.click();
  });
  await page.waitForTimeout(2500);

  const pills = await page.evaluate(() => {
    const row = document.querySelector(".um-pills");
    if (!row) return null;
    return Array.from(row.querySelectorAll('[role="tab"]')).map((tab) => ({
      label: (tab.textContent ?? "").trim(),
      selected: tab.getAttribute("aria-selected") === "true",
    }));
  });
  report.pills = pills;
  report.steps.push({
    step: "专家页有四个市场 tab",
    ok: Array.isArray(pills) && pills.length === 4 && pills.some((p) => p.label.includes("插件")),
    detail: JSON.stringify(pills),
  });

  // ── 2. 点「插件·市场」 ──
  const clicked = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.um-pills [role="tab"]'));
    const hit = tabs.find((tab) => (tab.textContent ?? "").includes("插件"));
    if (hit instanceof HTMLElement) {
      hit.click();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(3500);

  const panel = await page.evaluate(() => {
    const host = document.querySelector(".um-tab--plugins");
    const text = (host?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      mounted: Boolean(host),
      hasMarketplaceBody: Boolean(host && host.childElementCount > 0),
      // 计数从**专门的统计行**读,不从整段文本里正则捞:面板上方还有别的区块
      // (Pi 扩展的文案会变长),用 `text.slice()` 截断会把统计行挤出窗口,
      // 于是"文案改了一句"变成"计数不见了"的假失败。
      stats: host?.querySelector(".marketplace-panel__stats")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      text: text.slice(0, 320),
      searchable: Boolean(host?.querySelector('input[type="search"], input[type="text"]')),
      pluginRows: host?.querySelectorAll("[class*='marketplace-row'], [class*='plugin-row'], li").length ?? 0,
      activeTab: document.querySelector('.um-pills [aria-selected="true"]')?.textContent?.trim() ?? null,
    };
  });
  report.panel = panel;
  report.steps.push({ step: "点得到「插件·市场」", ok: clicked });
  report.steps.push({
    step: "市场面板真的挂载了(此前探针找的是参考实现的 testid,假阴性)",
    ok: Boolean(panel.mounted && panel.hasMarketplaceBody),
    detail: JSON.stringify(panel).slice(0, 400),
  });
  report.steps.push({
    step: "面板切到了插件 tab",
    ok: Boolean(panel.activeTab && panel.activeTab.includes("插件")),
    detail: String(panel.activeTab),
  });

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r29-market-placeholder.png" });
  report.ok = report.steps.every((step) => step.ok);
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
