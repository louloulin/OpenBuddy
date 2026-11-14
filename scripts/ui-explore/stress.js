// 20261115-ui U0.1 — streaming stress run. Body of an async fn(ctx, page, app);
// run with:  (echo "ctx.stressLabel='after';"; cat scripts/ui-explore/stress.js) | T=300 bash scripts/ui-explore/ev.sh -
// Uses the local fixture model only (__STRESS__: 30 tool calls → 1MB write → ~30k-char answer).
// Report: frame work (CDP TaskDuration per frame, sampled in 250ms windows), long animation
// frames, keystroke→paint latency (Event Timing) while streaming, DOM writes outside the live
// turn, code-block remounts and layout shift when the stream ends, IPC bytes per channel.
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
const prevMode = await ctx.call('permission_mode_get', {});
await ctx.call('permission_mode_set', { mode: 'always-approve' });
ctx.fixture.delayMs = 20; ctx.fixture.stressDelay = 8; ctx.fixture.stressAnswerDelay = 4;

// Main process: bytes sent to the renderer, per channel.
await app.evaluate(({ BrowserWindow }) => {
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  if (!wc.__countSend) {
    const orig = wc.send.bind(wc);
    wc.__countSend = true;
    wc.send = (channel, ...args) => { const b = JSON.stringify(args).length; const t = (globalThis.__ipcBytes ??= {}); t[channel] = (t[channel] ?? 0) + b; return orig(channel, ...args); };
  }
  globalThis.__ipcBytes = {};
});

await page.locator('button', { hasText: '新建任务' }).first().click();
await ctx.sleep(600);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

await page.evaluate(() => {
  const S = (window.__stress = { frames: [], loaf: [], events: [], shifts: [], outside: 0, inside: 0, pres: new Set(), phase: 'tools' });
  let last = performance.now();
  const tick = (t) => { S.frames.push({ t, d: t - last, phase: S.phase }); last = t; if (!S.stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.loaf.push({ t: e.startTime, d: e.duration, b: e.blockingDuration, phase: S.phase }); }).observe({ type: 'long-animation-frame', buffered: false }); } catch { S.noLoaf = true; }
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (['keydown', 'keypress', 'input', 'beforeinput'].includes(e.name)) S.events.push({ name: e.name, d: e.duration, delay: e.processingStart - e.startTime, handler: e.processingEnd - e.processingStart, phase: S.phase }); }).observe({ type: 'event', durationThreshold: 16, buffered: false });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) S.shifts.push({ t: e.startTime, v: e.value }); }).observe({ type: 'layout-shift', buffered: false });
  const root = document.querySelector('.chatview__inner') ?? document.body;
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (el?.closest?.('.turn--running, .turn--last')) S.inside++; else S.outside++;
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
});

const input = page.locator('.wb-composer__input').first();
await input.click();
await input.fill('压测一下流式渲染 __STRESS__');
const t0 = Date.now();
const m0 = await metric();
await page.keyboard.press('Enter');

const windows = []; // { busyPerFrameMs, phase }
let prev = m0, prevAt = Date.now(), typed = 0, phase = 'tools', endedAt = 0;
for (let i = 0; i < 2400; i++) {
  await ctx.sleep(250);
  const state = await page.evaluate(() => {
    const S = window.__stress;
    const running = !!document.querySelector('.turn--running');
    const answer = !!document.querySelector('.turn--running .turn__answer');
    const rows = [...document.querySelectorAll('.turn--running .toolrow')];
    S.maxRows = Math.max(S.maxRows ?? 0, rows.length);
    // Interim text before the tools also renders as an answer block: check the write first.
    if (rows.some((r) => r.textContent?.includes('生成中'))) S.phase = 'write'; else if (answer && S.phase !== 'tools') S.phase = 'answer'; else if (answer && S.sawWrite) S.phase = 'answer';
    if (S.phase === 'write') S.sawWrite = true;
    for (const pre of document.querySelectorAll('.turn--running .turn__answer pre')) S.pres.add(pre);
    return { running, phase: S.phase, frames: S.frames.length };
  });
  const m = await metric(); const now = Date.now();
  const frames = Math.max(1, Math.round((now - prevAt) / (1000 / 60)));
  windows.push({ phase: state.phase, busyPerFrameMs: ((m.TaskDuration - prev.TaskDuration) * 1000) / frames, scriptMs: (m.ScriptDuration - prev.ScriptDuration) * 1000, layoutMs: (m.LayoutDuration - prev.LayoutDuration) * 1000 });
  prev = m; prevAt = now; phase = state.phase;
  // Type while the answer streams: keystroke → paint latency (Event Timing).
  if (state.phase === 'answer' && i % 6 === 0 && typed < 20) { await page.keyboard.type('a'); typed++; }
  if (!state.running && i > 4) { endedAt = Date.now(); break; }
}
await ctx.sleep(1200);
// Control group: the same keystrokes with nothing streaming.
await page.evaluate(() => { window.__stress.phase = 'idle'; });
await input.click();
for (let k = 0; k < 13; k++) { await page.keyboard.type('b'); await ctx.sleep(1500 / 6); }
await ctx.sleep(400);
await input.fill('');
const m1 = await metric();
const page_ = await page.evaluate(() => {
  const S = window.__stress; S.stop = true;
  const last = [...document.querySelectorAll('.turn')].pop();
  const pres = [...(last?.querySelectorAll('.turn__answer pre') ?? [])];
  return {
    frames: S.frames.map((f) => ({ d: f.d, phase: f.phase })),
    loaf: S.loaf, events: S.events, shifts: S.shifts, outside: S.outside, inside: S.inside, noLoaf: !!S.noLoaf,
    codeBlocks: pres.length, remounted: pres.filter((p) => !S.pres.has(p)).length,
    answerChars: last?.querySelector('.turn__answer')?.textContent?.length ?? 0,
    tools: S.maxRows ?? 0,
  };
});
const ipc = await app.evaluate(() => globalThis.__ipcBytes);
await ctx.call('permission_mode_set', { mode: prevMode });
const byPhase = (ph) => windows.filter((w) => w.phase === ph).map((w) => w.busyPerFrameMs);
const frameD = (ph) => page_.frames.filter((f) => !ph || f.phase === ph).map((f) => f.d);
const durationS = +((endedAt - t0) / 1000).toFixed(1);
return {
  label: ctx.stressLabel ?? 'run',
  durationS,
  answerChars: page_.answerChars, toolRows: page_.tools, codeBlocks: page_.codeBlocks,
  mainThread: {
    meanBusyPerFrameMs: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / Math.max(1, (endedAt - t0) / (1000 / 60))).toFixed(2),
    windowBusyPerFrameMs: { all: { p50: pct(windows.map((w) => w.busyPerFrameMs), 0.5), p95: pct(windows.map((w) => w.busyPerFrameMs), 0.95) }, answer: { p50: pct(byPhase('answer'), 0.5), p95: pct(byPhase('answer'), 0.95) }, write: { p50: pct(byPhase('write'), 0.5), p95: pct(byPhase('write'), 0.95) } },
    scriptMsTotal: +windows.reduce((a, w) => a + w.scriptMs, 0).toFixed(0), layoutMsTotal: +windows.reduce((a, w) => a + w.layoutMs, 0).toFixed(0),
  },
  frames: { count: page_.frames.length, intervalP50: pct(frameD(), 0.5), intervalP95: pct(frameD(), 0.95), intervalP99: pct(frameD(), 0.99), over50ms: frameD().filter((d) => d > 50).length, answerIntervalP95: pct(frameD('answer'), 0.95) },
  longAnimationFrames: page_.noLoaf ? 'unsupported' : { count: page_.loaf.length, maxMs: page_.loaf.length ? +Math.max(...page_.loaf.map((l) => l.d)).toFixed(0) : 0, maxBlockingMs: page_.loaf.length ? +Math.max(...page_.loaf.map((l) => l.b ?? 0)).toFixed(0) : 0, answerCount: page_.loaf.filter((l) => l.phase === 'answer').length },
  keystrokeToPaint: (() => {
    const of = (ph) => page_.events.filter((e) => e.phase === ph);
    const sum = (es) => ({ slowEvents: es.length, maxMs: es.length ? Math.max(...es.map((e) => e.d)) : 0, maxInputDelayMs: es.length ? +Math.max(...es.map((e) => e.delay)).toFixed(1) : 0, maxHandlerMs: es.length ? +Math.max(...es.map((e) => e.handler)).toFixed(1) : 0 });
    return { typed, streaming: sum(of('answer')), idle: sum(of('idle')), note: 'Event Timing reports events ≥16ms (duration includes waiting for the next vsync, 8ms granularity); compare streaming vs the idle control group' };
  })(),
  streamEnd: { codeBlocks: page_.codeBlocks, remountedCodeBlocks: page_.remounted, layoutShiftTotal: +page_.shifts.reduce((a, s) => a + s.v, 0).toFixed(4) },
  domWrites: { insideLiveTurn: page_.inside, outsideLiveTurn: page_.outside },
  ipcBytes: { total: Object.values(ipc).reduce((a, b) => a + b, 0), byChannel: ipc, writeContentBytes: 1024 * 1024 },
};
