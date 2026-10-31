// plan1030 UI 审计探针 v2 — 验证:①模型菜单长名行不再裁徽章(标签省略号);
// ②行级删除按钮悬停显现;③聊天页 picker 的推理档位分区;④menu portal 层级。
// 只读:打开既有会话查看,不发送消息。
import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = "/tmp/openbuddy-ui-audit-1031";
mkdirSync(outDir, { recursive: true });

const consoleMsgs = [];
const pageErrors = [];

const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: ["dist/main/index.js"],
  env: { ...process.env, OPENBUDDY_DEBUG_UI: "0" },
  timeout: 20_000,
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 900 });
win.on("console", (m) => {
  const text = m.text();
  if (text.length > 500) return;
  if (m.type() === "error") consoleMsgs.push(`[console.error] ${text}`);
});
win.on("pageerror", (e) => pageErrors.push(e.message));
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(4500);

// 1. 首页打开模型菜单
const trigger = win.locator(".model-selector__trigger").first();
await trigger.click();
await win.waitForTimeout(400);

// 2. 悬停第二行(长名 MiniMax-M2.7-highspeed)验证省略号+删除钮
const rows = win.locator(".model-selector__menu .model-selector__item");
const rowCount = await rows.count();
console.log(`[menu] rows=${rowCount}`);
if (rowCount >= 2) await rows.nth(1).hover();
await win.waitForTimeout(300);
await win.screenshot({ path: join(outDir, "01-home-menu-hover.png") });

const menuMetrics = await win.evaluate(() => {
  const menu = document.querySelector(".model-selector__menu");
  if (!menu) return null;
  const mr = menu.getBoundingClientRect();
  const items = [...menu.querySelectorAll(".model-selector__item")].map((li) => {
    const r = li.getBoundingClientRect();
    const overflow = [...li.children].some((c) => {
      const cr = c.getBoundingClientRect();
      return cr.right > r.right + 1 || cr.left < r.left - 1;
    });
    const del = li.querySelector("[data-model-delete]");
    const delStyle = del ? getComputedStyle(del) : null;
    return {
      label: li.querySelector(".model-selector__item-label")?.textContent?.slice(0, 30),
      childOverflow: overflow,
      hasDelete: !!del,
      deleteVisible: delStyle ? delStyle.opacity !== "0" : false,
    };
  });
  return { menuRect: { l: Math.round(mr.left), t: Math.round(mr.top), r: Math.round(mr.right), b: Math.round(mr.bottom) }, items };
});
console.log(`[menu] ${JSON.stringify(menuMetrics, null, 1)}`);
await win.keyboard.press("Escape");

// 3. 打开侧栏第一个既有会话 → 聊天页(行容器是 .sidebar__conv[role=button])
try {
  const row = win.locator(".sidebar__conv").first();
  if (await row.count()) await row.click();
  else console.log("[session] no .sidebar__conv rows found");
} catch (e) { console.log(`[session] click skipped: ${String(e).slice(0, 120)}`); }
await win.waitForTimeout(2500);
await win.screenshot({ path: join(outDir, "02-chat-page.png") });

// 4. 聊天页打开模型菜单(推理档位分区应出现)
const trigger2 = win.locator(".model-selector__trigger").first();
if (await trigger2.count()) {
  await trigger2.click();
  await win.waitForTimeout(400);
  const chatMenu = await win.evaluate(() => {
    const menu = document.querySelector(".model-selector__menu");
    if (!menu) return null;
    const section = menu.querySelector(".model-selector__section");
    const trigger = document.querySelector(".model-selector__trigger .model-selector__label");
    const items = [...menu.querySelectorAll(".model-selector__item")].map((li) => {
      const label = li.querySelector(".model-selector__item-label");
      const id = li.querySelector(".model-selector__item-id");
      const lr = label?.getBoundingClientRect();
      return {
        labelText: label?.textContent,
        labelW: lr ? Math.round(lr.width) : null,
        idText: id?.textContent,
        selected: li.getAttribute("aria-selected"),
      };
    });
    return {
      hasThinkingSection: !!section,
      triggerLabel: trigger?.textContent,
      items,
      menuRect: (() => { const r = menu.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; })(),
    };
  });
  console.log(`[chat-menu] ${JSON.stringify(chatMenu)}`);
  await win.screenshot({ path: join(outDir, "03-chat-menu.png") });
}

console.log("---- console errors ----");
for (const line of consoleMsgs.slice(0, 20)) console.log(line);
console.log("---- pageErrors ----");
for (const line of pageErrors.slice(0, 10)) console.log(line);
await app.close();
