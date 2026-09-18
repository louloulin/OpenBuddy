/**
 * R65 探针:侧栏宽度可拖拽 + 持久化。
 *
 * 验证:
 *   1. 默认 width 介于 220-420 之间(从 defaultWidth 260 起步);
 *   2. handle 存在且 data-resizable-edge="right";
 *   3. 拖拽 handle 后,sidebar wrapper 宽度变化;
 *   4. localStorage 里 openbuddy.sidebar.width 被写入了拖拽后的值;
 *   5. 拖拽到极小值时被 clamp 到 220,极到大值时被 clamp 到 420;
 *   6. 重启后宽度从 localStorage 恢复。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) =>
  report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-r65-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });

  // R62 — onboarding 完成态先写好。
  await page.evaluate(() => {
    try {
      const done = JSON.stringify({
        version: 1, status: "done", index: 0, steps: [],
        startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
      });
      window.localStorage.setItem("openbuddy.onboarding.state", done);
      window.localStorage.setItem("openbuddy.tour.state", "seen");
    } catch { /* */ }
  }).catch(() => {});
  // 关键:onboarding 状态只在首屏挂载时读取一次,写完必须 reload 才生效,
  // 否则 OnboardingWizard 的全屏遮罩(z-index 1900)会盖住侧栏 resize handle,
  // 真实鼠标事件打不到 handle —— 这是 R77 排查出的探针 bug,不是产品 bug。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await sleep(2000);
  // 二次确认遮罩已消失
  const maskGone = await page.evaluate(() => !document.querySelector("[data-testid='onboarding-wizard']"));
  report.onboardingCleared = maskGone;

  // 1. handle 存在且 edge=right
  const allSeparators = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[role='separator']")).map((h) => {
      const w = h.closest("[data-resizable-edge]");
      return {
        label: h.getAttribute("aria-label"),
        ariaMin: h.getAttribute("aria-valuemin"),
        ariaMax: h.getAttribute("aria-valuemax"),
        edge: w?.getAttribute("data-resizable-edge"),
        wrapperClass: w?.className,
      };
    });
  });
  report.allSeparators = allSeparators;
  const handleInfo = await page.evaluate(() => {
    const handle = document.querySelector(".app__sidebar-shell [role='separator']");
    if (!handle) return { found: false };
    const wrapper = handle.closest("[data-resizable-edge]");
    const wrapperWidth = wrapper ? wrapper.getBoundingClientRect().width : null;
    return {
      found: true,
      edge: wrapper?.getAttribute("data-resizable-edge"),
      label: handle.getAttribute("aria-label"),
      ariaMin: handle.getAttribute("aria-valuemin"),
      ariaMax: handle.getAttribute("aria-valuemax"),
      wrapperWidth,
    };
  });
  step("handle 存在且 edge=right", handleInfo.found && handleInfo.edge === "right", handleInfo);
  step("handle aria 范围 260-480", handleInfo.ariaMin === "260" && handleInfo.ariaMax === "480", handleInfo);
  step("默认 wrapper 宽度介于 260-480", typeof handleInfo.wrapperWidth === "number" && handleInfo.wrapperWidth >= 260 && handleInfo.wrapperWidth <= 480, handleInfo);

  // 2. 拖拽 handle 到更大值(往右 60px)
  // R65 探针核心:page.mouse 会发出 trusted PointerEvent(React 的 onPointerDown
  // 才会接住);前面用 dispatchEvent 模拟的不被 React 视为可信事件,handler
  // 不触发。之所以 handle.getBoundingClientRect 的 wrapperWidth 还是 260,
  // 是因为 React state 没更新。
  const handleBox = await page.evaluate(() => {
    const handle = document.querySelector(".app__sidebar-shell [role='separator']");
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!handleBox) throw new Error("handle not found");

  // 真实鼠标:从 handle 中心 -> +60px
  await page.mouse.move(handleBox.x, handleBox.y);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 30, handleBox.y, { steps: 4 });
  await page.mouse.move(handleBox.x + 60, handleBox.y, { steps: 4 });
  await page.mouse.up();
  await sleep(400);

  const afterDrag = await page.evaluate(() => {
    const wrapper = document.querySelector(".app__sidebar-shell");
    const w = wrapper?.getBoundingClientRect().width ?? null;
    return { wrapperWidth: w, stored: window.localStorage.getItem("openbuddy.sidebar.width") };
  });
  step("拖拽 +60px 后 wrapper 宽度变化", typeof afterDrag.wrapperWidth === "number" && afterDrag.wrapperWidth > 320, afterDrag);
  step("拖拽后 localStorage 写入新宽度", afterDrag.stored !== null && Number(afterDrag.stored) >= 260, afterDrag);

  // 3. clamp 极小:从当前位置拖到 -200 (会到 220)
  const handleBox2 = await page.evaluate(() => {
    const handle = document.querySelector(".app__sidebar-shell [role='separator']");
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (handleBox2) {
    await page.mouse.move(handleBox2.x, handleBox2.y);
    await page.mouse.down();
    await page.mouse.move(handleBox2.x - 100, handleBox2.y, { steps: 6 });
    await page.mouse.move(handleBox2.x - 200, handleBox2.y, { steps: 6 });
    await page.mouse.up();
    await sleep(400);
  }
  const afterClampMin = await page.evaluate(() => {
    const w = document.querySelector(".app__sidebar-shell")?.getBoundingClientRect().width;
    return { wrapperWidth: w, stored: window.localStorage.getItem("openbuddy.sidebar.width") };
  });
  step("拖到极小被 clamp 到 260", Math.round(afterClampMin.wrapperWidth) === 260, afterClampMin);

  // 4. clamp 极大:从当前位置拖到 +600 (会到 420)
  const handleBox3 = await page.evaluate(() => {
    const handle = document.querySelector(".app__sidebar-shell [role='separator']");
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (handleBox3) {
    await page.mouse.move(handleBox3.x, handleBox3.y);
    await page.mouse.down();
    await page.mouse.move(handleBox3.x + 300, handleBox3.y, { steps: 6 });
    await page.mouse.move(handleBox3.x + 600, handleBox3.y, { steps: 6 });
    await page.mouse.up();
    await sleep(400);
  }
  const afterClampMax = await page.evaluate(() => {
    const w = document.querySelector(".app__sidebar-shell")?.getBoundingClientRect().width;
    return { wrapperWidth: w, stored: window.localStorage.getItem("openbuddy.sidebar.width") };
  });
  step("拖到极大被 clamp 到 480", Math.round(afterClampMax.wrapperWidth) === 480, afterClampMax);

  // 5. 重启后宽度从 localStorage 恢复
  await app.close();
  const app2 = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: join(root, "node_modules", ".bin", "electron"),
    cwd: root,
    timeout: 60000,
    env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
  });
  const page2 = await app2.firstWindow();
  await page2.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await sleep(2500);
  const afterRestart = await page2.evaluate(() => {
    const w = document.querySelector(".app__sidebar-shell")?.getBoundingClientRect().width;
    return { wrapperWidth: w, stored: window.localStorage.getItem("openbuddy.sidebar.width") };
  });
  step("重启后 wrapper 宽度从 localStorage 恢复为 480", Math.round(afterRestart.wrapperWidth) === 480, afterRestart);
  await app2.close().catch(() => {});

  report.ok = report.pageErrors.length === 0 && report.steps.every((s) => s.ok);
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  try { await app.close(); } catch { /* */ }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
