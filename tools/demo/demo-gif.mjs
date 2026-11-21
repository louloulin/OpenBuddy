#!/usr/bin/env node
// Demo GIF recorder — drives the real OpenBuddy desktop app and encodes a short
// marketing clip: 选模板 → 提问 → 工具审批 → 产物落在工作台.
//
// The clip is recorded from the real Electron build (real renderer, real Pi engine,
// real permission cards, real workbench) against the local OpenAI-compatible fixture.
// No user credentials, no synthetic UI.
//
// Usage:
//   node tools/demo/demo-gif.mjs [--out docs/demo.gif] [--fps 12] [--width 900] [--keep]
//
// Requires a fresh build: `pnpm build:electron` (renderer in dist/, main in dist-electron/).
// macOS/Linux GUI required (Linux needs xvfb-run; see USE_XVFB below).
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO = resolve(import.meta.dirname, '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT = resolve(REPO, arg('out', 'docs/demo.gif'));
const FPS = Number(arg('fps', '12'));
const WIDTH = Number(arg('width', '900'));
const KEEP = process.argv.includes('--keep');
const CONTROL_PORT = Number(process.env.DEMO_CONTROL_PORT || 47523);
const FIXTURE_PORT = Number(process.env.DEMO_FIXTURE_PORT || 47524);
const RUN_DIR = join(tmpdir(), `openbuddy-demo-${process.pid}`);
// The driver resolves its own RUN as <RUN_DIR>/run (see ui-explore/driver.mjs).
const FRAME_DIR = join(RUN_DIR, 'run', 'demo-frames');
const SEQ_DIR = join(RUN_DIR, 'seq');

const driver = ['apps/desktop/scripts/ui-explore/driver.mjs'].map((p) => join(REPO, p)).find(existsSync);
if (!driver) throw new Error('ui-explore driver not found');
if (!existsSync(join(REPO, 'dist/index.html')) || !existsSync(join(REPO, 'dist-electron/main.js')))
  throw new Error('missing build — run `pnpm build:electron` first');

mkdirSync(FRAME_DIR, { recursive: true });
mkdirSync(SEQ_DIR, { recursive: true });

// ---------------------------------------------------------------- driver process
const env = {
  ...process.env,
  SHOTS_DIR: join(RUN_DIR, 'shots'),
  RUN_DIR,
  CONTROL_PORT: String(CONTROL_PORT),
  FIXTURE_PORT: String(FIXTURE_PORT),
  AUTOLAUNCH: '1',
};
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const child = useXvfb
  ? spawn('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', 'node', driver], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn('node', [driver], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

const waitFor = async (pattern, ms) => {
  const deadline = Date.now() + ms;
  while (!pattern.test(log)) {
    if (child.exitCode !== null) throw new Error(`driver exited early:\n${log.slice(-3000)}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${pattern}:\n${log.slice(-3000)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};
const ev = async (name, body) => {
  const res = await fetch(`http://127.0.0.1:${CONTROL_PORT}/`, { method: 'POST', body });
  const json = await res.json();
  if (!json.ok) throw new Error(`step "${name}" failed:\n${json.error}`);
  console.log(`DEMO_STEP ${name}`, JSON.stringify(json.result ?? null).slice(0, 400));
  return json.result;
};

// ---------------------------------------------------------------- capture (CDP screencast)
const CAPTURE_START = `
  globalThis.__demoFrames = [];
  globalThis.__demoStop = false;
  const record = (data, at) => { globalThis.__demoFrames.push({ data, at }); };
  try {
    const cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', (f) => {
      record(f.data, Date.now());
      try { cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); } catch {}
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 84, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
    globalThis.__demoStopCapture = async () => { await cdp.send('Page.stopScreencast').catch(() => {}); };
    return { mode: 'cdp' };
  } catch (e) {
    globalThis.__demoStopCapture = async () => { globalThis.__demoStop = true; };
    (async () => {
      while (!globalThis.__demoStop) {
        try { const buf = await page.screenshot({ type: 'jpeg', quality: 84 }); record(buf.toString('base64'), Date.now()); } catch {}
        await new Promise((r) => setTimeout(r, 110));
      }
    })();
    return { mode: 'poll', error: String(e && e.message || e) };
  }
`;

const CAPTURE_STOP = `
  await globalThis.__demoStopCapture();
  await new Promise((r) => setTimeout(r, 500));
  const frames = globalThis.__demoFrames;
  await ctx.mkdir(ctx.tmpPath('demo-frames'));
  const times = [];
  for (let i = 0; i < frames.length; i++) {
    await ctx.writeFile(ctx.tmpPath('demo-frames/f' + String(i).padStart(5, '0') + '.b64'), frames[i].data);
    times.push(frames[i].at);
  }
  await ctx.writeFile(ctx.tmpPath('demo-frames/times.json'), JSON.stringify(times));
  return { count: frames.length, first: times[0] ?? 0, last: times[times.length - 1] ?? 0 };
`;

// ---------------------------------------------------------------- the demo story
const DEMO_SETUP = `
  await ctx.setSize(1200, 760);
  await ctx.sleep(900);
  // Slow the fixture down so the streaming answer is actually readable in the clip.
  ctx.fixture.delayMs = 300;
  await ctx.call('providers_save_provider', { provider: { id: 'fixture', providerKind: 'custom', label: 'Demo', baseUrl: 'http://127.0.0.1:${FIXTURE_PORT}/v1', apiBackend: 'chat_completions', authScheme: 'bearer', apiKey: 'local-fixture-only' } });
  await ctx.call('providers_save_model', { model: { providerId: 'fixture', modelId: 'fixture-model', name: 'Buddy 模型', reasoning: true, input: ['text', 'image'], contextWindow: 128000, maxTokens: 4096 } });
  await ctx.call('agents_defaults_save', { defaults: { defaultModel: 'fixture-model', defaultProviderId: 'fixture', defaultPermission: 'ask' } });
  // The user's own data folder — the Buddy is asked to build a dashboard from it.
  // agent_init returns the app's home cwd (the default space where a new task lands).
  const init = await ctx.call('agent_init', {});
  const cwd = init?.cwd;
  if (!cwd) throw new Error('no workspace cwd: ' + JSON.stringify(init));
  await ctx.mkdir(cwd + '/data');
  const csv = ['month,region,amount,growth']
    .concat(Array.from({ length: 24 }, (_, i) => {
      const m = String((i % 12) + 1).padStart(2, '0');
      const region = ['华东', '华南', '华北', '西部'][i % 4];
      return '2026-' + m + ',' + region + ',' + (100 + i * 7.5).toFixed(1) + ',' + ((i % 5) * 2.4) + '%';
    })).join('\\n') + '\\n';
  await ctx.writeFile(cwd + '/data/sales-raw.csv', csv);
  await page.getByRole('button', { name: /^选择模型：/ }).first().waitFor({ timeout: 20000 });
  return { cwd, ok: true };
`;

const DEMO_ACT = `
  const sleep = ctx.sleep;
  const log = [];

  // 0) 开场：让首页模板入口先被看清
  await sleep(3600);

  // 1) 选模板 —— 日常办公 → 数据分析及可视化 → 销售数据看板
  await page.locator('.home__chip[aria-label="数据分析及可视化"]').click();
  await sleep(1900);
  await page.locator('.home__template[aria-label="销售数据看板"]').click();
  await sleep(2900);
  log.push('template picked');

  // 2) 提问 —— 发送模板带来的 prompt
  await page.getByRole('button', { name: '发送', exact: true }).click();
  log.push('sent');

  // 3) 工具审批 #1 —— 读取数据
  const allowOnce = page.getByRole('button', { name: '允许本次', exact: true });
  await allowOnce.waitFor({ timeout: 45000 });
  await sleep(3400);
  await allowOnce.click();
  await sleep(2600);
  log.push('approved read');

  // 4) 工具审批 #2 —— 写入看板，「本任务允许」后本会话不再打扰
  const allowTask = page.getByRole('button', { name: '本任务允许', exact: true });
  await allowTask.waitFor({ timeout: 45000 });
  await sleep(3900);
  await allowTask.click();
  log.push('approved write (session)');

  // 5) 产物 —— 等待最终总结
  await page.getByText('看板和分析报告都做好了', { exact: false }).first().waitFor({ timeout: 120000 });
  await sleep(4100);
  log.push('artifacts done');

  // 6) 产物落在工作台
  const toggle = page.getByRole('button', { name: '展开右侧栏', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await sleep(3600);
  const item = page.locator('.bench-item__main').first();
  await item.waitFor({ timeout: 20000 });
  await item.click();
  await page.locator('.bench-viewer').waitFor({ timeout: 20000 });
  await sleep(5200);
  log.push('workbench preview');
  return { log };
`;

// ---------------------------------------------------------------- run
let failure;
try {
  await waitFor(/LAUNCHED/, 120_000);
  await ev('setup', DEMO_SETUP);
  const capture = await ev('capture-start', CAPTURE_START);
  console.log('DEMO_CAPTURE_MODE', capture.mode);
  await new Promise((r) => setTimeout(r, 900)); // lead-in: the home page settles
  await ev('act', DEMO_ACT);
  await new Promise((r) => setTimeout(r, 1200)); // outro: hold the final frame
  const stats = await ev('capture-stop', CAPTURE_STOP);
  console.log('DEMO_FRAMES', stats.count, 'span', stats.last - stats.first, 'ms');
  if (!stats.count) throw new Error('no frames captured');
} catch (error) {
  failure = error;
} finally {
  await ev('close', 'await app?.close().catch(()=>{}); setTimeout(()=>process.exit(0),200); return "bye"').catch(() => {});
  stop();
}

// ---------------------------------------------------------------- build the sequence
const b64 = readdirSync(FRAME_DIR).filter((f) => f.endsWith('.b64')).sort();
if (!b64.length) {
  console.error('DEMO_FAIL: no frames');
  if (failure) console.error(failure.message ?? failure);
  process.exit(1);
}

// The driver recorded the wall-clock arrival time of every frame; replay at the real speed.
const timesFile = join(FRAME_DIR, 'times.json');
const readTimes = () => {
  try {
    const parsed = JSON.parse(readFileSync(timesFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const times = readTimes();
// Decode base64 payloads into JPEGs.
const jpgs = b64.map((f, i) => {
  const raw = readFileSync(join(FRAME_DIR, f), 'utf8').trim();
  const out = join(FRAME_DIR, `f${String(i).padStart(5, '0')}.jpg`);
  writeFileSync(out, Buffer.from(raw, 'base64'));
  return out;
});

// Resample the capture onto a constant-FPS timeline. The screencast records far faster than
// the GIF plays, so frames are DROPPED (not duplicated) — that keeps the clip at real-time
// speed instead of stretching it.
const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
const step = 1000 / FPS;
let cursor = 0;
let seq = 0;
if (span > 0) {
  for (let t = 0; t <= span; t += step) {
    while (cursor + 1 < times.length && times[cursor + 1] - times[0] <= t) cursor++;
    const src = Math.min(cursor, jpgs.length - 1);
    copyFileSync(jpgs[src], join(SEQ_DIR, `s${String(seq++).padStart(5, '0')}.jpg`));
  }
} else {
  // No timing information: fall back to one output frame per captured frame.
  for (const jpg of jpgs) copyFileSync(jpg, join(SEQ_DIR, `s${String(seq++).padStart(5, '0')}.jpg`));
}
const seqCount = seq;
console.log('DEMO_SEQ', seqCount, 'frames @', FPS, 'fps =', (seqCount / FPS).toFixed(1), 's');

// ---------------------------------------------------------------- encode
const palette = `scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`;
mkdirSync(join(OUT, '..'), { recursive: true });
await execFileAsync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', join(SEQ_DIR, 's%05d.jpg'),
  '-vf', palette, '-loop', '0', OUT,
]);
const size = statSync(OUT).size;
console.log('DEMO_GIF', OUT, `${(size / 1024 / 1024).toFixed(2)} MB`, `${seqCount / FPS}s`);

// A poster frame for social cards / link previews.
await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', jpgs[jpgs.length - 1], '-frames:v', '1', OUT.replace(/\.gif$/, '-poster.png')]);

if (!KEEP) rmSync(RUN_DIR, { recursive: true, force: true });
if (failure) { console.error('DEMO_FAIL', failure.message ?? failure); process.exit(1); }
console.log('DEMO_OK');
process.exit(0);
