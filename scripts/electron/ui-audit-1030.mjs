// plan1030 UI 交互审计探针 — 启动真实 Electron,逐 surface 截图,
// 收集 console 错误/警告、页面上溢出/裁剪线索、可点击但 0×0 的元素。
// 只读探针:不发送消息、不改配置。产物落在 /tmp/openbuddy-ui-audit-1030。
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const userData = mkdtempSync(join(tmpdir(), "openbuddy-ui-audit-"));
const outDir = "/tmp/openbuddy-ui-audit-1030";
mkdirSync(outDir, { recursive: true });

const consoleMsgs = [];
const pageErrors = [];

const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: ["dist/main/index.js"],
  env: { ...process.env, OPENBUDDY_USER_DATA: userData, OPENBUDDY_DEBUG_UI: "0" },
  timeout: 20_000,
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 900 });
win.on("console", (m) => {
  const text = m.text();
  if (text.length > 500) return;
  if (["error", "warning"].includes(m.type())) consoleMsgs.push(`[${m.type()}] ${text}`);
});
win.on("pageerror", (e) => pageErrors.push(e.message));
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(4500);

async function auditSurface(name, action) {
  if (action) {
    try { await action(); } catch (e) { consoleMsgs.push(`[probe] ${name}: ${String(e).slice(0, 200)}`); }
    await win.waitForTimeout(1200);
  }
  await win.screenshot({ path: join(outDir, `${name}.png`) });
  // 溢出/裁剪线索:视口内元素超出其可视父容器,或横向溢出视口
  const issues = await win.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    for (const el of document.querySelectorAll("button, [role='button'], [role='listbox'], [role='option']")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < -4 || r.right > vw + 4) {
        out.push(`h-overflow: ${el.tagName}.${String(el.className).slice(0, 60)} rect=${Math.round(r.left)},${Math.round(r.right)}`);
      }
    }
    for (const el of document.querySelectorAll(".model-selector__menu, .workspace-picker__menu, .slash-commands, .mention-picker")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) out.push(`popover: ${el.className.split(" ")[0]} rect=${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} z=${getComputedStyle(el).zIndex}`);
    }
    return out.slice(0, 12);
  });
  for (const line of issues) consoleMsgs.push(`[audit:${name}] ${line}`);
  console.log(`[${name}] captured`);
}

await auditSurface("01-home");

// 打开模型选择器(fixed portal 的真实层级行为在这里现形)
const modelTrigger = win.locator(".model-selector__trigger").first();
if (await modelTrigger.count()) {
  await modelTrigger.click();
  await win.waitForTimeout(400);
  await auditSurface("02-model-menu-open", null);
  await win.keyboard.press("Escape");
}

// 新建会话 → 聊天页
await auditSurface("03-new-session", async () => {
  const btn = win.locator("text=新建会话").first();
  if (await btn.count()) await btn.click();
});

// composer 底行交互:推理档位在菜单里
const modelTrigger2 = win.locator(".model-selector__trigger").first();
if (await modelTrigger2.count()) {
  await modelTrigger2.click();
  await win.waitForTimeout(300);
  await auditSurface("04-chat-model-menu", null);
  await win.keyboard.press("Escape");
}

// 侧栏设置
await auditSurface("05-settings", async () => {
  const btn = win.locator("[aria-label='设置'], text=设置").first();
  if (await btn.count()) await btn.click();
});

await win.waitForTimeout(800);
await auditSurface("06-settings-models", async () => {
  const item = win.locator("text=模型").first();
  if (await item.count()) await item.click();
});

console.log("---- console (error/warning) ----");
for (const line of consoleMsgs.slice(0, 40)) console.log(line);
console.log("---- pageErrors ----");
for (const line of pageErrors.slice(0, 10)) console.log(line);

await app.close();
