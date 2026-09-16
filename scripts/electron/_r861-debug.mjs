import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
mkdirSync("/tmp/openbuddy-screenshots/r861", { recursive: true });
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules", ".bin", "electron"),
  args: [join(process.cwd(), "out/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 90000,
});
const page = await app.firstWindow({ timeout: 60000 });
await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
await page.waitForTimeout(4500);

await page.evaluate(() => {
  const all = document.querySelectorAll("button, a");
  for (const el of all) {
    const t = (el.textContent || "").trim();
    if (t.includes("新建") || t.includes("Home")) { el.click(); return; }
  }
});
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const ta = document.querySelector(".wb-composer__input");
  if (!ta) return { taFound: false };
  const composer = document.querySelector(".wb-composer");
  return {
    taFound: true,
    taTag: ta.tagName,
    taClasses: ta.className,
    composerOverflow: composer ? getComputedStyle(composer).overflow : null,
    composerZIndex: composer ? getComputedStyle(composer).zIndex : null,
    isContentEditable: ta.contentEditable,
    visible: ta.offsetParent !== null,
  };
});
console.log("INITIAL:", JSON.stringify(info, null, 2));

const c = await page.evaluate(() => {
  const ta = document.querySelector(".wb-composer__input");
  if (!ta) return null;
  const r = ta.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
console.log("TEXTAREA RECT:", JSON.stringify(c));

// Click on textarea center
await page.mouse.click(c.x + c.w / 2, c.y + c.h / 2);
await page.waitForTimeout(300);

const focusInfo = await page.evaluate(() => {
  return {
    activeElement: document.activeElement?.tagName + "." + (document.activeElement?.className || "").toString().slice(0, 60),
  };
});
console.log("FOCUS:", JSON.stringify(focusInfo));

// Type @
await page.keyboard.press("@");
await page.waitForTimeout(800);

const afterAt = await page.evaluate(() => {
  const ta = document.querySelector(".wb-composer__input");
  return {
    value: ta?.value,
    selectionStart: ta?.selectionStart,
    mentionPickerExists: !!document.querySelector(".mention-picker"),
    slashExists: !!document.querySelector(".slash-commands"),
    bodyChildrenMention: Array.from(document.body.children).filter(c => c.className && c.className.includes("mention")),
    composerMentionCount: document.querySelectorAll(".wb-composer .mention-picker").length,
    bodyMentionCount: document.querySelectorAll("body .mention-picker").length,
  };
});
console.log("AFTER @:", JSON.stringify(afterAt, null, 2));

// Try slash
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.keyboard.press("/");
await page.waitForTimeout(800);

const afterSlash = await page.evaluate(() => {
  const ta = document.querySelector(".wb-composer__input");
  return {
    value: ta?.value,
    slashExists: !!document.querySelector(".slash-commands"),
    bodySlash: Array.from(document.body.children).filter(c => c.className && c.className.includes("slash")),
    composerSlashCount: document.querySelectorAll(".wb-composer .slash-commands").length,
    bodySlashCount: document.querySelectorAll("body .slash-commands").length,
    slashVisible: document.querySelector(".slash-commands") ? getComputedStyle(document.querySelector(".slash-commands")).display : null,
  };
});
console.log("AFTER /:", JSON.stringify(afterSlash, null, 2));

await app.close();
