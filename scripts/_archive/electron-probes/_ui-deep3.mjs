import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/deep3";
mkdirSync(outDir, { recursive: true });
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "dist/main/index.js")],
  cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

// 看消息内容（文本摘要），找含代码块的消息
const msgTexts = await page.$$eval(".msg, .message", els => els.map(el => ({
  cls: el.className.slice(0,40),
  text: el.textContent?.trim().slice(0, 200),
  hasCode: !!el.querySelector("pre, code, .codeblock, [class*='codeblock']"),
})));
console.log("messages:", JSON.stringify(msgTexts, null, 2));

// 找新建对话按钮（所有 sidebar 按钮的 title / aria-label）
const allBtns = await page.$$eval(".sidebar button, .app__sidebar button", els => els.map(el => ({
  cls: el.className.slice(0,60),
  title: el.getAttribute("title") || el.getAttribute("aria-label") || "",
})));
console.log("all sidebar buttons:", JSON.stringify(allBtns, null, 2));

// 看 ChatView 顶层结构
const chatRoot = await page.$$eval(".chatview, [class*='chatview'], [class*='ChatView']", els => els.slice(0, 3).map(el => {
  const r = el.getBoundingClientRect();
  return {
    cls: el.className.slice(0,80),
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    children: Array.from(el.children).slice(0,10).map(c => ({ cls: c.className.slice(0,40), tag: c.tagName })),
  };
}));
console.log("chatview root:", JSON.stringify(chatRoot, null, 2));

await app.close();
