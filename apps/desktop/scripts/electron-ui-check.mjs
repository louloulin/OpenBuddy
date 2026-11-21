import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Functional automation in a real Electron process importing the exact supplied
// main module. The temporary bootstrap selects an isolated profile and packaged
// file:// mode. This is separate from installation/Gatekeeper/executable smoke.
const require = createRequire(import.meta.url);
const main = resolve(process.argv.find(arg => arg.startsWith('--main='))?.slice(7) ?? 'dist-electron/main.js');
const artifact = main.includes('.asar/') ? `${main.split('.asar/')[0]}.asar` : main;
const artifactSha256 = createHash('sha256').update(await readFile(artifact)).digest('hex');
const temp = await mkdtemp(join(tmpdir(), 'openbuddy-real-ui-'));
const profile = join(temp, 'profile'), harness = join(temp, 'bootstrap');
await mkdir(profile); await mkdir(harness); await mkdir('release', { recursive: true });
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'openbuddy-ui-check', main: 'bootstrap.cjs' }));
await writeFile(join(harness, 'bootstrap.cjs'), `
const {app,ipcMain}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
globalThis.__ipcAudit=[];
const realHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>realHandle(channel,async(event,...args)=>{
  if(channel!=='openbuddy:invoke')return listener(event,...args);
  const record={command:String(args[0]),status:'pending'};globalThis.__ipcAudit.push(record);
  try{const result=await listener(event,...args);record.status='resolved';return result;}
  catch(error){record.status='rejected';throw error;}
});
import(${JSON.stringify(pathToFileURL(main).href)}).catch(e=>{console.error(e);app.exit(1)});
`);
const requests = [], checks = [], consoleErrors = [];
let releaseHeldResponse;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let body = ''; for await (const bytes of req) body += bytes;
  const input = JSON.parse(body);
  const provider = req.url.startsWith('/a/') ? 'a' : req.url.startsWith('/b/') ? 'b' : 'c';
  requests.push({ provider, model: input.model, input });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'ui-fixture', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk({ role: 'assistant' });
  const lastUser = input.messages.findLast(message => message.role === 'user')?.content;
  const lastUserText = typeof lastUser === 'string' ? lastUser : Array.isArray(lastUser) ? lastUser.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
  if (lastUserText.includes('__HOLD_FIXTURE__')) {
    chunk({ content: 'fixture waiting for queued input' });
    releaseHeldResponse = () => { chunk({ content: ' fixture resumed' }); chunk({}, 'stop'); res.end('data: [DONE]\n\n'); releaseHeldResponse = undefined; };
    return;
  }
  chunk({ content: `fixture ${provider.toUpperCase()} answered` }); chunk({}, 'stop'); res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let app, page;
const call = (command, payload = {}) => page.evaluate(({ command, payload }) => window.openbuddy.invoke(command, payload), { command, payload });
const checkpoint = (name, evidence) => { checks.push({ name, evidence }); console.log('UI_CHECK', name, JSON.stringify(evidence)); };
async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: [harness], env: { ...process.env, OPENBUDDY_SMOKE_TEST: '0' }, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 30000 });
  const actualProfile = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(actualProfile, profile, 'must never use the user profile');
  await page.evaluate(() => { window.__modelStates = []; window.openbuddy.listen('agent://model-state', state => window.__modelStates.push(state)); });
}
async function choose(providerLabel) {
  await page.getByRole('button', { name: /^选择模型：/ }).click();
  await page.getByRole('searchbox', { name: '搜索模型或提供商' }).fill(providerLabel);
  await page.getByRole('group', { name: providerLabel, exact: true }).getByRole('option').click();
}
async function send(text) {
  const input = page.locator('.wb-composer__input');
  await input.fill(text); await page.getByRole('button', { name: '发送', exact: true }).click();
}
async function waitForRequestCount(count) {
  const deadline = Date.now() + 15000;
  while (requests.length < count) {
    if (Date.now() > deadline) throw new Error('fixture request timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
}
async function state() {
  const latest = await page.evaluate(() => window.__modelStates.at(-1));
  assert.ok(latest?.sessionId, 'the UI must receive an actual session model state');
  return call('agent_get_model_state', { sessionId: latest.sessionId });
}
try {
  await launch();
  for (const id of ['a', 'b', 'c']) {
    await call('providers_save_provider', { provider: { id: `fixture-${id}`, providerKind: 'custom', label: `Fixture ${id.toUpperCase()}`, baseUrl: `http://127.0.0.1:${port}/${id}/v1`, apiBackend: 'chat_completions', authScheme: 'bearer', ...(id === 'c' ? {} : { apiKey: 'local-fixture-only' }) } });
    await call('providers_save_model', { model: { providerId: `fixture-${id}`, modelId: 'shared-model', name: 'Shared fixture', reasoning: true, input: ['text', 'image'], contextWindow: 32000, maxTokens: 1024 } });
  }
  await choose('Fixture A');
  await send('hello from fixture A');
  await page.getByText('fixture A answered', { exact: true }).first().waitFor({ timeout: 15000 });
  // This is an explicitly generated, isolated workspace; authorize via real UI.
  const trust = page.getByRole('button', { name: '信任', exact: true });
  if (await trust.isVisible()) await trust.click();
  assert.equal(requests.at(-1).provider, 'a'); assert.equal(requests.at(-1).model, 'shared-model');
  let actual = await state(); assert.equal(actual.providerId, 'fixture-a');
  checkpoint('provider A same slug sends actual request to A', { provider: actual.providerId, modelKey: actual.modelKey });
  await choose('Fixture B');
  actual = await state(); assert.equal(actual.providerId, 'fixture-b');
  await send('hello from fixture B');
  await page.getByText('fixture B answered', { exact: true }).first().waitFor({ timeout: 15000 });
  assert.equal(requests.at(-1).provider, 'b'); assert.equal(requests.at(-1).model, 'shared-model');
  checkpoint('provider B same slug sends actual request to B', { provider: actual.providerId, modelKey: actual.modelKey });
  await page.getByRole('combobox', { name: '思考等级', exact: true }).selectOption('high');
  actual = await state(); assert.equal(actual.thinkingLevel, 'high');
  const thinkingRequest = requests.length + 1;
  await send('check fixture reasoning request'); await waitForRequestCount(thinkingRequest);
  assert.equal(requests.at(-1).input.reasoning_effort, 'high');
  checkpoint('thinking changed through actual select and SDK request', { level: actual.thinkingLevel, reasoningEffort: requests.at(-1).input.reasoning_effort });
  await choose('Fixture C');
  await page.getByRole('alert').filter({ hasText: '模型切换失败' }).waitFor();
  actual = await state(); assert.equal(actual.providerId, 'fixture-b');
  assert.equal(requests.filter(r => r.provider === 'c').length, 0);
  await page.keyboard.press('Escape');
  checkpoint('failed switch preserves actual model and emits no C request', { provider: actual.providerId });

  // Authorize only a protocol-created native File. There is no generic path grant.
  const extensionPath = join(temp, 'fixture-extension.ts');
  await writeFile(extensionPath, `export default function(pi){
    pi.registerCommand('fixture-input',{handler:async(_args,ctx)=>{const answer=await ctx.ui.input('Fixture input','fixture answer');ctx.ui.notify(answer===undefined?'fixture input cancelled':'fixture input accepted');}});
    pi.registerCommand('fixture-select',{handler:async(_args,ctx)=>{const answer=await ctx.ui.select('Fixture select',['one','two']);ctx.ui.notify(answer===undefined?'fixture select cancelled':'fixture select '+answer);}});
  }`);
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'native-fixture-file'; document.body.append(input); });
  await page.locator('#native-fixture-file').setInputFiles(extensionPath);
  await page.evaluate(() => window.openbuddy.getPathForFile(document.querySelector('#native-fixture-file').files[0]));
  await call('agent_extensions_add', { path: extensionPath });
  await call('agent_extensions_set_enabled', { enabled: true });
  await send('/fixture-input');
  const inputForm = page.getByRole('region', { name: 'Fixture input', exact: true });
  await inputForm.waitFor(); await inputForm.getByRole('textbox', { name: 'Fixture input', exact: true }).fill('safe fixture answer');
  await inputForm.getByRole('button', { name: '提交', exact: true }).click();
  await inputForm.waitFor({ state: 'hidden' });
  checkpoint('extension input accepted through actual form', {});
  await send('/fixture-select');
  const selectForm = page.getByRole('region', { name: 'Fixture select', exact: true });
  await selectForm.waitFor(); await selectForm.getByRole('button', { name: '取消', exact: true }).click();
  await selectForm.waitFor({ state: 'hidden' });
  checkpoint('extension select cancelled through actual form', {});

  const badImagePath = join(temp, 'bad-crc.png');
  await writeFile(badImagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  await page.locator('#native-fixture-file').setInputFiles(badImagePath);
  await page.evaluate(() => window.openbuddy.getPathForFile(document.querySelector('#native-fixture-file').files[0]));
  const beforeBadImage = requests.length;
  await assert.rejects(call('agent_send', { sessionId: (await state()).sessionId, text: 'reject bad CRC', attachments: [{ path: badImagePath }] }), /invalid_image/);
  assert.equal(requests.length, beforeBadImage, 'corrupt image never reached provider');
  checkpoint('actual main decoder rejects corrupt PNG before provider request', {});
  const imagePath = join(temp, 'fixture-pixel.png');
  await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'));
  await page.locator('#native-fixture-file').setInputFiles(imagePath);
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(document.querySelector('#native-fixture-file').files[0]);
    document.querySelector('.wb-composer').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.getByText('fixture-pixel.png', { exact: true }).waitFor();
  const requestCount = requests.length;
  await send('inspect genuine native File drop');
  await page.waitForFunction(() => document.querySelector('.wb-composer__input')?.value === '');
  await waitForRequestCount(requestCount + 1);
  assert.ok(requests.length > requestCount, 'image sent a real fixture request');
  const imageMessage = requests.at(-1).input.messages.findLast(message => message.role === 'user');
  assert.ok(Array.isArray(imageMessage.content) && imageMessage.content.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')), 'native File became actual image bytes in SDK request');
  checkpoint('DOM drop of genuine native File becomes SDK image bytes', { mimeType: 'image/png' });
  await send('__HOLD_FIXTURE__');
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor();
  await page.getByRole('combobox', { name: '排队模式', exact: true }).selectOption('followUp');
  await page.locator('.wb-composer__input').fill('fixture follow-up');
  await page.getByRole('button', { name: '加入待发送队列', exact: true }).click();
  await page.getByRole('region', { name: 'Pi 待处理队列' }).getByText('fixture follow-up', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: '排队模式', exact: true }).selectOption('steer');
  await page.locator('.wb-composer__input').fill('fixture steering');
  await page.getByRole('button', { name: '加入待发送队列', exact: true }).click();
  await page.getByRole('region', { name: 'Pi 待处理队列' }).getByText('fixture steering', { exact: true }).waitFor();
  const queueSession = (await state()).sessionId;
  const queued = await call('agent_get_queue', { sessionId: queueSession });
  assert.deepEqual(queued.steering, ['fixture steering']); assert.deepEqual(queued.followUp, ['fixture follow-up']);
  await page.getByRole('button', { name: '清空 Pi 队列', exact: true }).click();
  await page.getByRole('region', { name: 'Pi 待处理队列' }).waitFor({ state: 'hidden' });
  assert.deepEqual(await call('agent_get_queue', { sessionId: queueSession }), { steering: [], followUp: [] });
  assert.equal(typeof releaseHeldResponse, 'function'); releaseHeldResponse();
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
  checkpoint('actual composer queues steering and follow-up in Pi then clears both', {});
  const parent = await state();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '分叉为新会话', exact: true }).click();
  await page.waitForFunction(parentId => window.__modelStates.at(-1)?.sessionId !== parentId, parent.sessionId);
  const child = await state(); assert.notEqual(child.sessionId, parent.sessionId); assert.equal(child.providerId, parent.providerId); assert.equal(child.thinkingLevel, parent.thinkingLevel);
  await page.getByRole('button', { name: '编辑标题', exact: true }).click();
  await page.locator('.main-topbar__title-input').fill('Fixture fork child');
  await page.locator('.main-topbar__title-input').press('Enter');
  await page.getByText('Fixture fork child', { exact: true }).first().waitFor();
  checkpoint('actual topbar fork selects new session and retains provider/thinking', { parent: parent.sessionId, child: child.sessionId });
  await call('window_toggle_maximize');
  await page.waitForFunction(() => window.openbuddy.window.isMaximized());
  await call('window_toggle_maximize');
  await page.waitForFunction(async () => !await window.openbuddy.window.isMaximized());
  await call('window_minimize');
  const minimized = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMinimized()) return true;
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { window.removeListener('minimize', done); resolve(window.isMinimized()); }, 5000);
      window.once('minimize', done);
    });
  });
  assert.equal(minimized, true);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].restore(); });
  checkpoint('actual BrowserWindow maximize and minimize controls', {});
  if (process.argv.includes('--native-dialogs')) {
    console.log('NATIVE_DIALOG_AWAIT_ASK', JSON.stringify({ pid: app.process().pid }));
    assert.equal(await call('dialog_ask', { message: 'Confirm local fixture validation', title: 'OpenBuddy native fixture' }), true);
    console.log('NATIVE_DIALOG_AWAIT_OPEN', JSON.stringify({ path: imagePath, pid: app.process().pid }));
    const selected = await call('dialog_open', { title: 'OpenBuddy native file fixture', defaultPath: imagePath });
    assert.equal(await realpath(selected), await realpath(imagePath));
    const exportPath = join(temp, 'native-export.txt');
    console.log('NATIVE_DIALOG_AWAIT_SAVE', JSON.stringify({ path: exportPath, pid: app.process().pid }));
    const saved = await call('dialog_save', { title: 'OpenBuddy native save fixture', defaultPath: exportPath });
    assert.equal(typeof saved, 'string');
    await call('export_text_file', { path: saved, content: 'native save grant fixture' });
    assert.equal(await readFile(exportPath, 'utf8'), 'native save grant fixture');
    checkpoint('real native ask/open/save and one-shot export grant', {});
  }
  const persisted = await state();
  await page.screenshot({ path: 'release/electron-ui-check.png', fullPage: true });
  await app.close(); app = undefined;
  await launch();
  await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
  await page.getByRole('button', { name: /选择模型：.*Fixture A/ }).waitFor({ timeout: 15000 });
  checkpoint('restart restores complete provider-scoped home default', { provider: 'fixture-a', model: 'shared-model' });
  // The selected home default and session identity are tested separately.
  const init = await call('agent_init');
  const sessions = await call('agent_list_sessions', { cwd: init.cwd });
  assert.ok(sessions.some(session => session.id === persisted.sessionId || session.sessionId === persisted.sessionId), 'session persisted');
  // Restore using the existing visible sidebar entry, not direct state injection.
  const session = sessions.find(session => session.id === persisted.sessionId || session.sessionId === persisted.sessionId);
  const title = session.title ?? session.name ?? 'hello from fixture A';
  await page.getByText(title, { exact: true }).first().click();
  await page.getByRole('button', { name: /选择模型：.*Fixture B/ }).waitFor({ timeout: 15000 });
  const restored = await state(); assert.equal(restored.providerId, 'fixture-b'); assert.equal(restored.thinkingLevel, 'high');
  checkpoint('restart and actual sidebar restore provider and thinking', { provider: restored.providerId, thinkingLevel: restored.thinkingLevel });
  const beforeFiles = await app.evaluate(() => globalThis.__ipcAudit.length);
  await writeFile(join(init.cwd, 'ui-local-marker.txt'), 'local listing fixture');
  const more = page.getByRole('button', { name: /更多.*文件/ });
  await more.hover(); await page.getByRole('menuitem', { name: '我的文件', exact: true }).click();
  await page.locator('.myfiles-tab--active').filter({ hasText: '本地文件' }).waitFor();
  await page.getByText('ui-local-marker.txt', { exact: true }).waitFor();
  const fileCommands = await app.evaluate(start => globalThis.__ipcAudit.slice(start), beforeFiles);
  assert.equal(fileCommands.some(item => ['memory_list', 'browse_directory'].includes(item.command)), false);
  assert.ok(fileCommands.some(item => item.command === 'list_dir' && item.status === 'resolved'));
  await page.screenshot({ path: 'release/electron-ui-files.png', fullPage: true });
  checkpoint('MyFiles defaults to real list_dir and never invokes unsupported memory artifacts', { commands: fileCommands });
  await more.hover(); await page.getByRole('menuitem', { name: '策略设置', exact: true }).click();
  await page.getByText('本地策略预览，尚未强制执行', { exact: true }).waitFor();
  checkpoint('policy clearly states local preview without enforcement', {});
  await more.hover(); await page.getByRole('menuitem', { name: '用量统计', exact: true }).click();
  await page.getByText('阈值仅作本地用量提醒，不会阻止发送。费用为估算，实际以提供商账单为准。', { exact: true }).waitFor();
  checkpoint('quota clearly states reminder rather than send enforcement', {});
  await more.hover(); await page.getByRole('menuitem', { name: '通知渠道', exact: true }).click();
  await page.getByText('渠道配置尚未接入主进程，当前仅可管理本地草稿；外部发送与测试暂不可用。', { exact: true }).waitFor();
  checkpoint('notification channels clearly state drafts and no external send', {});
  const ipcAudit = await app.evaluate(() => globalThis.__ipcAudit);
  assert.deepEqual(consoleErrors, []);
  await writeFile('release/electron-ui-check.json', JSON.stringify({ mode: 'Electron bootstrap imports supplied main in isolated profile; not installation verification', main, artifact, artifactSha256, profile, checks, ipcAudit, requestSummary: requests.map(({ provider, model, input }) => ({ provider, model, reasoningEffort: input.reasoning_effort, imageCount: input.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url').length })), screenshot: 'release/electron-ui-check.png', consoleErrors }, null, 2));
  console.log('ELECTRON_UI_PASS', checks.length, 'release/electron-ui-check.json');
} catch (error) {
  if (page) { await page.screenshot({ path: 'release/electron-ui-check-failed.png' }).catch(() => {}); console.error('UI_BODY', await page.locator('body').innerText().catch(() => 'unavailable')); }
  await writeFile('release/electron-ui-check-failed.json', JSON.stringify({ main, profile, checks, message: String(error), consoleErrors }, null, 2));
  throw error;
} finally {
  await app?.close().catch(() => {});
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
