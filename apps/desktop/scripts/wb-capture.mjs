import { chromium } from 'playwright-core';

/**
 * 连 WorkBuddy 渲染进程取证 (2026-11-27)。
 * 前置：WorkBuddy 以 --remote-debugging-port=9333 启动。
 *   node apps/desktop/scripts/wb-capture.mjs
 */
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const pages = ctx ? ctx.pages() : browser.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => /WorkBuddy\.app/i.test(p.url())) ?? pages[0];
if (!page) throw new Error('no WorkBuddy page');
await page.bringToFront().catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: 'release/wb-home-full.png' });
console.log('SHOT wb-home-full');

// 顶栏「当前应用」药丸：找到带应用名的按钮点开。
const pill = page.locator('button, [role="button"]').filter({ hasText: /腾讯企点|应用/ }).first();
try {
  await pill.click({ timeout: 5000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'release/wb-app-panel.png' });
  console.log('SHOT wb-app-panel');
} catch (e) {
  console.log('PILL_CLICK_FAIL', String(e).slice(0, 120));
}

// 量几个关键样式，供 1:1 对照。
const metrics = await page.evaluate(() => {
  const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, background: s.backgroundColor, borderRadius: s.borderRadius, height: s.height }; };
  const title = [...document.querySelectorAll('h1,h2,div,span')].find((el) => /智能驱动增长|腾讯企点/.test(el.textContent || '') && el.children.length === 0);
  return {
    title: title ? { text: title.textContent, fontSize: getComputedStyle(title).fontSize, fontWeight: getComputedStyle(title).fontWeight } : null,
    body: pick('body'),
  };
});
console.log('METRICS', JSON.stringify(metrics));
await browser.close();
