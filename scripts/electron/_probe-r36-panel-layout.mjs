/**
 * R36 真机探针:工作区面板(ToolSidePanel)的窄窗口自适应。
 *
 * 要证的缺陷(实机测量,1280/1100/940 三个窗口宽度下一致):
 *   面板默认 380px、左导航列默认 200px、中间 sash 5px → 主内容列只剩 175px。
 *   R34 探针量到的 `.ProseMirror` 只有 126px 宽 —— markdown 编辑器被压成
 *   十几个字符宽,完全不可用;而右侧「助理」导轨(fixed / z60)还压在面板
 *   右缘上(面板 z-index 只有 25)。
 *
 * 这条探针走用户路径判定修复:
 *   1. 打开面板(默认 380)→ 判「窄」,单栏;
 *   2. 点 README.md → 单栏切到详情,主列真的是整列宽(≥ 300px);
 *   3. 点「返回列表」→ 回到列表,文件树还在;
 *   4. 把面板拖宽到 640(localStorage)→ 恢复两栏:导航列 ≥ 140 且主列 ≥ 260,
 *      返回按钮消失;
 *   5. 窗口缩到 940 → 面板宽度按视口收敛(≤ 60% 视口),主列仍 ≥ 300;
 *   6. 面板打开时右侧导轨让位(不再压在面板上)。
 *
 * 截图默认不写盘;需要视觉资产时 OPENBUDDY_PROBE_SHOTS=1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r36-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r36-agent-"));
const workspace = mkdtempSync(join(tmpdir(), "ob-r36-ws-"));
writeFileSync(join(workspace, "README.md"), "# 面板探针\n\n这一行用来量宽度。\n");
writeFileSync(join(workspace, "notes.md"), "# 笔记\n");

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) =>
  report.steps.push({ step: name, ok: Boolean(ok), detail });

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

/** 面板几何快照(全部四舍五入成整数,便于比对)。 */
const measure = (page) =>
  page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left),
        right: Math.round(b.right),
        width: Math.round(b.width),
        height: Math.round(b.height),
      };
    };
    const panelEl = document.querySelector(".tool-side-panel");
    return {
      win: window.innerWidth,
      layout: panelEl?.getAttribute("data-panel-layout") ?? null,
      narrow: panelEl?.getAttribute("data-panel-narrow") ?? null,
      panel: rect(".tool-side-panel"),
      chat: rect(".chatview__main"),
      nav: rect(".tool-side-panel__nav"),
      main: rect(".tool-side-panel__main"),
      rail: rect(".secondary-sidebar__trigger"),
      hasTree: Boolean(document.querySelector("[data-testid='file-tree']")),
      hasBack: Boolean(document.querySelector("[data-testid='tool-side-panel-back']")),
      composer: (() => {
        const el = document.querySelector(".wb-composer");
        if (!el) return null;
        return {
          client: el.clientWidth,
          scroll: el.scrollWidth,
          overflow: el.scrollWidth - el.clientWidth,
        };
      })(),
      hint: (() => {
        const el = document.querySelector(".wb-composer__hint");
        if (!el) return null;
        return getComputedStyle(el).display !== "none";
      })(),
    };
  });

const openPanel = async (page) => {
  await page.evaluate(() => {
    const button = document.querySelector("button[aria-label='工作区文件树']");
    if (button instanceof HTMLElement) button.click();
  });
  await page.waitForTimeout(2200);
};

const clickTreeRow = async (page, name) => {
  const clicked = await page.evaluate((target) => {
    const rows = Array.from(
      document.querySelectorAll("[data-testid='file-tree'] [role='treeitem']"),
    );
    const row = rows.find((r) => (r.textContent ?? "").includes(target));
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    return true;
  }, name);
  await page.waitForTimeout(1800);
  return clicked;
};

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.message ?? error)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40000,
  });
  await page.waitForTimeout(2500);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  const created = await page.evaluate(async (cwd) => {
    try {
      return await window.api.invoke("agent:new-session", { cwd });
    } catch (error) {
      return { error: String(error) };
    }
  }, workspace);
  const sessionId =
    created && typeof created === "object" && typeof created.sessionId === "string"
      ? created.sessionId
      : null;
  step("agent:new-session 真的建出会话", Boolean(sessionId), JSON.stringify(created).slice(0, 200));
  if (!sessionId) throw new Error("无法创建会话,后续步骤全部无意义");

  await page.evaluate(
    ([sid, cwd]) => {
      localStorage.setItem("openbuddy.active-session", JSON.stringify({ sessionId: sid, cwd }));
      // 断言从"出厂默认"出发:清掉可能残留的面板宽度。
      localStorage.removeItem("tool-side-panel-width");
      localStorage.removeItem("tool-side-panel-nav-width");
    },
    [sessionId, created.cwd ?? workspace],
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40000,
  });
  await page.waitForTimeout(3200);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  // ── 1. 打开面板(1280 窗口,默认 380px) ──
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(600);
  await openPanel(page);
  const narrow = await measure(page);
  step(
    "默认 380px 面板被判定为窄(单栏),不再把主列压成 175px",
    narrow.panel?.width === 380 && narrow.narrow === "true",
    JSON.stringify(narrow),
  );
  step(
    "单栏首屏显示的是列表(文件树挂载)",
    narrow.hasTree && (narrow.layout === "nav" || narrow.layout === "main"),
    JSON.stringify({ layout: narrow.layout, hasTree: narrow.hasTree }),
  );

  // ── 2. 点文件 → 单栏切到详情 ──
  const clicked = await clickTreeRow(page, "README.md");
  const detail = await measure(page);
  step("README.md 出现在文件树里并可点", clicked, JSON.stringify({ clicked }));
  step(
    "选中后切到详情页,返回按钮出现",
    detail.layout === "main" && detail.hasBack,
    JSON.stringify({ layout: detail.layout, hasBack: detail.hasBack }),
  );
  step(
    "详情页主列是整列宽(≥ 300px,修复前只有 175px)",
    (detail.main?.width ?? 0) >= 300,
    JSON.stringify({ main: detail.main, panel: detail.panel }),
  );

  // ── 3. 返回列表 ──
  await page.click("[data-testid='tool-side-panel-back']");
  await page.waitForTimeout(900);
  const back = await measure(page);
  step(
    "点「返回列表」回到单栏列表,文件树仍在",
    back.layout === "nav" && back.hasTree && !back.hasBack,
    JSON.stringify({ layout: back.layout, hasTree: back.hasTree, hasBack: back.hasBack }),
  );

  // ── 4. 拖宽到 640 → 恢复两栏 ──
  await page.evaluate(() => {
    localStorage.setItem("tool-side-panel-width", "640");
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40000,
  });
  await page.waitForTimeout(3200);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await openPanel(page);
  const wide = await measure(page);
  step(
    "面板拖宽到 640 后恢复两栏(导航列 + 主列同时在)",
    wide.layout === "split" && Boolean(wide.nav) && Boolean(wide.main),
    JSON.stringify(wide),
  );
  step(
    "两栏下主列 ≥ 260、导航列 ≥ 140",
    (wide.main?.width ?? 0) >= 260 && (wide.nav?.width ?? 0) >= 140,
    JSON.stringify({ main: wide.main, nav: wide.nav }),
  );
  step(
    "两栏模式不再需要返回按钮",
    !wide.hasBack,
    JSON.stringify({ hasBack: wide.hasBack }),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r36-panel-split.png" });
  }

  // ── 5. 窗口缩到 940 → 面板按视口收敛 ──
  await page.setViewportSize({ width: 940, height: 860 });
  await page.waitForTimeout(900);
  const small = await measure(page);
  step(
    "940 窗口:面板宽度不超过视口 60%",
    (small.panel?.width ?? 99999) <= Math.round(940 * 0.6),
    JSON.stringify({ panel: small.panel, win: small.win }),
  );
  step(
    "940 窗口:转录区(聊天列)仍留 ≥ 320px,没有被面板挤没",
    (small.chat?.width ?? 0) >= 320,
    JSON.stringify({ chat: small.chat, panel: small.panel }),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r36-panel-narrow.png" });
  }

  // ── 6. 右侧导轨让位 ──
  step(
    "面板打开时右侧「助理」导轨让到面板左缘之外",
    small.rail != null && small.panel != null && small.rail.right <= small.panel.left + 1,
    JSON.stringify({ rail: small.rail, panelLeft: small.panel?.left }),
  );

  // ── 7. 窄聊天列里的输入卡不许溢出,宽场景不许误伤 ──
  step(
    "窄聊天列(面板占位后):输入卡内部不溢出(底行不再被裁掉)",
    (small.composer?.overflow ?? 99) <= 1,
    JSON.stringify({ composer: small.composer }),
  );
  step(
    "窄聊天列:快捷键提示条按容器宽度自动隐藏",
    small.hint === false,
    JSON.stringify({ hint: small.hint, composer: small.composer }),
  );
  await page.evaluate(() => {
    const button = document.querySelector("button[aria-label='工作区文件树']");
    if (button instanceof HTMLElement) button.click();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(900);
  const wideWin = await measure(page);
  step(
    "宽窗口 + 面板关闭:快捷键提示条仍在(容器查询没有误伤)",
    wideWin.hint === true && (wideWin.composer?.overflow ?? 99) <= 1,
    JSON.stringify({ hint: wideWin.hint, composer: wideWin.composer }),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r36-panel-wide-1440.png" });
  }

  report.ok = report.steps.every((item) => item.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
