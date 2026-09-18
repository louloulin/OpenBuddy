/**
 * R84 —— 「+」添加菜单被裁切/遮挡的真机回归探针。
 *
 * 复现路径:进入对话页 → 点 composer 左下角「+」→ 打开浮层 → 真鼠标 hover
 * 「工具」行触发二级菜单 → 检查两个浮层的真实几何。
 *
 * 断言(任一条不满足即失败,旧代码必然失败):
 *   1. `.iam-popover` 的直接父节点是 document.body(portal 出去了,不再被
 *      `.wb-composer` 的 overflow:hidden 裁切);
 *   2. 浮层四边都在视口内(不被裁);
 *   3. 浮层没有被祖先裁剪:computed overflow 链上不出现隐藏祖先;
 *   4. hover「工具」后二级菜单出现且完整落在视口内;
 *   5. 浮层中心点的 elementFromPoint 命中的是浮层自己(说明它真的在顶层,
 *      没有被别的卡片盖住)。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r84-iam-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const report = { ok: true, assertions: {}, problems: [] };
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));

await page.waitForTimeout(13_000);
// 让首启引导落盘并关掉,避免它盖住 composer
await page.evaluate(() => {
  window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
    version: 1, status: "done", index: 2,
    steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
    startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
  }));
  window.localStorage.setItem("openbuddy.tour.state", "seen");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });

await page.waitForTimeout(3000);

const addBtn = page.locator(".wb-composer__add").first();
report.composerFound = await addBtn.count() > 0;
if (!report.composerFound) {
  report.problems.push("找不到 composer 的「+」按钮(.wb-composer__add)");
} else {
  // 真鼠标点击(Playwright 会派发 trusted 事件)
  await addBtn.click();
  await page.waitForTimeout(500);

  report.assertions.popoverOpen = await page.evaluate(() => {
    const pop = document.querySelector(".iam-popover");
    return !!pop;
  });
  if (!report.assertions.popoverOpen) report.problems.push("点击「+」没有弹出 .iam-popover");

  report.assertions.portaledToBody = await page.evaluate(() => {
    const pop = document.querySelector(".iam-popover");
    return pop ? pop.parentElement === document.body : false;
  });
  if (!report.assertions.portaledToBody) {
    report.problems.push("浮层没有 portal 到 document.body(仍会被 .wb-composer 的 overflow:hidden 裁切)");
  }

  report.assertions.geometry = await page.evaluate(() => {
    const pop = document.querySelector(".iam-popover");
    if (!pop) return null;
    const r = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // `position: fixed` 的元素不会被祖先的 overflow 裁切(它的 containing block
    // 是视口),真正能"抓住"它的是祖先上的 transform / filter / perspective /
    // will-change / contain —— 这些会新建 containing block,把 fixed 变成相对
    // 该祖先定位,于是又回到会被裁的状态。这里只查这些,不把 body 的
    // overflow:hidden(应用外壳的正常设置)算作裁剪者。
    const containingBlockTrap = [];
    const TRAPPING = ["transform", "filter", "perspective", "willChange", "contain", "backdropFilter"];
    for (let el = pop.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const hit = TRAPPING.filter((prop) => {
        const v = cs[prop];
        return v && v !== "none" && v !== "auto" && v !== "normal";
      });
      if (hit.length) {
        containingBlockTrap.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), props: hit.map((p) => `${p}=${cs[p]}`) });
      }
    }
    // 视觉未被裁/未遮挡的判据:四角 + 中心都命中浮层自身(或其子节点)。
    // 被裁掉的部分 elementFromPoint 会落到别处(或 null)。
    // 浮层是 12px 圆角:探针要从角上往里让开圆角半径,否则会命中圆角
    // 外侧的邻居元素,得出"被裁"的假阳性。INSET 取 16px(12 圆角 + 余量)。
    const INSET = 16;
    const pts = [
      [r.left + INSET, r.top + INSET], [r.right - INSET, r.top + INSET],
      [r.left + INSET, r.bottom - INSET], [r.right - INSET, r.bottom - INSET],
      [r.left + r.width / 2, r.top + r.height / 2],
    ].map(([x, y]) => {
      const hit = document.elementFromPoint(Math.round(x), Math.round(y));
      return {
        x: Math.round(x), y: Math.round(y),
        hit: hit ? (hit.tagName + "." + String(hit.className).slice(0, 40)) : null,
        inside: !!hit && (pop === hit || pop.contains(hit)),
      };
    });
    return {
      rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: { vw, vh },
      fullyInsideViewport: r.left >= 0 && r.top >= 0 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5,
      containingBlockTrap,
      probePoints: pts,
      allProbePointsInside: pts.every((p) => p.inside),
      hitAtCenter: pts[4].hit,
    };
  });
  const g = report.assertions.geometry;
  if (g && !g.fullyInsideViewport) report.problems.push(`浮层超出视口被裁:${JSON.stringify(g.rect)} vs ${JSON.stringify(g.viewport)}`);
  if (g && g.containingBlockTrap.length > 0) report.problems.push(`浮层祖先新建了 containing block(会把 fixed 拽回裁剪上下文):${JSON.stringify(g.containingBlockTrap)}`);
  if (g && !g.allProbePointsInside) report.problems.push(`浮层有区域被裁掉或被遮挡:${JSON.stringify(g.probePoints.filter((p) => !p.inside))}`);

  // hover「工具」行 → 二级菜单。用真实鼠标坐标移动(Playwright 的
  // locator.hover 在 portal 浮层上偶发不触发 React 的 onMouseEnter)。
  const toolsRow = page.locator(".iam-item", { hasText: "工具" }).first();
  if (await toolsRow.count() > 0) {
    const box = await toolsRow.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
      await page.waitForTimeout(900);
    }
    report.assertions.submenu = await page.evaluate(() => {
      const sub = document.querySelector(".iam-submenu");
      if (!sub) return null;
      const r = sub.getBoundingClientRect();
      return {
        present: true,
        portaled: sub.parentElement === document.body,
        rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) },
        fullyInsideViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
        rightOfPopover: (() => {
          const pop = document.querySelector(".iam-popover");
          return pop ? r.left >= pop.getBoundingClientRect().right - 2 : null;
        })(),
      };
    });
    const s = report.assertions.submenu;
    if (!s?.present) report.problems.push("hover「工具」没有弹出二级菜单");
    else {
      if (!s.portaled) report.problems.push("二级菜单没有 portal 到 body");
      if (!s.fullyInsideViewport) report.problems.push(`二级菜单超出视口:${JSON.stringify(s.rect)}`);
    }
  } else {
    report.problems.push("菜单里找不到「工具」行");
  }
}

report.pageErrors = errors;
report.ok = report.problems.length === 0;
console.log(JSON.stringify(report, null, 2));
await app.close();
process.exit(report.ok ? 0 : 1);
