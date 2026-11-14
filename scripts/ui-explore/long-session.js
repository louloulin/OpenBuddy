// 20261115-ui U0.8 — long-session open time. Body of an async fn(ctx, page, app); run with:
//   T=600 bash scripts/ui-explore/ev.sh - < scripts/ui-explore/long-session.js
// Builds a 200-turn session through the real engine with the local fixture model (markdown
// answer with a code block and a table; every 10th turn also runs a bash tool), reloads the
// window, opens the session from the sidebar and reports first screen / interactive times.
const TURNS = ctx.longTurns ?? 200;
const init = await ctx.call('agent_init', {});
const cwd = init.inbox ?? init.cwd;
let sessionId = ctx.longSessionId;
const prevMode = await ctx.call('permission_mode_get', {});
if (!sessionId) {
  await ctx.call('permission_mode_set', { mode: 'always-approve' });
  ctx.fixture.delayMs = 0;
  sessionId = await ctx.call('agent_new_session', { cwd });
  const t = Date.now();
  for (let i = 0; i < TURNS; i++)
    await ctx.call('agent_send', { sessionId, text: `长会话压测 第 ${i + 1} 轮${i % 10 === 9 ? ' __TOOL__' : ''}：看一下渲染` });
  ctx.longSessionId = sessionId;
  ctx.longBuildS = +((Date.now() - t) / 1000).toFixed(1);
  await ctx.call('permission_mode_set', { mode: prevMode });
  ctx.fixture.delayMs = 60;
}

const results = [];
for (let run = 0; run < 3; run++) {
  await page.reload();
  await page.locator('button', { hasText: '新建任务' }).first().waitFor();
  await ctx.sleep(1500);
  const item = page.locator('[title^="长会话压测 第 1 轮"], :text("长会话压测 第 1 轮")').first();
  await item.waitFor({ timeout: 10000 });
  const r = await page.evaluate(async (TURNS_) => {
    const loaf = [];
    let obs;
    try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push({ start: e.startTime, end: e.startTime + e.duration, blocking: e.blockingDuration }); }); obs.observe({ type: 'long-animation-frame', buffered: false }); } catch {}
    const el = [...document.querySelectorAll('[title^="长会话压测 第 1 轮"], .sidebar *')].find((n) => n.children.length === 0 && n.textContent?.startsWith('长会话压测 第 1 轮')) ?? document.querySelector('[title^="长会话压测 第 1 轮"]');
    const t0 = performance.now();
    el.click();
    // First screen: the newest turn's answer is in the DOM and a frame has been painted.
    let firstScreen = null;
    const deadline = t0 + 15000;
    while (performance.now() < deadline) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      const turns = document.querySelectorAll('.turn');
      const last = turns[turns.length - 1];
      // The newest turn (turn 200) is on screen with its answer.
      if (turns.length && last?.querySelector('.turn__answer') && document.querySelector('[data-role="user"]')?.closest('.chatview__inner') && [...document.querySelectorAll('[data-role="user"]')].pop()?.textContent?.includes('第 ' + TURNS_ + ' 轮')) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        firstScreen = performance.now() - t0;
        break;
      }
    }
    // Interactive: no long animation frame for 500ms after the first screen.
    await new Promise((r) => setTimeout(r, 2500));
    obs?.disconnect();
    const after = loaf.filter((l) => l.end > t0);
    const lastLong = after.length ? Math.max(...after.map((l) => l.end)) - t0 : 0;
    return {
      firstScreenMs: firstScreen === null ? null : +firstScreen.toFixed(0),
      interactiveMs: +Math.max(firstScreen ?? 0, lastLong).toFixed(0),
      longFrames: after.length,
      maxBlockingMs: after.length ? +Math.max(...after.map((l) => l.blocking ?? 0)).toFixed(0) : 0,
      turnsInDom: document.querySelectorAll('.turn').length,
      codeBlocksInDom: document.querySelectorAll('.turn pre').length,
      domNodes: document.querySelectorAll('*').length,
    };
  }, TURNS);
  // Keystroke check once it's open.
  const input = page.locator('.wb-composer__input').first();
  await input.click();
  await page.evaluate(async () => {
    const events = [];
    const o = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown' || e.name === 'input') events.push(e.duration); });
    o.observe({ type: 'event', durationThreshold: 16, buffered: false });
    window.__longEvents = { o, events };
    return true;
  });
  for (let k = 0; k < 8; k++) { await page.keyboard.type('c'); await ctx.sleep(120); }
  await ctx.sleep(300);
  const slow = await page.evaluate(() => { window.__longEvents.o.disconnect(); return window.__longEvents.events; });
  await input.fill('');
  results.push({ ...r, keystrokeSlowEvents: slow.length, keystrokeMaxMs: slow.length ? Math.max(...slow) : 0 });
}
const med = (k) => { const xs = results.map((r) => r[k]).filter((x) => typeof x === 'number').sort((a, b) => a - b); return xs[Math.floor(xs.length / 2)]; };
return {
  label: ctx.longLabel ?? 'run', turns: TURNS, sessionId, buildS: ctx.longBuildS,
  median: { firstScreenMs: med('firstScreenMs'), interactiveMs: med('interactiveMs'), longFrames: med('longFrames'), maxBlockingMs: med('maxBlockingMs') },
  runs: results,
  budget: { firstScreenMs: 300, interactiveMs: 800 },
};
