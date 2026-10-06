/**
 * R37 真机探针:侧栏「资料库」落点 + `library.section` 分区总线。
 *
 * 要证的缺陷(改前,用户路径可复现):
 *   1. 侧栏「更多」里「资料库」只是分组**标题**,点不到 —— 三个真面板
 *      (我的文件 / 知识库 / 云存储)各自直达,没有"我有哪些资料"的落点;
 *   2. 路由 `资料库` / `更多` 是空壳占位页(只有一段说明文字);
 *   3. 路由 `灵感` 直接写"本视图暂时停用",是死入口。
 *
 * 这条探针只走用户路径:
 *   1. 侧栏「更多」→ 分组标题「资料库」是**按钮**且可点;
 *   2. 点它 → 真的出资料库页(不是占位),导航列 4 个分区齐;
 *   3. 分区内容真的换(点「灵感」→ SceneTabs + 实践案例,不是同一屏);
 *   4. 「更多」→ 菜单项「灵感」→ 直接落到灵感分区(不是停用页);
 *   5. 三条路由的正文里都没有旧的"占位 / 暂时停用"文案。
 *
 * 截图默认不写盘;需要视觉资产时 OPENBUDDY_PROBE_SHOTS=1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r37-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r37-agent-"));
const workspace = mkdtempSync(join(tmpdir(), "ob-r37-ws-"));

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

/** 资料库页快照。 */
const snapshot = (page) =>
  page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const rails = Array.from(document.querySelectorAll("[data-testid^='library-rail-']")).map(
      (el) => ({
        id: el.getAttribute("data-testid"),
        label: (el.textContent ?? "").trim(),
        active: el.getAttribute("data-active"),
      }),
    );
    const content = q("[data-testid='library-content']");
    const page_ = q("[data-testid='library-page']");
    return {
      hasLibraryPage: Boolean(page_),
      hasContent: Boolean(content),
      section: content?.getAttribute("data-section") ?? null,
      rails,
      hasSceneTabs: Boolean(q("library-content .scene-tabs-wrap, [data-testid='library-content'] .scene-tabs-wrap")),
      hasPracticeCases: Boolean(q(".practice-cases")),
      // 「我的文件」分区复用 ui-files 的 MyFilesPanel(自带 .myfiles-panel 外壳),
      // 不是工作区面板里的 FileTree(`data-testid="file-tree"`)。
      hasMyFilesPanel: Boolean(q(".myfiles-panel")),
      hasKnowledge: Boolean(q("[class*='knowledge'], [data-testid*='knowledge']")),
      railLabels: rails.map((r) => r.label),
      contentText: (content?.innerText ?? "").slice(0, 400),
      bodyText: (document.body.innerText ?? "").slice(0, 4000),
    };
  });

const openMoreMenu = async (page) => {
  await page.hover(".sidebar__more-wrap");
  await page.waitForTimeout(400);
  return page.locator(".sidebar__more-popover").count();
};

const clickByText = async (page, selector, text) =>
  page.evaluate(
    ([sel, needle]) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      const hit = nodes.find((el) => (el.textContent ?? "").trim().includes(needle));
      if (!(hit instanceof HTMLElement)) return false;
      hit.click();
      return true;
    },
    [selector, text],
  );

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
  await page.waitForTimeout(400);

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
  step("agent:new-session 真的建出会话", Boolean(sessionId), JSON.stringify(created).slice(0, 160));
  if (!sessionId) throw new Error("无法创建会话,后续步骤全部无意义");

  await page.evaluate(
    ([sid, cwd]) => {
      localStorage.setItem("openbuddy.active-session", JSON.stringify({ sessionId: sid, cwd }));
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
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  // ── 1.「更多」→ 分组标题「资料库」可点 ──
  const popovers = await openMoreMenu(page);
  step("悬停「更多」打开菜单", popovers > 0, JSON.stringify({ popovers }));
  // 弹出层不做截图资产:Electron `capturePage` 抓不到这一层(实测 DOM 上
  // rect/opacity 都为可见,图里却是空的),所以这里用几何 + 不透明度代替图片证据。
  const popoverBox = await page.evaluate(() => {
    const el = document.querySelector(".sidebar__more-popover");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      opacity: getComputedStyle(el).opacity,
      visibility: getComputedStyle(el).visibility,
    };
  });
  step(
    "弹出层真的画出来了(有尺寸、opacity 1、visible)",
    Boolean(popoverBox) &&
      popoverBox.w >= 150 &&
      popoverBox.h >= 200 &&
      popoverBox.opacity === "1" &&
      popoverBox.visibility === "visible",
    JSON.stringify(popoverBox),
  );
  const groupInfo = await page.evaluate(() => {
    const el = document.querySelector("[data-testid='sidebar-more-group-library']");
    if (!el) return null;
    return {
      tag: el.tagName,
      text: (el.textContent ?? "").trim(),
      hint: (el.querySelector(".sidebar__more-group-label-hint")?.textContent ?? "").trim(),
      otherGroups: Array.from(document.querySelectorAll(".sidebar__more-group-label")).map((n) =>
        (n.textContent ?? "").trim(),
      ),
    };
  });
  step(
    "分组标题「资料库」是 <button> 且带「打开资料库」提示",
    groupInfo?.tag === "BUTTON" && groupInfo?.hint.includes("打开资料库"),
    JSON.stringify(groupInfo),
  );

  // ── 2. 点它 → 真的到资料库页 ──
  await page.click("[data-testid='sidebar-more-group-library']");
  await page.waitForTimeout(1500);
  const lib = await snapshot(page);
  step("点「资料库」分组标题进入资料库页(不是占位页)", lib.hasLibraryPage, JSON.stringify({ hasLibraryPage: lib.hasLibraryPage, section: lib.section }));
  step(
    "导航列 4 个分区齐(my-files / knowledge / cloud-storage / inspiration)",
    lib.rails.map((r) => r.id).join(",") ===
      "library-rail-my-files,library-rail-knowledge,library-rail-cloud-storage,library-rail-inspiration",
    JSON.stringify(lib.rails),
  );
  step(
    "默认落到「我的文件」分区",
    lib.section === "my-files" && lib.hasMyFilesPanel,
    JSON.stringify({ section: lib.section, hasMyFilesPanel: lib.hasMyFilesPanel }),
  );

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r37-library-files.png" });

  // ── 3. 切分区:内容真的换 ──
  await page.click("[data-testid='library-rail-inspiration']");
  await page.waitForTimeout(1200);
  const inspiration = await snapshot(page);
  step(
    "点「灵感」分区 → 内容换成 SceneTabs + 实践案例",
    inspiration.section === "inspiration" &&
      inspiration.hasSceneTabs &&
      inspiration.hasPracticeCases,
    JSON.stringify({
      section: inspiration.section,
      hasSceneTabs: inspiration.hasSceneTabs,
      hasPracticeCases: inspiration.hasPracticeCases,
    }),
  );
  step(
    "分区切换只换内容不换壳(资料库页仍在)",
    inspiration.hasLibraryPage && inspiration.rails.length === 4,
    JSON.stringify({ hasLibraryPage: inspiration.hasLibraryPage, rails: inspiration.rails.length }),
  );

  await page.click("[data-testid='library-rail-knowledge']");
  await page.waitForTimeout(1200);
  const knowledge = await snapshot(page);
  step(
    "点「知识库」分区 → 出知识库面板",
    knowledge.section === "knowledge" && knowledge.hasKnowledge,
    JSON.stringify({ section: knowledge.section, hasKnowledge: knowledge.hasKnowledge }),
  );

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r37-library-inspiration.png" });

  // ── 4.「更多」→ 菜单项「灵感」直达灵感分区 ──
  await page.hover(".sidebar__more-wrap");
  await page.waitForTimeout(400);
  const clickedItem = await clickByText(page, ".sidebar__more-item", "灵感");
  await page.waitForTimeout(1500);
  const fromMenu = await snapshot(page);
  step("菜单项「灵感」可点", clickedItem, JSON.stringify({ clickedItem }));
  step(
    "菜单项「灵感」直达灵感分区(不再走停用页)",
    fromMenu.hasLibraryPage &&
      fromMenu.section === "inspiration" &&
      fromMenu.hasPracticeCases,
    JSON.stringify({
      hasLibraryPage: fromMenu.hasLibraryPage,
      section: fromMenu.section,
      hasPracticeCases: fromMenu.hasPracticeCases,
    }),
  );

  // ── 5. 旧文案彻底消失 ──
  const stale = ["本视图暂时停用", "该功能正在建设中", "暂无内容", "占位页"];
  const stillThere = stale.filter((t) => fromMenu.bodyText.includes(t));
  step(
    "资料库 / 灵感路由正文里不再有「占位 / 暂时停用」文案",
    stillThere.length === 0,
    JSON.stringify({ stillThere }),
  );

  report.ok = report.steps.every((item) => item.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
