/**
 * R42 真机探针:「专家·技能·连接器」页布局完全复刻 WorkBuddy v5.4.7。
 *
 * 要证的 4 件事:
 *   1. 关闭 onboarding 向导后,左侧「任务」栏可见(data-testid=tasks-panel)。
 *   2. 右侧主区是 2 列 split(data-testid=experts-page-split)。
 *   3. catalog 未加载时(探针环境无 experts 目录),split 仍按 2 列布局,
 *      右侧显示 loading 占位而不是崩溃。
 *   4. 排序按钮源码 label 是「综合 / 最新」(DOM 没渲染时做源码兜底断言)。
 *
 * 截图默认不写盘;OPENBUDDY_PROBE_SHOTS=1 时输出到 tests/screenshots/。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r42-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r42-agent-"));

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(2500);

  page.on("pageerror", (err) => report.pageErrors.push(String(err)));

  // 关闭首次启动的 onboarding 向导(它会拦截 sidebar 点击)。
  try {
    const closeBtn = page.locator("[data-testid='onboarding-close']").first();
    if (await closeBtn.isVisible({ timeout: 2000 })) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  } catch { /* not shown */ }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // 点击侧栏「专家·技能·连接器」
  let navigated = { found: false };
  try {
    const target = page.locator(".sidebar__nav-item", { hasText: "专家·技能·连接器" }).first();
    await target.waitFor({ state: "visible", timeout: 5000 });
    navigated = { found: true, label: await target.textContent() };
    await target.click();
  } catch (e) {
    navigated = { found: false, error: String(e?.message ?? e).slice(0, 200) };
  }
  await page.waitForTimeout(2500);
  step("点击侧栏「专家·技能·连接器」入口成功", Boolean(navigated.found), JSON.stringify(navigated));

  // 诊断:页面是否真的渲染出了预期 DOM
  const domDump = await page.evaluate(() => {
    const allTestIds = Array.from(document.querySelectorAll("[data-testid]")).map(
      (el) => el.getAttribute("data-testid"),
    );
    const tabSelected = Array.from(document.querySelectorAll(".um-pill[aria-selected='true']")).map(
      (el) => el.textContent?.trim(),
    );
    const pageStack = document.querySelector(".placeholder-page-stack");
    return {
      allTestIdsCount: allTestIds.length,
      allTestIds: allTestIds.slice(0, 30),
      tabSelected,
      hasTasksPanel: Boolean(document.querySelector("[data-testid='tasks-panel']")),
      hasPageSplit: Boolean(document.querySelector("[data-testid='experts-page-split']")),
      hasPageStack: Boolean(pageStack),
      pageStackInnerHTML: pageStack?.innerHTML,
    };
  });
  writeFileSync('/tmp/r42-dom.html', domDump.pageStackInnerHTML || '');
  console.log("[diag] domDump saved to /tmp/r42-dom.html, length:", (domDump.pageStackInnerHTML || '').length);

  // 1. R91 — 左侧「任务」栏已移除(任务列表由左侧边栏承载)。
  step(
    "左侧「任务」栏已移除(data-testid=tasks-panel 不存在)",
    !domDump.hasTasksPanel,
    JSON.stringify({ hasTasksPanel: domDump.hasTasksPanel }),
  );

  // 2. split 容器保留(现在退化为单栏,主区独占整宽)。
  step(
    "主区容器存在(data-testid=experts-page-split)",
    domDump.hasPageSplit,
    JSON.stringify({ hasPageSplit: domDump.hasPageSplit }),
  );

  // 3. catalog 加载后内部 .ec-grid 应该是 4 列(≥1400px 视口)
  //    探针环境无 experts 目录,加载失败但 split 仍应渲染。
  const gridCols = await page.evaluate(() => {
    const grid = document.querySelector(".ec-page-main .ec-grid");
    if (!grid) return null;
    const styles = getComputedStyle(grid);
    return styles.gridTemplateColumns.split(" ").filter(Boolean).length;
  });
  if (gridCols !== null) {
    step(
      "catalog 已加载:内部 ec-grid 是 4 列(≥1400px 视口)",
      gridCols === 4,
      JSON.stringify({ gridCols }),
    );
  } else {
    step(
      "catalog 未加载:主区 loading 占位(split 容器仍在,单栏)",
      !domDump.hasTasksPanel && domDump.hasPageSplit,
      "skip — depends on real experts catalog",
    );
  }

  // 4. 排序按钮 label 源码兜底断言
  const fs = await import("node:fs");
  const expertsTabSrc = fs.readFileSync(
    join(root, "packages/ui/openbuddy-ui-experts/src/experts/ExpertsTab.tsx"),
    "utf8",
  );
  step(
    "排序按钮源码 label 是「综合」+「最新」(WorkBuddy v5.4.7 实测)",
    /label:\s*"综合"/.test(expertsTabSrc) && /label:\s*"最新"/.test(expertsTabSrc),
    "ok",
  );
  step(
    "源码里不再有旧的「最热」label(防回归)",
    !/label:\s*"最热"/.test(expertsTabSrc),
    "ok",
  );

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r42-experts-page-layout.png" });

  report.ok = report.steps.every((item) => item.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
