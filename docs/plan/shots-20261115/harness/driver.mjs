// OpenBuddy UI exploration driver (adapted from scripts/electron-ui-check.mjs).
// - launches real Electron 45 + dist-electron/main.js via a temp bootstrap with an isolated userData profile
// - runs a local OpenAI-compatible SSE fixture (no real keys)
// - exposes an HTTP control endpoint: POST /eval with JS body executed as async fn(ctx)
import { createServer } from 'node:http';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const REPO = '/home/devbox/OpenBuddy';
const require = createRequire(join(REPO, 'package.json'));
const { _electron: electron } = require('playwright-core');
const OUT = resolve(import.meta.dirname);
const RUN = join(OUT, 'run');
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 47123);
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT || 47124);
const main = join(REPO, 'dist-electron/main.js');

const fresh = process.env.FRESH !== '0';
if (fresh) await rm(RUN, { recursive: true, force: true });
const profile = join(RUN, 'profile'), harness = join(RUN, 'bootstrap'), home = join(RUN, 'home');
await mkdir(profile, { recursive: true }); await mkdir(harness, { recursive: true }); await mkdir(home, { recursive: true });
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'openbuddy-ui-explore', main: 'bootstrap.cjs' }));
// Session preload: wraps the bridge's invoke so renderer-side (preload) not_implemented rejections are logged too.
await writeFile(join(harness, 'audit-preload.cjs'), `
try {
  const electron = require('electron');
  const cb = electron.contextBridge;
  const orig = cb.exposeInMainWorld.bind(cb);
  cb.exposeInMainWorld = (key, api) => {
    if (key === 'openbuddy' && api && typeof api.invoke === 'function') {
      const inner = api.invoke;
      api = Object.freeze({ ...api, invoke: async (command, payload) => {
        try { return await inner(command, payload); }
        catch (error) { console.warn('[IPC_REJECT] ' + command + ' :: ' + String(error && error.message || error)); electron.ipcRenderer.send('audit:reject', String(command), String(error && error.message || error)); throw error; }
      } });
    }
    return orig(key, api);
  };
  console.log('[AUDIT_PRELOAD] installed');
} catch (e) { console.warn('[AUDIT_PRELOAD] failed ' + e.message); }
`);
await writeFile(join(harness, 'bootstrap.cjs'), `
const {app,ipcMain,session,safeStorage}=require('electron');
// No keyring in this headless container: Electron falls back to basic_text, which OpenBuddy (correctly) refuses.
// Test-only shim so API-key providers can be saved; set SAFESTORAGE_SHIM=0 to observe the real behaviour.
if (${JSON.stringify(process.env.SAFESTORAGE_SHIM !== '0')}) { try { safeStorage.getSelectedStorageBackend=()=>'gnome_libsecret'; safeStorage.isEncryptionAvailable=()=>true; safeStorage.encryptString=v=>Buffer.from('shim:'+v,'utf8'); safeStorage.decryptString=b=>Buffer.from(b).toString('utf8').replace(/^shim:/,''); } catch(e) { console.error('SHIM_FAIL', e.message); } }
app.setPath('userData',${JSON.stringify(profile)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
globalThis.__ipcAudit=[];
globalThis.__rendererRejects=[];
ipcMain.on('audit:reject',(_e,command,message)=>globalThis.__rendererRejects.push({command,message,at:Date.now()}));
const realHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>realHandle(channel,async(event,...args)=>{
  if(channel!=='openbuddy:invoke')return listener(event,...args);
  const record={command:String(args[0]),status:'pending',at:Date.now()};globalThis.__ipcAudit.push(record);
  try{const result=await listener(event,...args);record.status='resolved';return result;}
  catch(error){record.status='rejected';record.error=String(error&&error.message||error).slice(0,300);throw error;}
});
app.whenReady().then(()=>{ try { session.defaultSession.registerPreloadScript({type:'frame',id:'ob-audit',filePath:${JSON.stringify(join(harness, 'audit-preload.cjs'))}}); } catch(e){ console.error('AUDIT_PRELOAD_REG_FAIL', e.message); } });
import(${JSON.stringify(pathToFileURL(main).href)}).catch(e=>{console.error(e);app.exit(1)});
`);

// ---------------- fixture model provider ----------------
const fixture = { requests: [], held: [], nextStatus: [], delayMs: 60 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ANSWER = `## 修复建议

这是一个**本地 fixture** 返回的 Markdown 答案，用于检查渲染效果。

1. 打开 \`src/App.tsx\`
2. 检查 \`useEffect\` 的依赖
3. 运行测试

\`\`\`ts
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

| 项目 | 状态 |
| --- | --- |
| 构建 | 通过 |
| 测试 | 待运行 |

> 提示：以上内容由本地测试服务器生成。`;
function chunker(res, model) {
  return (delta, finish_reason = null, extra = {}) => res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`);
}
async function streamText(chunk, text, delay) {
  const parts = text.match(/[\s\S]{1,6}/g) ?? [];
  for (const p of parts) { chunk({ content: p }); if (delay) await sleep(delay); }
}
const fixtureServer = createServer(async (req, res) => {
  if (req.method === 'GET' && /\/models\/?$/.test(req.url)) { fixture.requests.push({ url: req.url, method: 'GET', auth: req.headers.authorization ? 'present' : 'none', at: Date.now() }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }, { id: 'fixture-reasoner', object: 'model' }] })); return; }
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let body = ''; for await (const b of req) body += b;
  let input; try { input = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
  const messages = input.messages ?? [];
  const last = messages.at(-1);
  const lastUser = messages.findLast(m => m.role === 'user')?.content;
  const lastUserText = typeof lastUser === 'string' ? lastUser : Array.isArray(lastUser) ? lastUser.filter(p => p.type === 'text').map(p => p.text).join('\n') : '';
  fixture.requests.push({ url: req.url, model: input.model, lastRole: last?.role, lastUserText: lastUserText.slice(0, 200), tools: (input.tools ?? []).map(t => t.function?.name), reasoning_effort: input.reasoning_effort, at: Date.now() });
  const forced = fixture.nextStatus.shift();
  if (forced || lastUserText.includes('__ERR429__') || lastUserText.includes('__ERR500__')) {
    const status = forced ?? (lastUserText.includes('__ERR429__') ? 429 : 500);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: status === 429 ? 'Rate limit reached for fixture model (local test server)' : 'Internal server error (local test server)', type: status === 429 ? 'rate_limit_error' : 'server_error', code: String(status) } }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = chunker(res, input.model);
  chunk({ role: 'assistant' });
  const finish = (reason = 'stop') => { chunk({}, reason, {}); res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [], usage: { prompt_tokens: 1200, completion_tokens: 180, total_tokens: 1380 } })}\n\n`); res.end('data: [DONE]\n\n'); };
  if (last?.role === 'tool') {
    await streamText(chunk, '命令已执行，输出为 `hi`。工具调用正常完成。', fixture.delayMs);
    finish(); return;
  }
  if (lastUserText.includes('__TOOL__')) {
    await streamText(chunk, '我先运行一个命令看看环境。', fixture.delayMs);
    chunk({ tool_calls: [{ index: 0, id: 'call_fx_1', type: 'function', function: { name: 'bash', arguments: '' } }] });
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"echo hi"}' } }] });
    finish('tool_calls'); return;
  }
  if (lastUserText.includes('__HOLD__')) {
    for (const t of ['先分析一下需求。', '用户想看流式输出。', '我会给出一个 Markdown 回答。']) { chunk({ reasoning_content: t }); await sleep(120); }
    await streamText(chunk, ANSWER.slice(0, 160), fixture.delayMs);
    await new Promise(r => fixture.held.push(r));
    await streamText(chunk, ANSWER.slice(160), 20);
    finish(); return;
  }
  if (lastUserText.includes('__THINK__')) {
    for (const t of ['思考第一步：理解问题。', '思考第二步：组织答案。']) { chunk({ reasoning_content: t }); await sleep(100); }
  }
  await streamText(chunk, ANSWER, fixture.delayMs / 3);
  finish();
});
await new Promise(r => fixtureServer.listen(FIXTURE_PORT, '127.0.0.1', r));
fixture.release = () => { const r = fixture.held.shift(); if (r) r(); return !!r; };

// ---------------- electron ----------------
let app, page;
const consoleLog = [], pageErrors = [];
async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', harness], env: { ...process.env, HOME: home, OPENBUDDY_SMOKE_TEST: '0', LANG: 'zh_CN.UTF-8' }, timeout: 60000 });
  app.process().stdout.on('data', d => { for (const line of String(d).split('\n')) if (line.trim()) consoleLog.push({ src: 'main-stdout', line: line.slice(0, 1000), at: Date.now() }); });
  app.process().stderr.on('data', d => { for (const line of String(d).split('\n')) if (line.trim()) consoleLog.push({ src: 'main-stderr', line: line.slice(0, 1000), at: Date.now() }); });
  page = await app.firstWindow();
  page.on('pageerror', e => pageErrors.push({ message: e.message, stack: String(e.stack).slice(0, 800), at: Date.now() }));
  page.on('console', m => consoleLog.push({ src: 'renderer', type: m.type(), line: m.text().slice(0, 1000), at: Date.now() }));
  await page.waitForLoadState('domcontentloaded');
  return { url: page.url(), profile: await app.evaluate(({ app }) => app.getPath('userData')) };
}
async function shot(name, opts = {}) {
  const f = join(OUT, name.endsWith('.png') ? name : name + '.png');
  await page.screenshot({ path: f, ...opts });
  return f;
}
async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(w, h); }, [w, h]);
  await sleep(400);
  return page.evaluate(() => [innerWidth, innerHeight]);
}
const ctx = {
  get page() { return page; }, get app() { return app; }, fixture, FIXTURE_PORT, profile, home, sleep, shot, setSize, launch,
  consoleLog, pageErrors,
  call: (command, payload = {}) => page.evaluate(({ command, payload }) => window.openbuddy.invoke(command, payload), { command, payload }),
  audit: () => app.evaluate(() => ({ main: globalThis.__ipcAudit, renderer: globalThis.__rendererRejects })),
};
globalThis.ctx = ctx;

const control = createServer(async (req, res) => {
  let body = ''; for await (const b of req) body += b;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('ctx', 'page', 'app', body);
    const result = await fn(ctx, page, app);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }, null, 1));
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e && e.stack || e).slice(0, 3000) }));
  }
});
await new Promise(r => control.listen(CONTROL_PORT, '127.0.0.1', r));
console.log('DRIVER_READY', JSON.stringify({ CONTROL_PORT, FIXTURE_PORT, profile }));
if (process.env.AUTOLAUNCH !== '0') console.log('LAUNCHED', JSON.stringify(await launch()));
process.on('SIGTERM', async () => { await app?.close().catch(() => {}); process.exit(0); });
