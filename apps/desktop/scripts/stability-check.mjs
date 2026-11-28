// 稳定性守护真机检查 (§1.16)：在真实 Electron 里加载构建好的 main，
// 强制崩溃渲染进程看能否自愈、超预算是否停手，阻塞主线程看卡顿是否写进 main-hang.log。
// 用法：node apps/desktop/scripts/stability-check.mjs [--main=dist-electron/main.js]
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const main = resolve(process.argv.find(arg => arg.startsWith('--main='))?.slice(7) ?? 'dist-electron/main.js');
const temp = await mkdtemp(join(tmpdir(), 'openbuddy-stability-'));
const profile = join(temp, 'profile'), harness = join(temp, 'bootstrap');
await mkdir(profile); await mkdir(harness); await mkdir('release', { recursive: true });
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'openbuddy-stability-check', main: 'bootstrap.cjs' }));
await writeFile(join(harness, 'bootstrap.cjs'), `
const {app,dialog}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
globalThis.__dialogs=[];
dialog.showMessageBox=async(_win,options)=>{globalThis.__dialogs.push(options.message);return {response:0};};
import(${JSON.stringify(pathToFileURL(main).href)}).catch(e=>{console.error(e);app.exit(1)});
`);

const checks = [];
const checkpoint = (name, evidence) => { checks.push({ name, evidence }); console.log('STABILITY_CHECK', name, JSON.stringify(evidence)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeoutMs = 20_000, label = 'condition') {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() > until) throw new Error(`timeout: ${label}`);
    await sleep(200);
  }
}
// Playwright 的 Page 在渲染进程崩溃后不会重新挂接，所以经主进程 executeJavaScript 访问页面。
const inPage = (code) => app.evaluate(({ BrowserWindow }, code) => {
  const wc = BrowserWindow.getAllWindows()[0]?.webContents;
  return wc && !wc.isCrashed() && !wc.isLoading() ? wc.executeJavaScript(code) : null;
}, code);
const bridgeReady = () => inPage("typeof window.openbuddy?.invoke === 'function' && !window.__beforeCrash");
const readLogs = async () => {
  const { readdir } = await import('node:fs/promises');
  const dir = join(profile, 'logs');
  const files = (await readdir(dir)).filter(f => f.startsWith('openbuddy-'));
  return (await Promise.all(files.map(f => readFile(join(dir, f), 'utf8')))).join('').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
};

const env = { ...process.env, OPENBUDDY_SMOKE_TEST: '0', OPENBUDDY_DEFAULT_APPS: 'off', OPENBUDDY_UNRESPONSIVE_GRACE_MS: '3000', OPENBUDDY_MEMORY_WARN_MB: '1', OPENBUDDY_MEMORY_INTERVAL_MS: '2000' };
let app = await electron.launch({ executablePath: require('electron'), args: [harness], env });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitFor(() => page.evaluate(() => typeof window.openbuddy?.invoke === 'function'), 30_000, 'preload bridge');

  // 1) 渲染进程崩溃 → 自动重载，页面恢复可用。
  await inPage('window.__beforeCrash = true');
  const started = Date.now();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await waitFor(bridgeReady, 30_000, 'renderer reload after crash');
  const recoveredMs = Date.now() - started;
  const settings = await inPage("window.openbuddy.invoke('agent_diagnose', {}).then(() => true, e => String(e))");
  const gone = (await readLogs()).filter(r => r.message === 'render-process-gone');
  assert.equal(gone.at(-1)?.data?.decision, 'reload');
  checkpoint('renderer-crash-auto-reload', { recoveredMs, invokeOk: settings, decision: gone.at(-1).data.decision, reason: gone.at(-1).data.reason });

  // 2) 一分钟内连续崩溃超过预算（3 次）→ 停止自动重载，弹窗交给用户。
  for (let i = 0; i < 3; i++) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await waitFor(async () => (await readLogs()).filter(r => r.message === 'render-process-gone').length >= 2 + i, 15_000, `crash ${i + 2} logged`);
    await sleep(1_500);
  }
  const decisions = (await readLogs()).filter(r => r.message === 'render-process-gone').map(r => r.data.decision);
  const dialogs = await waitFor(() => app.evaluate(() => globalThis.__dialogs.length ? globalThis.__dialogs : null), 10_000, 'give-up dialog');
  assert.deepEqual(decisions, ['reload', 'reload', 'reload', 'give-up']);
  checkpoint('renderer-crash-budget', { decisions, dialogs });
  // 用户选“重新加载”后窗口恢复。
  await waitFor(bridgeReady, 30_000, 'reload after dialog');
  checkpoint('renderer-reload-after-dialog', { ok: true });

  // 3) 主线程阻塞 7 秒 → 看门狗线程写 main-hang.log，恢复后写持续时长。
  await app.evaluate(() => { const until = Date.now() + 7_000; while (Date.now() < until) { /* block main */ } });
  const hangLog = join(profile, 'logs', 'main-hang.log');
  const hang = await waitFor(async () => {
    const events = (await readFile(hangLog, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    return events.some(e => e.event === 'main-recovered') ? events : null;
  }, 15_000, 'main-hang.log');
  const recovered = hang.find(e => e.event === 'main-recovered');
  assert.equal(hang[0].event, 'main-hang');
  assert.ok(recovered.hungMs >= 5_000, `hungMs=${recovered.hungMs}`);
  checkpoint('main-hang-watchdog', { events: hang.map(e => e.event), hungMs: recovered.hungMs, lagAtDetect: hang[0].lagMs });

  // 4) 渲染进程死循环 → Chromium 报 unresponsive → 宽限期后强制重启并重载。
  await inPage('window.__beforeCrash = true');
  const hangStart = Date.now();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('for(;;){}').catch(() => {}); });
  // Chromium 的卡死检测只认真实系统输入（sendInputEvent / 导航均不触发，实测 70s 无事件），
  // 所以渲染进程真卡死后由主进程补发 unresponsive，验证的是真实的“强制重启 + 重载”路径。
  await sleep(500);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].emit('unresponsive'); });
  await waitFor(async () => (await readLogs()).some(r => r.message === 'unresponsive-force-reload'), 15_000, 'unresponsive-force-reload');
  await waitFor(bridgeReady, 30_000, 'reload after hang');
  const hangLogs = (await readLogs()).filter(r => ['unresponsive', 'unresponsive-force-reload'].includes(r.message) || r.data?.decision === 'hang-reload');
  checkpoint('renderer-hang-force-reload', { recoveredMs: Date.now() - hangStart, events: hangLogs.map(r => r.message + (r.data?.decision ? `:${r.data.decision}` : '')), hungMs: hangLogs.find(r => r.message === 'unresponsive-force-reload')?.data?.hungMs });

  // 5) 卡顿之后应用照常响应。
  const alive = await inPage("window.openbuddy.invoke('agent_diagnose', {}).then(() => true, e => String(e))");
  checkpoint('alive-after-hang', { alive });

  // 6) 内存监测：阈值压到 1 MB，采样一次即告警且只告警一次。
  const memory = await waitFor(async () => (await readLogs()).filter(r => r.message === 'memory-high'), 10_000, 'memory-high');
  await sleep(4_500);
  const memoryAgain = (await readLogs()).filter(r => r.message === 'memory-high').length;
  assert.equal(memoryAgain, 1);
  checkpoint('memory-monitor', { totalMb: memory[0].data.totalMb, topType: memory[0].data.topType, processes: memory[0].data.processes, byType: memory[0].data.byType, warnings: memoryAgain });

  // 7) 单实例：同一 profile 再启动一次，第二个进程立即退出，已有窗口收到 second-instance。
  const { spawn } = await import('node:child_process');
  const second = spawn(require('electron'), [harness], { env, stdio: 'ignore' });
  const secondStarted = Date.now();
  const exitCode = await new Promise((resolveExit, reject) => { const t = setTimeout(() => { second.kill(); reject(new Error('second instance did not exit')); }, 20_000); second.on('exit', code => { clearTimeout(t); resolveExit(code); }); });
  await waitFor(async () => (await readLogs()).some(r => r.message === 'second-instance'), 10_000, 'second-instance log');
  const readyCount = (await readLogs()).filter(r => r.message === 'ready').length;
  assert.equal(readyCount, 1);
  checkpoint('single-instance', { exitCode, exitMs: Date.now() - secondStarted, readyCount });

  // 8) 主进程原生崩溃 → crashpad 落本地转储 → 下次启动解析并写进日志（只写文件名，不写路径）。
  await app.evaluate(() => { setTimeout(() => process.crash(), 50); }).catch(() => {});
  await waitFor(async () => { try { return app.process().exitCode !== null || app.process().signalCode !== null; } catch { return true; } }, 15_000, 'main crashed');
  await app.close().catch(() => {});
  app = await electron.launch({ executablePath: require('electron'), args: [harness], env });
  await app.firstWindow();
  const dumps = await waitFor(async () => { const l = (await readLogs()).filter(r => r.message === 'native-crash-dump'); return l.some(r => r.data?.summary?.kind === 'crash') ? l : null; }, 30_000, 'native-crash-dump log');
  const mainDump = dumps.find(r => r.data?.summary?.kind === 'crash');
  assert.ok(dumps.every(r => r.data?.summary), 'every dump parsed');
  assert.ok(!JSON.stringify(dumps).includes(profile), 'dump log must not leak paths');
  const { readdir } = await import('node:fs/promises');
  const seen = JSON.parse(await readFile(join(profile, 'logs', '.native-dumps-seen.json'), 'utf8'));
  checkpoint('native-crash-dump', { dumps: dumps.length, kinds: dumps.map(r => `${r.level}:${r.data.summary.kind}`), file: mainDump.data.file, sizeKb: mainDump.data.sizeKb, exception: mainDump.data.summary.exceptionName, fault: mainDump.data.summary.fault, executable: mainDump.data.summary.executable, seen: seen.length, completed: (await readdir(join(profile, 'Crashpad', 'completed')).catch(() => [])).length });
} finally {
  await app.close().catch(() => {});
}
await writeFile('release/stability-check.json', JSON.stringify({ main, at: new Date().toISOString(), checks }, null, 2));
console.log('STABILITY_OK', checks.length);
