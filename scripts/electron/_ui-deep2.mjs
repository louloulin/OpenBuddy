// 第二轮体检：streaming / topbar hover / 代码块 / 欢迎态 / 顶栏细节。
import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/deep2";
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "out/main/index.js")],
  cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

const findings = [];
const log = (label, info) => { findings.push({ label, ...info }); console.log("•", label, JSON.stringify(info)); };

// 1) 顶栏按钮 hover 态
const tb1 = page.locator(".app__topbar button, [class*='topbar'] button").first();
try {
  const before = await tb1.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
  const box = await tb1.boundingBox();
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await page.waitForTimeout(200);
  const after = await tb1.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, shadow: getComputedStyle(el).boxShadow?.slice(0,60) }));
  log("topbar btn hover", { before, after });
} catch (e) { log("topbar btn hover", { error: e.message }); }

// 2) 模拟 streaming：通过全局 store 注入
await page.evaluate(() => {
  const w = window;
  // 直接派发一个 setStatus 调用大多数 store 都暴露了; 但更稳的方式是找 React fiber
  // 这里用一个 hack —— 找状态栏里的 "已完成" 文字, 改成"正在生成" 看渲染
});

// 3) 找代码块，看 markdown 渲染
const codeBlocks = await page.$$eval("pre code, .codeblock, [class*='codeblock']", (els) =>
  els.slice(0, 5).map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily?.split(",")[0], size: cs.fontSize,
      borderRadius: cs.borderRadius, border: cs.borderColor,
    };
  })
);
log("code blocks", { count: codeBlocks.length, items: codeBlocks });

// 4) 找消息气泡的左右对齐 / 颜色
const bubbles = await page.$$eval(".msg, .message, [class*='msg-wrap']", (els) =>
  els.slice(0, 6).map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      cls: el.className.slice(0,60),
      role: el.getAttribute("data-role") || el.className.match(/user|assistant|system/)?.[0] || "?",
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius,
    };
  })
);
log("message bubbles", { count: bubbles.length, items: bubbles });

// 5) 侧栏底部 settings / profile 按钮
const sidebarFooter = await page.$$eval(".sidebar__footer button, [class*='sidebar__footer'] button", els =>
  els.slice(0,8).map(el => ({
    title: el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0,20),
    cls: el.className.slice(0,60),
    visible: el.getBoundingClientRect().width > 0,
  }))
);
log("sidebar footer buttons", { count: sidebarFooter.length, items: sidebarFooter });

// 6) 看是不是存在 chatview__welcome / empty-state DOM（即使不显示）
const welcomeDOM = await page.$$eval(".chatview__welcome, [class*='chatview__welcome'], [class*='empty-state']", els =>
  els.length
);
log("welcome DOM exists", { count: welcomeDOM });

// 7) 点击新建对话看欢迎态
try {
  const newBtn = page.locator("[class*='new-chat'], [class*='newChat'], button[title*='新对话'], button[title*='New']").first();
  if (await newBtn.count()) {
    await newBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(outDir, "welcome.png") });
    const welcome = await page.$$eval(".chatview__welcome, [class*='welcome'], [class*='empty']", els =>
      els.slice(0,5).map(el => {
        const r = el.getBoundingClientRect();
        return { cls: el.className.slice(0,80), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, text: el.textContent?.trim().slice(0,80) };
      })
    );
    log("welcome content", { items: welcome });
  } else {
    log("welcome content", { skip: "new-chat btn not found" });
  }
} catch (e) { log("welcome content", { error: e.message }); }

// 8) 截图全屏
await page.screenshot({ path: join(outDir, "00-overview.png"), fullPage: false });

writeFileSync(join(outDir, "findings.json"), JSON.stringify(findings, null, 2));
await app.close();
