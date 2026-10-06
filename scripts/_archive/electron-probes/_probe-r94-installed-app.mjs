/**
 * R94 探针:验证「装到 /Applications 的那个包」渲染出的专家页与源码一致。
 *
 * 用户反馈的「专家页面不需要展示任务删除」之所以看起来没修好,根因是
 * 他一直启动 `/Applications/OpenBuddy.app`,而那个 bundle 是 9 月 16 日
 * 构建的(早于 R91/R93/R94)。本探针直接对已安装的 bundle 起窗口,断言
 * 专家页里没有任务面板 / 删除入口,把「源码修了但用户跑的还是旧的」
 * 这类问题在 CI 里暴露出来。
 *
 * 用法:`node scripts/electron/_probe-r94-installed-app.mjs`
 * stdout 只输出一个 JSON 对象。
 */
import { _electron as electron } from "playwright";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALLED = "/Applications/OpenBuddy.app/Contents/MacOS/OpenBuddy";
const report = { steps: [], pageErrors: [], installedApp: INSTALLED };
const step = (n, ok, d) => report.steps.push({ step: n, ok: Boolean(ok), detail: d });

if (!existsSync(INSTALLED)) {
  report.ok = false;
  step("已安装 bundle 存在", false, INSTALLED);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}
step("已安装 bundle 存在", true, INSTALLED);

const userData = mkdtempSync(join(tmpdir(), "ob-r94-installed-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r94-installed-agent-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`],
  executablePath: INSTALLED,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
    window.localStorage.removeItem("expertsRoot");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.locator(".sidebar__nav-item", { hasText: "专家" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ec-card").length >= 3, undefined, { timeout: 25000 });
  await page.waitForTimeout(1500);

  report.audit = await page.evaluate(() => {
    const txt = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    return {
      tasksPanel: Boolean(document.querySelector('[data-testid="tasks-panel"]')),
      tasksPanelClass: Boolean(document.querySelector(".tasks-panel")),
      killButtons: document.querySelectorAll(".tasks-panel__kill").length,
      deleteLike: [...document.querySelectorAll("button,[role=button]")]
        .filter((b) => /删除|终止|结束任务|Delete|Kill|Trash/i.test(
          txt(b) || b.getAttribute("title") || b.getAttribute("aria-label") || ""))
        .map((b) => ({ text: txt(b).slice(0, 30), title: b.getAttribute("title") })),
      splitDisplay: getComputedStyle(document.querySelector(".ec-page-split")).display,
      cardCount: document.querySelectorAll(".ec-card").length,
      sourceBarVisible: Boolean(document.querySelector(".ec-source-bar")),
      scenesVisible: (document.querySelector(".ec-scenes")?.getBoundingClientRect().height ?? 0) > 0,
    };
  });

  const a = report.audit;
  step("已安装包:无任务面板", !a.tasksPanel && !a.tasksPanelClass, JSON.stringify({ p: a.tasksPanel, c: a.tasksPanelClass }));
  step("已安装包:无删除/终止按钮", a.killButtons === 0 && a.deleteLike.length === 0, JSON.stringify(a.deleteLike));
  step("已安装包:单栏(display:block)", a.splitDisplay === "block", a.splitDisplay);
  step("已安装包:专家卡渲染", a.cardCount >= 3, `cards=${a.cardCount}`);
  step("已安装包:精选场景在", a.scenesVisible, `scenes=${a.scenesVisible}`);
  step("已安装包:无渲染异常", report.pageErrors.length === 0, JSON.stringify(report.pageErrors));

  if (process.env.OPENBUDDY_PROBE_SHOTS === "1") {
    await page.screenshot({ path: "/tmp/r94-installed-experts.png" });
  }
} finally {
  await app.close();
}

report.ok = report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
