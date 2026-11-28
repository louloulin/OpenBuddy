// 启动自检真机走查 (20261127-upup §1.18)：真实 Electron + 打包形态的渲染页 + 内置 UpUp + 真实模型。
//
//   pnpm build && node apps/desktop/scripts/build-electron.mjs
//   OPENBUDDY_REAL_BASE_URL=… OPENBUDDY_REAL_API_KEY=… OPENBUDDY_REAL_MODEL_ID=… node apps/desktop/scripts/self-check-ui.mjs
//
// 启动后自动自检写日志；设置 → 帮助与反馈 → 运行自检（勾选测试默认模型）真实请求模型；
// 再跑一轮真实对话确认应用照常工作。截图 release/ui-self-check.png，报告 release/self-check-ui.json。
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const baseUrl = process.env.OPENBUDDY_REAL_BASE_URL, apiKey = process.env.OPENBUDDY_REAL_API_KEY, modelId = process.env.OPENBUDDY_REAL_MODEL_ID;
if (!baseUrl || !apiKey || !modelId) throw new Error('需要 OPENBUDDY_REAL_BASE_URL / OPENBUDDY_REAL_API_KEY / OPENBUDDY_REAL_MODEL_ID');
const main = resolve(process.env.OPENBUDDY_MAIN ?? 'dist-electron/main.js');
const temp = await mkdtemp(join(tmpdir(), 'openbuddy-selfcheck-ui-'));
const profile = join(temp, 'profile'), harness = join(temp, 'bootstrap'), resources = join(temp, 'Resources');
await mkdir(profile); await mkdir(harness); await mkdir(resources); await mkdir('release', { recursive: true });
// 打包形态：内置 UpUp 在 <resources>/upup，这里指向构建产物 vendor/upup。
await symlink(resolve('vendor/upup'), join(resources, 'upup'));
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'openbuddy-selfcheck-ui', main: 'bootstrap.cjs' }));
await writeFile(join(harness, 'bootstrap.cjs'), `
const {app}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});
import(${JSON.stringify(pathToFileURL(main).href)}).catch(e=>{console.error(e);app.exit(1)});
`);
const readLogs = async () => {
  const dir = join(profile, 'logs');
  const files = (await readdir(dir)).filter(f => f.startsWith('openbuddy-'));
  return (await Promise.all(files.map(f => readFile(join(dir, f), 'utf8')))).join('').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, label) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() > until) throw new Error(`timeout: ${label}`);
    await sleep(250);
  }
}

const out = {};
const app = await electron.launch({ executablePath: require('electron'), args: [harness], env: { ...process.env, OPENBUDDY_SMOKE_TEST: '0', OPENBUDDY_SELF_CHECK_DELAY_MS: '1500' }, timeout: 60_000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.setViewportSize({ width: 1440, height: 960 }).catch(() => {});
  await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 60_000 });

  // 1) 启动自检：没配模型时自动跑一遍，「模型配置」失败，内置 UpUp 完整。
  const startup = await waitFor(async () => (await readLogs()).find(r => r.message === 'self-check'), 30_000, 'startup self-check');
  out.startup = { level: startup.level, counts: startup.data.counts, issues: startup.data.issues, file: startup.data.file };
  assert.equal(startup.data.issues.find(i => i.id === 'apps.bundled'), undefined, 'bundled UpUp is complete');
  assert.ok(startup.data.issues.some(i => i.id === 'model.config' && i.status === 'fail'));
  console.log('SELF_CHECK_UI startup', JSON.stringify(out.startup));

  // 2) 配真实模型，设置 → 帮助与反馈 → 运行自检（默认勾选测试模型）。
  const call = (command, payload = {}) => page.evaluate(({ command, payload }) => window.openbuddy.invoke(command, payload), { command, payload });
  await call('providers_save_provider', { provider: { id: 'real', providerKind: 'custom_anthropic', label: 'Real', baseUrl, apiBackend: 'messages', authScheme: 'x_api_key', apiKey } });
  await call('providers_save_model', { model: { providerId: 'real', modelId, displayName: modelId } });
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  await page.getByText('帮助与反馈', { exact: true }).first().click();
  await page.getByRole('button', { name: /运行自检/ }).click();
  const list = page.getByRole('list', { name: '自检结果' });
  await list.waitFor({ timeout: 90_000 });
  const rows = await list.locator('li').evaluateAll(items => items.map(li => ({ id: li.dataset.check, status: li.querySelector('[data-status]')?.dataset.status, text: li.innerText.replace(/\s+/g, ' ') })));
  out.ui = { status: await page.locator('.diag-status').first().innerText(), rows };
  console.log('SELF_CHECK_UI rows', JSON.stringify(out.ui));
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId['model.config'].status, 'pass');
  assert.equal(byId['model.reachable'].status, 'pass', byId['model.reachable'].text);
  assert.equal(byId['apps.bundled'].status, 'pass');
  assert.ok(!JSON.stringify(rows).includes(apiKey) && !JSON.stringify(rows).includes(profile));
  await list.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'release/ui-self-check.png' });
  const reports = (await readdir(join(profile, 'diagnostics'))).filter(f => f.startsWith('self-check-'));
  out.reports = reports.length;
  assert.ok(reports.length >= 2, 'startup + manual reports saved');

  // 3) 真实模型一轮对话：自检之后应用照常工作。
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭' }).first().click().catch(() => {});
  await call('permission_mode_set', { mode: 'always-approve' });
  await page.getByRole('button', { name: /^选择模型：/ }).click();
  await page.getByRole('searchbox', { name: '搜索模型或提供商' }).fill(modelId);
  await page.getByRole('group', { name: 'Real', exact: true }).getByRole('option').first().click();
  const started = Date.now();
  await page.locator('.wb-composer__input').fill('只回复四个字：自检通过');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText(/自检通过/).last().waitFor({ timeout: 120_000 });
  await waitFor(async () => !(await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)), 120_000, 'turn finished');
  out.chat = { ms: Date.now() - started };
  console.log('SELF_CHECK_UI chat', JSON.stringify(out.chat));

  const trims = (await readLogs()).filter(r => r.message === 'heap-trim').map(r => ({ reason: r.data.reason, rssMb: r.data.rssMb, heapTotalMb: r.data.heapTotalMb }));
  out.heapTrim = trims;
  out.errors = errors;
  console.log('SELF_CHECK_UI heap', JSON.stringify(trims), 'errors', JSON.stringify(errors));
} finally {
  await app.close().catch(() => {});
}
await writeFile('release/self-check-ui.json', JSON.stringify({ at: new Date().toISOString(), model: modelId, ...out }, null, 2));
console.log('SELF_CHECK_UI_OK', errors.length);
