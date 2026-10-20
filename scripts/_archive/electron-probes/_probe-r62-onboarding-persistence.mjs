/**
 * R62 探针:首启引导"关掉之后不再弹"是否真的跨进程持久化。
 *
 * 用户反馈:"为什么每次都弹出引导，引导过了就不需要弹出，需要存储这个状态"。
 *
 * 为什么必须起**两次** Electron:单次启动里的断言区分不了"内存里关掉了"和
 * "真的落盘了"。只有同一份 --user-data-dir 重启,才能证明状态是持久的。
 *
 * 断言:
 *   1. run1:冷启动向导可见(基线);
 *   2. run1:把向导关掉(点「×」;若浮层已被别的输入走完,同样接受 —— 重点
 *      是"用户不想再看到它"这件事被记住);
 *   3. run2:同 userData 再启动,向导**不再出现**;
 *   4. 两次启动都没有 renderer 异常。
 *
 * 注意:探针只断言"结果"(第二次不弹),不假设"一定是 dismissed" —— 在这台
 * 机器上真有 OS 级输入会落到这个窗口上(isTrusted=true),把浮层点成 done 也
 * 是合法结局,两者都不应该让它再弹。
 *
 * stdout 输出 JSON,供 `_probe-r62-onboarding-persistence.test.mjs` 断言。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-onboarding-persist-"));
const KEY = "openbuddy.onboarding.state";

const report = {
  schema: "openbuddy.probe.r62-onboarding-persistence.v1",
  ok: false,
  userData,
  runs: {},
  pageErrors: [],
};

async function launch() {
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: join(root, "node_modules", ".bin", "electron"),
    cwd: root,
    timeout: 60_000,
    env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e).slice(0, 300)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40_000,
  });
  await page.waitForTimeout(1200);
  return { app, page };
}

/**
 * 轮询一小段时间,记录"向导是否**出现过**"。
 *
 * 为什么要"出现过"而不是"此刻在":这台机器上会有真实的 OS 级输入落到
 * Electron 窗口上(实测 `isTrusted: true` 的 click / 空格 keydown),足以
 * 把浮层点走。用"曾经出现"当基线,断言就不再依赖"采样那一瞬间它还在"。
 */
async function observeBoot(page, ms = 4000) {
  const deadline = Date.now() + ms;
  let everVisible = false;
  let closeButtonPresent = false;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => ({
      visible: Boolean(document.querySelector("[data-testid='onboarding-wizard']")),
      close: Boolean(document.querySelector("[data-testid='onboarding-close']")),
    })).catch(() => ({ visible: false, close: false }));
    if (snap.visible) everVisible = true;
    if (snap.close) closeButtonPresent = true;
    if (everVisible && closeButtonPresent) break;
    await page.waitForTimeout(150);
  }
  return { everVisible, closeButtonPresent };
}

const snapshot = (page) =>
  page.evaluate((key) => {
    let raw = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      raw = "(unavailable)";
    }
    return {
      wizard: Boolean(document.querySelector("[data-testid='onboarding-wizard']")),
      tour: Boolean(
        document.querySelector("[data-testid='tour-modal']") ||
          document.querySelector("[data-testid='tour-spotlight']"),
      ),
      state: raw,
    };
  }, KEY);

let app1;
let app2;
try {
  // ── run1:冷启动 → 关掉向导 ───────────────────────────────────────
  const r1 = await launch();
  app1 = r1.app;
  report.runs.run1 = { page: "ok" };
  const boot1 = await observeBoot(r1.page);
  report.runs.run1.everVisible = boot1.everVisible;
  report.runs.run1.closeButtonPresent = boot1.closeButtonPresent;

  // 若此刻浮层还在,用「×」关掉;若已被别的输入走完,也接受 —— 探针关心的是
  // "用户不想再看到它这件事被记住",两条路径都该让第二次启动不再弹。
  const closeBtn = r1.page.locator("[data-testid='onboarding-close']");
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click({ timeout: 5000 }).catch(() => {});
    await r1.page.waitForTimeout(900);
  } else {
    // 浮层已被别的输入处理掉,但仍需确认状态落了盘;给它一点时间。
    await r1.page.waitForTimeout(600);
  }
  report.runs.run1.afterDismiss = await snapshot(r1.page);
  await app1.close();

  // ── run2:同一份 userData 重启 ────────────────────────────────────
  const r2 = await launch();
  app2 = r2.app;
  report.runs.run2 = { page: "ok" };
  report.runs.run2.onBoot = await snapshot(r2.page);
  await app2.close();

  const status1 = (() => {
    try {
      return JSON.parse(report.runs.run1.afterDismiss.state ?? "null")?.status ?? null;
    } catch {
      return null;
    }
  })();
  const status2 = (() => {
    try {
      return JSON.parse(report.runs.run2.onBoot.state ?? "null")?.status ?? null;
    } catch {
      return null;
    }
  })();
  report.statusAfterDismiss = status1;
  report.statusOnSecondBoot = status2;
  report.ok =
    report.runs.run1.everVisible === true &&
    report.runs.run1.closeButtonPresent === true &&
    report.runs.run1.afterDismiss.wizard === false &&
    (status1 === "dismissed" || status1 === "done") &&
    report.runs.run2.onBoot.wizard === false &&
    report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.message ?? error).slice(0, 800);
  for (const a of [app1, app2]) {
    try {
      await a?.close();
    } catch {
      /* ignore */
    }
  }
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
