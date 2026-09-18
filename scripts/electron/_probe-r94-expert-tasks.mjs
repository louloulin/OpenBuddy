/**
 * R94 真机探针:专家页不再承载任何任务/删除入口。
 *
 * 用户反馈:「专家页面不需要展示任务删除」。R91 移除了专家页内嵌的左侧
 * 「任务(N)」栏,R93 又把全局 `shell.overlay.tasks` 浮层从专家页摘掉。
 * 本探针把这两条一起钉死,并顺带验证源码里的死代码也不再复辟:
 *
 *   1. DOM 里没有 `[data-testid="tasks-panel"]` / `.tasks-panel`。
 *   2. DOM 里没有任何 .tasks-panel__kill 或者「删除/终止/Delete/Kill」语义按钮。
 *   3. 专家页源码里不再存在 `experts/TasksPanel`(R91 遗留、零消费方的死代码)。
 *
 * 跑前先 `pnpm exec electron-vite build`。stdout 只输出一个 JSON 对象。
 */
import { _electron as electron } from "playwright";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r94-exptasks-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r94-exptasks-agent-"));

const report = { steps: [], pageErrors: [] };
const step = (n, ok, d) => report.steps.push({ step: n, ok: Boolean(ok), detail: d });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(2500);

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
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 先在首页制造一个真实会话,让"运行中任务/最近任务"有数据可显示
  await page.locator(".sidebar__nav-item", { hasText: "专家" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ec-card").length >= 5, undefined, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const audit = await page.evaluate(() => {
    const txt = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    const all = [...document.querySelectorAll("*")];
    const withTitle = (needle) =>
      all.filter((el) => el.children.length === 0 && txt(el).includes(needle)).map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName, cls: el.className?.toString().slice(0, 60), text: txt(el).slice(0, 40),
                 x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
    return {
      tasksPanel: Boolean(document.querySelector('[data-testid="tasks-panel"]')),
      tasksPanelClass: Boolean(document.querySelector(".tasks-panel")),
      ecTaskPanel: Boolean(document.querySelector('[data-testid="experts-tasks-panel"]')),
      killButtons: document.querySelectorAll(".tasks-panel__kill").length,
      // 任何"删除"-ish 的可见控件
      deleteLike: [...document.querySelectorAll("button,[role=button]")]
        .filter((b) => /删除|终止|结束任务|Delete|Kill|Trash/i.test(txt(b) || b.getAttribute("title") || b.getAttribute("aria-label") || ""))
        .map((b) => ({ text: txt(b).slice(0, 30), title: b.getAttribute("title"), cls: b.className?.toString().slice(0, 50) })),
      titleNodes: { tasks: withTitle("Tasks"), 运行中任务: withTitle("运行中任务"), 任务: withTitle("任务") },
      placeholderView: document.querySelector(".app")?.className,
      sidebarTaskSection: Boolean(document.querySelector(".sidebar__section-title")),
    };
  });
  report.audit = audit;

  step("无 [data-testid=tasks-panel]", !audit.tasksPanel, `tasksPanel=${audit.tasksPanel}`);
  step("无 .tasks-panel 容器", !audit.tasksPanelClass, `cls=${audit.tasksPanelClass}`);
  step("无 kill 按钮", audit.killButtons === 0, `kill=${audit.killButtons}`);
  step("无删除/终止语义按钮", audit.deleteLike.length === 0, JSON.stringify(audit.deleteLike));

  if (process.env.OPENBUDDY_PROBE_SHOTS === "1") {
    await page.screenshot({ path: "/tmp/r94-expert-tasks.png" });
  }
} finally {
  await app.close();
}
// 源码级守卫:专家页里那份「任务(N)」栏组件在 R91 之后已零消费方,
// R94 删除。若有人把它请回来(或重新接上 placehold.experts),这条会红。
const deadSource = join(ROOT, "packages", "ui", "openbuddy-ui-experts", "src", "experts", "TasksPanel.tsx");
const deadCss = join(ROOT, "packages", "ui", "openbuddy-ui-experts", "src", "experts", "TasksPanel.module.css");
step("专家页死代码 TasksPanel.tsx 已删除", !existsSync(deadSource), deadSource);
step("专家页死代码 TasksPanel.module.css 已删除", !existsSync(deadCss), deadCss);

report.ok = report.pageErrors.length === 0 && report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
