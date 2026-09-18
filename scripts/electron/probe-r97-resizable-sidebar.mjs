/**
 * R97 探针:验证 Sidebar 接入 Resizable 的真实接线 —— 在 Electron 里拖动
 * 把手的等效操作(localStorage 写入 → 重启 → 宽度保持),断言:
 *   1. 渲染出的 `.app__sidebar-shell` 是 Resizable 的 wrapper(带
 *      `data-resizable-edge="right"` 与 `style="width: ...px"`)。
 *   2. 把手 `[role="separator"]` 存在且 z-index 高于侧栏自身
 *      (`.sidebar` z=20,handle z=30)。
 *   3. localStorage `openbuddy.sidebar.width` 写入 → 重启 Electron →
 *      wrapper style.width 读回同一个值(持久化闭环)。
 *   4. 拖到 clamp 之外的值会被 clamp() 收回:写 600 应读回 480。
 *
 * 为什么需要真机探针(而不是只靠单测):
 *   单测锁住的是 Resizable 自身的 clamp 与 localStorage round-trip。但
 *   接进 AppShell 后还隔着:CSS Modules 的 z-index 顺序、`.sidebar` 的
 *   `flex: none` 与 `position: relative` 是否会盖住 handle、layout grid
 *   是否会让 wrapper 撑出视口。这些只能从真实 DOM 上看。
 *
 * 用法:`node scripts/electron/probe-r97-resizable-sidebar.mjs`
 * stdout 输出一个 JSON 对象,结尾 `process.exit(report.ok ? 0 : 1)`。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { steps: [], pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-r97-sidebar-"));
const agentDir = mkdtempSync(join(tmpdir(), "ob-r97-agent-"));

async function boot(presetWidth) {
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: join(root, "node_modules", ".bin", "electron"),
    cwd: root,
    timeout: 60_000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "",
      OPENBUDDY_DEBUG_UI: "0",
      OPENBUDDY_AGENT_DIR: agentDir,
      // 若传了 presetWidth,在首启前先写 localStorage(后续由 Resizable 读出)。
      ...(presetWidth !== undefined ? { OB_PROBE_PRESET_SIDEBAR_WIDTH: String(presetWidth) } : {}),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45_000 });
  // 跳过 onboarding / tour,否则首启浮层会盖住侧栏。
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
    // probe 预置宽度
    const preset = process.env.OB_PROBE_PRESET_SIDEBAR_WIDTH;
    if (preset) window.localStorage.setItem("openbuddy.sidebar.width", preset);
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45_000 });
  await page.waitForTimeout(1500);
  return { app, page };
}

try {
  // ---- 阶段 1:首次启动,默认宽度 ----
  let { app, page } = await boot(undefined);
  const sidebar1 = await page.evaluate(() => {
    const el = document.querySelector(".app__sidebar-shell");
    if (!el) return null;
    const style = el.getAttribute("style") ?? "";
    const edge = el.getAttribute("data-resizable-edge");
    const handle = el.querySelector('[role="separator"]');
    const rect = handle?.getBoundingClientRect();
    return {
      edge,
      widthStyle: style,
      hasHandle: Boolean(handle),
      handleWidth: rect?.width ?? 0,
      handleZ: handle ? Number(getComputedStyle(handle).zIndex) || 0 : 0,
      wrapperDisplay: getComputedStyle(el).display,
      wrapperFlex: getComputedStyle(el).flex,
    };
  });
  report.firstBoot = sidebar1;
  step(".app__sidebar-shell 渲染且带 data-resizable-edge=right",
    sidebar1 && sidebar1.edge === "right",
    sidebar1 ? `edge=${sidebar1.edge}` : "missing",
  );
  step("Resizable 把手存在", sidebar1?.hasHandle === true, sidebar1 ? `width=${sidebar1.handleWidth}px z=${sidebar1.handleZ}` : null);
  step("把手 z-index 高于 20(不被 .sidebar 盖住)",
    typeof sidebar1?.handleZ === "number" && sidebar1.handleZ >= 30,
    `z=${sidebar1?.handleZ}`,
  );
  step("wrapper 有 style.width(Resizable 渲染了 inline width)",
    Boolean(sidebar1?.widthStyle) && /\d+px/.test(sidebar1.widthStyle),
    sidebar1?.widthStyle,
  );
  step("wrapper 是 flex container(flex: none)",
    sidebar1?.wrapperDisplay === "flex" && sidebar1?.wrapperFlex?.startsWith("0"),
    `display=${sidebar1?.wrapperDisplay} flex=${sidebar1?.wrapperFlex}`,
  );

  // ---- 阶段 2:模拟拖到 480 → 写 localStorage → 重启 → 读回 ----
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.sidebar.width", "480");
  });
  await app.close();

  ({ app, page } = await boot(undefined));
  const sidebar2 = await page.evaluate(() => {
    const el = document.querySelector(".app__sidebar-shell");
    const widthMatch = el?.getAttribute("style")?.match(/width:\s*(\d+)px/);
    return {
      width: widthMatch ? Number(widthMatch[1]) : null,
      stored: window.localStorage.getItem("openbuddy.sidebar.width"),
    };
  });
  report.persistedWidth = sidebar2;
  step("localStorage 写入 480 → 重启后 wrapper 读回 480",
    sidebar2?.width === 480 && sidebar2?.stored === "480",
    `width=${sidebar2?.width} stored=${sidebar2?.stored}`,
  );

  // ---- 阶段 3:clamp 上限 —— 写 600 应被 clamp 到 480 ----
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.sidebar.width", "600");
  });
  await app.close();

  ({ app, page } = await boot(undefined));
  const sidebar3 = await page.evaluate(() => {
    const el = document.querySelector(".app__sidebar-shell");
    const widthMatch = el?.getAttribute("style")?.match(/width:\s*(\d+)px/);
    return {
      width: widthMatch ? Number(widthMatch[1]) : null,
      stored: window.localStorage.getItem("openbuddy.sidebar.width"),
    };
  });
  report.clampHigh = sidebar3;
  step("clamp 上限 480:写 600 后 Resizable 收回边界",
    sidebar3?.width === 480,
    `width=${sidebar3?.width} (期望 480)`,
  );

  // ---- 阶段 4:clamp 下限 —— 写 100 应被 clamp 到 260 ----
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.sidebar.width", "100");
  });
  await app.close();

  ({ app, page } = await boot(undefined));
  const sidebar4 = await page.evaluate(() => {
    const el = document.querySelector(".app__sidebar-shell");
    const widthMatch = el?.getAttribute("style")?.match(/width:\s*(\d+)px/);
    return {
      width: widthMatch ? Number(widthMatch[1]) : null,
      stored: window.localStorage.getItem("openbuddy.sidebar.width"),
    };
  });
  report.clampLow = sidebar4;
  step("clamp 下限 260:写 100 后 Resizable 收回边界",
    sidebar4?.width === 260,
    `width=${sidebar4?.width} (期望 260)`,
  );

  step("无渲染异常", report.pageErrors.length === 0, JSON.stringify(report.pageErrors));
  await app.close().catch(() => {});
} catch (error) {
  step("探针执行未抛错", false, String(error).slice(0, 400));
}

report.ok = report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
