/**
 * R28 真机探针:`details` 槽(右侧「助理」导轨)真的出现在产品外壳里。
 *
 * 之前的状态是"注册了却没人消费":ui-shell 把 SecondarySidebar 注册到
 * `details`,唯一的消费者 ui-layout 的 AppFrame 在 R23 之后降级成参考实现,
 * 所以这条导轨在产品里根本不渲染。本探针只看三件事:
 *   1. 首页(无会话)不显示导轨;
 *   2. 有活跃会话时导轨贴在窗口右缘,可点击;
 *   3. hover 浮出助理列表浮层(peek),Esc / 移开能收起。
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
const userData = mkdtempSync(join(tmpdir(), "ob-r28-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const workspace = mkdtempSync(join(tmpdir(), "ob-r28-ws-"));
// 会话落盘走 agentHome(),不是 --user-data-dir。不隔离的话每次跑探针都会在
// 用户真实的 ~/.openbuddy/agent/sessions/ 里留一个临时工作区(侧栏「空间」
// 列表里会多出一串 ob-r28-ws-xxxx)。
const agentDir = mkdtempSync(join(tmpdir(), "ob-r28-agent-"));

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

  // 首启向导会盖住界面,先关掉。
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
  await page.waitForTimeout(400);

  // ── 1. 首页(无活跃会话):导轨不该出现 ──
  const homeRail = await page.$(".secondary-sidebar__trigger");
  report.steps.push({ step: "首页不显示导轨", ok: homeRail === null, detail: homeRail ? "present" : "absent" });

  // ── 2. 建一个会话并激活 ──
  const created = await page.evaluate(async (cwd) => {
    try {
      const res = await window.api.invoke("agent:new-session", { cwd });
      return res;
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }, workspace);
  // `agent:new-session` 成功时直接返回 `{ sessionId, sessionFile, cwd, model }`;
  // 失败才返回 `{ ok: false, error }`。
  const sessionId =
    created && typeof created === "object" && typeof created.sessionId === "string"
      ? created.sessionId
      : null;
  report.sessionCreate = { ok: Boolean(sessionId), raw: created };

  if (sessionId) {
    // 恢复活跃会话读的是 JSON `{ sessionId, cwd }`,不是裸字符串。
    await page.evaluate(
      ([sid, cwd]) => {
        localStorage.setItem("openbuddy.active-session", JSON.stringify({ sessionId: sid, cwd }));
      },
      [sessionId, created.cwd ?? workspace],
    );
    await page.reload();
    await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
    await page.waitForTimeout(3500);
    await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
    await page.waitForTimeout(400);
  }

  const rail = await page.$(".secondary-sidebar__trigger");
  if (!rail) {
    report.steps.push({ step: "会话页出现导轨", ok: false, detail: "trigger not found" });
  } else {
    const box = await rail.boundingBox();
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    const width = await page.evaluate(() => window.innerWidth);
    const styles = await page.evaluate(() => {
      const el = document.querySelector(".secondary-sidebar__trigger");
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        position: cs.position,
        right: Math.round(window.innerWidth - r.right),
        label: el.textContent?.trim() ?? "",
        zIndex: cs.zIndex,
        color: cs.color,
      };
    });
    report.rail = { box, width, viewport, styles };
    report.steps.push({
      step: "会话页出现导轨",
      ok: Boolean(box && box.width > 8 && box.height > 8),
      detail: JSON.stringify(report.rail),
    });
    report.steps.push({
      step: "导轨贴在窗口右缘",
      ok: Boolean(styles && styles.position === "fixed" && styles.right <= 2),
      detail: JSON.stringify(styles),
    });

    // ── 3. hover 浮出 peek 浮层 ──
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(700);
    const floating = await page.$(".secondary-sidebar__floating");
    const peek = await page.evaluate(() => {
      const el = document.querySelector(".secondary-sidebar__floating");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        width: Math.round(r.width),
        items: el.querySelectorAll(".secondary-sidebar__item").length,
        name: el.querySelector(".secondary-sidebar__item-name")?.textContent ?? null,
      };
    });
    report.steps.push({
      step: "hover 浮出助理列表",
      ok: Boolean(floating && peek),
      detail: JSON.stringify(peek),
    });
    report.peek = peek;

    // ── 4. 空专家时不留下白板:必须有空状态 + 一条出口 ──
    if (peek && peek.items === 0) {
      const empty = await page.evaluate(() => {
        const box = document.querySelector(".secondary-sidebar__empty");
        if (!box) return null;
        const action = box.querySelector(".secondary-sidebar__empty-action");
        return {
          title: box.querySelector(".secondary-sidebar__empty-title")?.textContent ?? null,
          hasAction: Boolean(action),
          actionLabel: action?.textContent?.trim() ?? null,
        };
      });
      report.steps.push({
        step: "空专家时有空状态与出口",
        ok: Boolean(empty && empty.hasAction),
        detail: JSON.stringify(empty),
      });
      report.empty = empty;

      if (empty?.hasAction) {
        await page.click(".secondary-sidebar__empty-action");
        await page.waitForTimeout(1200);
        const navigated = await page.evaluate(() => {
          const main = document.querySelector("#main-content");
          return {
            // 占位页把专家面板挂在 `.experts-grid-host`(`experts.panel` 槽的宿主)。
            hasExpertsHost: Boolean(document.querySelector(".experts-grid-host")),
            expertCards: document.querySelectorAll(".expert-card").length,
            text: (main?.textContent ?? "").slice(0, 60),
            peekOpen: Boolean(document.querySelector(".secondary-sidebar__floating")),
          };
        });
        report.steps.push({
          step: "点「去创建专家」跳到专家页并收起浮层",
          ok: !navigated.peekOpen && navigated.hasExpertsHost && navigated.expertCards > 0,
          detail: JSON.stringify(navigated),
        });
        report.navigated = navigated;
      }
    }

    if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r28-details-rail.png" });

    // 鼠标移开 → 浮层收起
    await page.mouse.move(10, 10);
    await page.waitForTimeout(800);
    const closed = (await page.$(".secondary-sidebar__floating")) === null;
    report.steps.push({ step: "鼠标移开自动收起", ok: closed });
  }

  report.ok = report.steps.every((step) => step.ok);
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
