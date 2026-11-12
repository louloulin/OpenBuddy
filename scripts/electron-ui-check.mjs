import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

// Functional automation in a real Electron process importing the exact supplied
// main module. The temporary bootstrap selects an isolated profile and packaged
// file:// mode. This is separate from installation/Gatekeeper/executable smoke.
const require = createRequire(import.meta.url);
const main = resolve(process.argv.find(arg => arg.startsWith('--main='))?.slice(7) ?? 'dist-electron/main.js');
const temp = await mkdtemp(join(tmpdir(), 'openbuddy-real-ui-'));
const profile = join(temp, 'profile'), harness = join(temp, 'bootstrap');
await mkdir(profile); await mkdir(harness); await mkdir('release', { recursive: true });
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'openbuddy-ui-check', main: 'bootstrap.cjs' }));
await writeFile(join(harness, 'bootstrap.cjs'), `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});Object.defineProperty(app,'isPackaged',{get:()=>true});import(${JSON.stringify(pathToFileURL(main).href)}).catch(e=>{console.error(e);app.exit(1)});`);
const requests = [], checks = [], consoleErrors = [];
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let body = ''; for await (const bytes of req) body += bytes;
  const input = JSON.parse(body);
  const provider = req.url.startsWith('/a/') ? 'a' : req.url.startsWith('/b/') ? 'b' : 'c';
  requests.push({ provider, model: input.model, input });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'ui-fixture', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk({ role: 'assistant' }); chunk({ content: `fixture ${provider.toUpperCase()} answered` }); chunk({}, 'stop'); res.end('data: [DONE]\n\n');
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

  const imagePath = join(temp, 'fixture-pixel.png');
  await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
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
  await call('window_toggle_maximize');
  await page.waitForFunction(() => window.openbuddy.window.isMaximized());
  await call('window_toggle_maximize');
  await call('window_minimize');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].restore(); });
  checkpoint('actual BrowserWindow maximize and minimize controls', {});
  if (process.argv.includes('--native-dialogs')) {
    console.log('NATIVE_DIALOG_AWAIT_ASK', JSON.stringify({ pid: app.process().pid }));
    assert.equal(await call('dialog_ask', { message: 'Confirm local fixture validation', title: 'OpenBuddy native fixture' }), true);
    console.log('NATIVE_DIALOG_AWAIT_OPEN', JSON.stringify({ path: imagePath, pid: app.process().pid }));
    assert.equal(await call('dialog_open', { title: 'OpenBuddy native file fixture' }), imagePath);
    const exportPath = join(temp, 'native-export.txt');
    console.log('NATIVE_DIALOG_AWAIT_SAVE', JSON.stringify({ path: exportPath, pid: app.process().pid }));
    assert.equal(await call('dialog_save', { title: 'OpenBuddy native save fixture', defaultPath: exportPath }), exportPath);
    await call('export_text_file', { path: exportPath, content: 'native save grant fixture' });
    assert.equal(await readFile(exportPath, 'utf8'), 'native save grant fixture');
    checkpoint('real native ask/open/save and one-shot export grant', {});
  }
  const persisted = await state();
  await page.screenshot({ path: 'release/electron-ui-check.png', fullPage: true });
  await app.close(); app = undefined;
  await launch();
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
  assert.deepEqual(consoleErrors, []);
  await writeFile('release/electron-ui-check.json', JSON.stringify({ mode: 'Electron bootstrap imports supplied main in isolated profile; not installation verification', main, profile, checks, requestSummary: requests.map(({ provider, model }) => ({ provider, model })), screenshot: 'release/electron-ui-check.png', consoleErrors }, null, 2));
  console.log('ELECTRON_UI_PASS', checks.length, 'release/electron-ui-check.json');
} catch (error) {
  if (page) { await page.screenshot({ path: 'release/electron-ui-check-failed.png' }).catch(() => {}); console.error('UI_BODY', await page.locator('body').innerText().catch(() => 'unavailable')); }
  await writeFile('release/electron-ui-check-failed.json', JSON.stringify({ main, profile, checks, message: String(error), consoleErrors }, null, 2));
  throw error;
} finally {
  await app?.close().catch(() => {});
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
