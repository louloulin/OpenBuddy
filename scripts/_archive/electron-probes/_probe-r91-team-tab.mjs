/**
 * R91 真机探针:专家团 tab 切换。
 *
 * 这条单独拆出来是因为 R90 的 starter 探针里出现过一次**假失败**:点「专家团」
 * 之后用 `cards > 0 || empty` 当作等待条件,而那条件被尚未卸载的「专家」tab
 * 卡片立即满足,于是断言读到的是旧 DOM。这里把「切 tab → 断言目标卡片」做成
 * 一个独立的、无竞态的探针。
 *
 * 断言:切到专家团后,恰好出现「成果交付专家团」,且带「内置专家团」ribbon,
 * 分类 chip 收敛到该团所属分类。
 *
 * 跑前先 `pnpm exec electron-vite build`。stdout 只输出一个 JSON 对象。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r91team-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r91team-agent-"));

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step, ok: Boolean(ok), detail });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
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
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.locator(".sidebar__nav-item", { hasText: "专家" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ec-card").length >= 5, undefined, { timeout: 20_000 });
  await page.waitForTimeout(1000);

  const teamTab = page.locator(".ec-list-tabs .um-segment-item", { hasText: "专家团" }).first();
  step("「专家团」segment tab 存在", await teamTab.count() === 1, `count=${await teamTab.count()}`);

  await teamTab.click();
  // Wait for the *team* card specifically. Waiting on `cards > 0` would be
  // satisfied by the still-mounted 专家-tab cards and race the state update.
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll(".ec-card-title")).some((t) => /专家团/.test(t.textContent || ""))
      || document.querySelector(".ec-empty") !== null,
    undefined, { timeout: 10_000 },
  );
  await page.waitForTimeout(300);

  const dump = await page.evaluate(() => ({
    activeTab: document.querySelector(".ec-list-tabs .um-segment-item--active")?.textContent?.trim() ?? null,
    cards: Array.from(document.querySelectorAll(".ec-card")).map((c) => ({
      title: c.querySelector(".ec-card-title")?.textContent?.trim() ?? null,
      ribbon: c.querySelector(".ec-card-ribbon span")?.textContent?.trim() ?? null,
    })),
    chips: Array.from(document.querySelectorAll(".ec-chips button")).map((b) => b.textContent?.trim()),
  }));
  report.dump = dump;

  step("切 tab 后 active 落在「专家团」", dump.activeTab === "专家团", `activeTab=${dump.activeTab}`);
  step("出现「成果交付专家团」", dump.cards.some((c) => c.title?.includes("成果交付专家团")), JSON.stringify(dump.cards));
  step("团队卡带「内置专家团」ribbon", dump.cards.some((c) => c.ribbon?.includes("内置专家团")), JSON.stringify(dump.cards.map((c) => c.ribbon)));

  if (process.env.OPENBUDDY_PROBE_SHOTS === "1") {
    await page.screenshot({ path: "/tmp/r91-team-tab.png" });
  }
} finally {
  await app.close();
}

report.ok = report.pageErrors.length === 0 && report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
