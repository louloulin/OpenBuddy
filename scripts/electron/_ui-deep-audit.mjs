// 深度 UI 体检：覆盖 hover / 消息渲染 / 设置面板 / 错误态 / 多消息流。
import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/deep";
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

// 1) 侧栏 hover 态
const conv = page.locator(".sidebar__conv:not(.sidebar__conv--active)").first();
try {
  const box = await conv.boundingBox();
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(outDir, "01-sidebar-hover.png"), clip: { x: 0, y: 0, width: 280, height: 800 } });
  const st = await conv.evaluate(el => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, shadow: cs.boxShadow?.slice(0,80), borderRadius: cs.borderRadius };
  });
  log("sidebar conv hover", st);
} catch (e) { log("sidebar conv hover", { error: e.message }); }

// 2) 侧栏折叠 / "更多" 弹层
const moreBtn = page.locator(".sidebar__more, [class*='sidebar__more-btn']").first();
try {
  if (await moreBtn.count()) {
    await moreBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, "02-more-popover.png") });
    const pop = page.locator(".sidebar__more-popover, [class*='sidebar__more-popover']").first();
    const st = await pop.evaluate(el => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderColor, shadow: cs.boxShadow?.slice(0,80), radius: cs.borderRadius };
    });
    log("more popover", st);
    // close
    await page.keyboard.press("Escape");
  }
} catch (e) { log("more popover", { error: e.message }); }

// 3) 顶栏按钮（topbar）清单 + 样式
const topbarBtns = await page.$$eval(".app__topbar button, [class*='topbar'] button, [class*='topbar'] [class*='btn']", (els) =>
  els.slice(0, 12).map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      title: el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0,20) || "?",
      tag: el.tagName,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius, border: cs.borderColor,
    };
  })
);
log("topbar buttons", { count: topbarBtns.length, items: topbarBtns });

// 4) 状态栏 status pill 的 streaming 态（如果可能）
const streamingPill = page.locator(".chatview__status--streaming").first();
const isStreaming = await streamingPill.count();
log("streaming pill present", { yes: isStreaming > 0 });
if (isStreaming > 0) {
  const st = await streamingPill.evaluate(el => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, animation: cs.animation };
  });
  log("streaming pill style", st);
}

// 5) Composer 在 focus vs 文本 1 行 vs 5 行的实际高度（看是否会自动撑开）
await page.evaluate(() => {
  document.documentElement.setAttribute("data-theme", "light");
  document.body.setAttribute("data-theme", "light");
});
await page.waitForTimeout(300);
const ta = await page.$("textarea");
if (ta) {
  const heights = {};
  // 5a: empty
  await ta.evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); el.focus();
  });
  await page.waitForTimeout(150);
  heights.empty = await ta.evaluate(el => el.getBoundingClientRect().height);

  // 5b: short
  await ta.evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, "hi"); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(150);
  heights.short = await ta.evaluate(el => el.getBoundingClientRect().height);

  // 5c: long
  await ta.evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, "a\nb\nc\nd\ne\nf\ng\nh"); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(150);
  heights.long = await ta.evaluate(el => el.getBoundingClientRect().height);

  log("composer height", heights);
}

// 6) ChatView 主体区：当前会话是否有消息气泡？空态样式如何？
const messageArea = await page.evaluate(() => {
  const msgs = document.querySelectorAll(".msg, .message, [class*='msg-'], [class*='message__']");
  return {
    msgCount: msgs.length,
    firstMsgClass: msgs[0]?.className?.slice(0,80) || null,
    quickPromptCount: document.querySelectorAll(".chatview__quick-prompt, [class*='quick-prompt']").length,
    welcomeVisible: !!document.querySelector(".chatview__welcome, [class*='welcome']"),
  };
});
log("chat view area", messageArea);

await page.screenshot({ path: join(outDir, "00-current.png"), fullPage: false });

writeFileSync(join(outDir, "findings.json"), JSON.stringify(findings, null, 2));
await app.close();
