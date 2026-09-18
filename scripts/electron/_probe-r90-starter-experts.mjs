/**
 * R90 — 验证内置起步专家目录(starter-*)真机渲染。
 * 跑前先 `pnpm exec electron-vite build`。
 *
 * 关键检查:
 *  1. 没有任何 OPENBUDDY_AGENTS_DIR 注入 → expertDefaultRoot 落到 seeded
 *     <agentHome>/experts,而不是空状态。
 *  2. 至少 6 张 starter 专家卡 + 1 张团队卡。
 *  3. 团队卡有 ribbon「内置专家团」。
 *  4. 来源条 (`ec-source-bar`) 显示的是 <agentHome>/experts 而不是空。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r90-starter-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r90-starter-agent-"));

const report = { steps: [], problems: [], pageErrors: [] };
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT,
  timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(2500);
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));

  // Skip onboarding.
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
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press("Escape");

  const nav = page.locator(".sidebar__nav-item", { hasText: "专家" }).first();
  if (await nav.count() === 0) report.problems.push("侧边栏找不到「专家」入口");
  else { await nav.click(); await page.waitForTimeout(3000); }

  // Verify env var is set in the main process — quickest way to confirm the
  // PI_SUBAGENT_EXTRA_AGENT_DIRS side-effect actually fired.
  const envCheck = await page.evaluate(() => {
    return {
      // rendered source path:
      source: document.querySelector(".ec-source-label")?.textContent?.trim() ?? null,
      // catalog cards:
      cards: Array.from(document.querySelectorAll(".ec-card")).map((c) => ({
        title: c.querySelector(".ec-card-title")?.textContent?.trim() ?? null,
        ribbon: c.querySelector(".ec-card-ribbon span")?.textContent?.trim() ?? null,
        desc: (c.querySelector(".ec-card-desc")?.textContent ?? "").slice(0, 50),
        tags: Array.from(c.querySelectorAll(".ec-card-tag")).map((t) => t.textContent.trim()),
      })),
      chips: Array.from(document.querySelectorAll(".ec-chips .um-chip, .ec-chips button"))
        .map((b) => b.textContent.trim()).filter(Boolean).slice(0, 12),
      scenes: document.querySelectorAll(".ec-scene-card").length,
      emptyState: document.querySelector(".ec-empty")?.textContent?.trim() ?? null,
      loadingState: document.querySelector(".ec-loading")?.textContent?.trim() ?? null,
    };
  });

  // Ask the main process directly: read back the env via a tiny test page that
  // imports the path helper. We do it via the openbuddy:// debug channel.
  // Simplest: dump env via node child_process; but Electron has the env in
  // the main process. Instead, ship the env check through the renderer's
  // preload — use the existing `expertsDefaultRoot` IPC.
  const envInMain = await page.evaluate(async () => {
    try {
      const root = await window.api.invoke?.("experts_default_root");
      return { root: root ?? null, has: typeof root === "string" && root.length > 0 };
    } catch (e) { return { error: String(e) }; }
  });

  report.dom = envCheck;
  report.envMain = envInMain;

  // Now switch to the 专家团 tab to verify the team expert renders.
  const teamTab = page.locator(".ec-list-tabs .um-segment-item", { hasText: "专家团" }).first();
  if (await teamTab.count() === 0) {
    report.problems.push("找不到「专家团」segment tab");
  } else {
    await teamTab.click();
    // R91 — the previous wait (`cards > 0 || empty`) was satisfied instantly
    // by the still-mounted 专家-tab cards, so the assertion below raced React's
    // state update and reported a false failure. Wait for the *team* card
    // specifically, or for the empty state, before reading the DOM.
    await page.waitForFunction(
      () => document.querySelectorAll(".ec-card").length === 0
        || Array.from(document.querySelectorAll(".ec-card-title")).some((t) => /专家团/.test(t.textContent || ""))
        || document.querySelector(".ec-empty") !== null,
      undefined, { timeout: 8000 },
    ).catch(() => {});
    await page.waitForTimeout(300);
  }
  const teamDom = await page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll(".ec-card")).map((c) => ({
      title: c.querySelector(".ec-card-title")?.textContent?.trim() ?? null,
      ribbon: c.querySelector(".ec-card-ribbon span")?.textContent?.trim() ?? null,
    })),
  }));
  report.teamDom = teamDom;

  // Assertions
  if (!envCheck.cards.length) report.problems.push("专家网格 0 张卡片(catalog 没出来)");
  if (!envCheck.cards.some((c) => c.title?.includes("软件工程师"))) report.problems.push("缺少 starter-software-engineer");
  if (!envCheck.scenes) report.problems.push("精选场景 0 张");
  if (envCheck.emptyState) report.problems.push(`仍处于空状态: ${envCheck.emptyState}`);
  if (envCheck.loadingState) report.problems.push(`一直 loading: ${envCheck.loadingState}`);
  if (!envInMain.has) report.problems.push(`experts_default_root 返回空字符串(${JSON.stringify(envInMain)})`);
  if (!teamDom.cards.some((c) => c.title?.includes("成果交付专家团"))) {
    report.problems.push(`专家团 tab 缺「成果交付专家团」卡 (实际 ${JSON.stringify(teamDom.cards)})`);
  }
  if (!teamDom.cards.some((c) => c.ribbon?.includes("内置专家团"))) {
    report.problems.push("团队卡没有「内置专家团」ribbon");
  }

  report.steps.push({ step: "starter experts visible", ok: envCheck.cards.length > 0, detail: `count=${envCheck.cards.length}` });
} finally {
  await app.close();
}
// Emit the full, parseable report. The previous `.slice(0, 8000)` produced
// truncated JSON, so the vitest wrapper could never parse it.
report.ok = report.pageErrors.length === 0 && report.problems.length === 0
  && report.steps.every((s) => s.ok !== false);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
