import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * U5 真机截图 (20261127-upup)：真实 Electron + 本机 UpUp checkout + 本地 fixture 模型。
 *
 *   node apps/desktop/scripts/u5-ui-shots.mjs
 *
 * fixture 模型在一轮里先调 `ob_app_recommend`，再调 UpUp 真实的 `market_data_quote`（联网取行情），
 * 然后回答。截图：
 *   release/ui-u5-finance-card.png   对话里的数据卡 + 推荐卡
 *   release/ui-u5-hygiene.png        应用页「长期未使用」治理卡（把最近使用日改到 30 天前）
 */
const require = createRequire(import.meta.url);
const main = resolve(process.env.OPENBUDDY_MAIN ?? 'dist-electron/main.js');
const repo = process.env.UPUP_REPO ?? join(process.env.HOME ?? '', 'stock', 'upup');
const temp = await mkdtemp(join(tmpdir(), 'openbuddy-u5-shots-'));
const profile = join(temp, 'profile');
const harness = join(temp, 'bootstrap');
await mkdir(profile);
await mkdir(harness);
await mkdir('release', { recursive: true });
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'openbuddy-u5-shots', main: 'bootstrap.cjs' }));
await writeFile(join(harness, 'bootstrap.cjs'), `
const {app}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
import(${JSON.stringify(pathToFileURL(main).href)}).catch(e=>{console.error(e);app.exit(1)});
`);

// 本地 OpenAI 协议 fixture：推荐 → 行情 → 回答。
let n = 0;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  const data = JSON.parse(body);
  const last = data.messages.at(-1);
  const result = last?.role === 'tool' ? JSON.stringify(last.content) : '';
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  const call = (name, args) => { chunk({ tool_calls: [{ index: 0, id: `c${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); chunk({}, 'tool_calls'); };
  chunk({ role: 'assistant' });
  const names = (data.tools ?? []).map((t) => t.function?.name);
  if (!result && names.includes('ob_app_recommend')) call('ob_app_recommend', { query: '查一下北向资金和贵州茅台的股价' });
  else if (result && (result.includes('推荐给用户') || result.includes('没有更合适')) && names.includes('market_data_quote')) call('market_data_quote', { symbol: '600519', market: 'cn' });
  else { chunk({ content: '贵州茅台最新行情见下方数据卡（来源与截至时间已标注）。仅供研究参考，不构成投资建议。' }); chunk({}, 'stop'); }
  res.end('data: [DONE]\n\n');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const app = await electron.launch({
  executablePath: require('electron'),
  args: [harness],
  env: { ...process.env, OPENBUDDY_SMOKE_TEST: '0', OPENBUDDY_DEFAULT_APPS: 'off' },
  timeout: 30000,
});
const errors = [];
const page = await app.firstWindow();
page.on('pageerror', (error) => errors.push(String(error)));
await page.setViewportSize({ width: 1440, height: 960 }).catch(() => {});
const call = (command, payload = {}) => page.evaluate(({ command, payload }) => window.openbuddy.invoke(command, payload), { command, payload });
await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 30000 });

await call('providers_save_provider', { provider: { id: 'fixture', providerKind: 'custom', label: 'Fixture', baseUrl: `http://127.0.0.1:${port}/v1`, apiBackend: 'chat_completions', authScheme: 'bearer', apiKey: 'local-fixture-only' } });
await call('providers_save_model', { model: { providerId: 'fixture', modelId: 'fixture', name: 'Fixture', contextWindow: 64000, maxTokens: 1024 } });
await call('agent_extensions_install_package', { source: repo });
await call('agent_extensions_set_enabled', { enabled: true });
await call('permission_mode_set', { mode: 'always-approve' });

// 选 fixture 模型并发送。
await page.getByRole('button', { name: /^选择模型：/ }).click();
await page.getByRole('searchbox', { name: '搜索模型或提供商' }).fill('Fixture');
await page.getByRole('group', { name: 'Fixture', exact: true }).getByRole('option').first().click();
const input = page.locator('.wb-composer__input');
await input.fill('茅台现在多少钱？');
await page.getByRole('button', { name: '发送', exact: true }).click();
// 新空间第一次用扩展需要信任：通过真实 UI 授权，再发一次。
const trust = page.getByRole('button', { name: '信任', exact: true });
if (await trust.isVisible({ timeout: 5000 }).catch(() => false)) {
  await trust.click();
  await page.waitForTimeout(1500);
}
const card = page.getByRole('article', { name: /^行情 / });
if (!(await card.isVisible({ timeout: 60000 }).catch(() => false))) {
  await input.fill('再看一次茅台的行情');
  await page.getByRole('button', { name: '发送', exact: true }).click();
}
await card.first().waitFor({ timeout: 120000 });
await page.getByRole('complementary', { name: /^推荐应用 / }).first().waitFor({ timeout: 10000 });
await card.first().scrollIntoViewIfNeeded();
await page.screenshot({ path: 'release/ui-u5-finance-card.png' });
const cardText = await card.first().innerText();
const recText = await page.getByRole('complementary', { name: /^推荐应用 / }).first().innerText();
console.log('U5_SHOT_CARD', JSON.stringify(cardText.split('\n').slice(0, 8)));
console.log('U5_SHOT_REC', JSON.stringify(recText.split('\n')));

// 治理卡：把 UpUp 的最近使用日改到 30 天前，再打开应用页。
const usagePath = join(profile, 'pi', 'app-usage.json');
const apps = await call('apps_list', {});
const upup = apps.find((a) => a.id === 'upup');
await writeFile(usagePath, JSON.stringify({ lastUsed: { [upup.installedPath]: '2026-10-28' }, kept: {} }));
await page.getByRole('button', { name: /更多.*文件/ }).hover();
await page.getByRole('menuitem', { name: '应用', exact: true }).click();
await page.getByRole('region', { name: '长期未使用的应用' }).waitFor({ timeout: 20000 });
await page.screenshot({ path: 'release/ui-u5-hygiene.png' });
console.log('U5_SHOT_HYGIENE', JSON.stringify((await page.getByRole('region', { name: '长期未使用的应用' }).innerText()).split('\n')));

console.log('U5_SHOTS_DONE', JSON.stringify({ errors }));
await app.close();
server.closeAllConnections();
server.close();
process.exit(errors.length ? 1 : 0);
