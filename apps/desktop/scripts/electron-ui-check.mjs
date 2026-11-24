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
// The model list re-renders while it scrolls, so a plain click can hit a detached
// node ("element is not stable"). Retry a few times instead of failing the run.
async function clickStable(locator, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      await locator.click({ timeout: 10000 });
      return;
    } catch (error) {
      if (i === attempts - 1) throw error;
    }
  }
}
async function choose(providerLabel) {
  await clickStable(page.getByRole('button', { name: /^选择模型：/ }));
  await page.getByRole('searchbox', { name: '搜索模型或提供商' }).fill(providerLabel);
  await clickStable(page.getByRole('group', { name: providerLabel, exact: true }).getByRole('option'));
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
  // 快速问答 (G1-31) 的一次性会话也会广播模型状态：它不是任务，状态助手要跳过。
  const latest = await page.evaluate(() => window.__modelStates.filter((s) => s.sessionId !== window.__qaExcluded).at(-1));
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
  await page.screenshot({ path: 'release/ui-composer.png' });
  // G1-22: a real selection inside the answer opens the floating toolbar; 引用 keeps a source.
  const selectedAnswer = await page.evaluate(() => {
    const answer = [...document.querySelectorAll('.turn__answer')].at(-1);
    const node = answer?.querySelector('p') ?? answer;
    if (!node) return false;
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return selection.toString().trim().length > 0;
  });
  assert.equal(selectedAnswer, true, 'answer text is selectable');
  await page.getByRole('toolbar', { name: '选中文字操作' }).waitFor();
  await page.screenshot({ path: 'release/ui-selection-toolbar.png' });
  await page.getByRole('button', { name: '引用到输入框' }).click();
  await page.waitForFunction(() => document.querySelector('.wb-composer__input')?.value.includes('—— 来自'));
  const quoted = await page.locator('.wb-composer__input').inputValue();
  assert.match(quoted, /^> fixture B answered/);
  await page.locator('.wb-composer__input').fill('');
  checkpoint('selecting answer text quotes it with its source', { quoted: quoted.slice(0, 60) });

  // G1-16: `+ → 应用` lists what is really installed (here: nothing) and says so.
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem', { name: '应用', exact: true }).hover();
  await page.getByText('还没有安装任何应用', { exact: true }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: 'release/ui-app-picker.png' });
  await page.keyboard.press('Escape');
  checkpoint('the app picker lists the installed applications and has an empty state', {});

  // G1-31: 快速问答 — the selected fragment is answered in its own session.
  await page.evaluate(() => {
    const answer = [...document.querySelectorAll('.turn__answer')].at(-1);
    const node = answer?.querySelector('p') ?? answer;
    if (!node) return;
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole('toolbar', { name: '选中文字操作' }).waitFor();
  await page.getByRole('button', { name: '快速问答' }).click();
  await page.getByRole('dialog', { name: '快速问答' }).waitFor();
  const qaDialog = page.getByRole('dialog', { name: '快速问答' });
  await qaDialog.getByRole('textbox', { name: '快速问答的问题' }).fill('这段在说什么');
  const qaRequests = requests.length;
  await qaDialog.getByRole('button', { name: '提问' }).click();
  await page.waitForFunction(() => (document.querySelector('.quick-qa__answer')?.textContent ?? '').length > 0, undefined, { timeout: 30000 });
  const qaAnswer = (await page.locator('.quick-qa__answer').innerText()).trim();
  const qaSession = await page.evaluate(() => document.querySelector('.quick-qa')?.getAttribute('data-qa-session') ?? '');
  await page.evaluate((id) => { window.__qaExcluded = id; }, qaSession);
  assert.ok(requests.length > qaRequests, 'quick QA sent its own request');
  assert.ok(!qaAnswer.includes('MAGIC'), 'quick QA answered in its own session');
  await page.screenshot({ path: 'release/ui-quick-qa.png' });
  await qaDialog.getByRole('button', { name: '关闭快速问答' }).click();
  await qaDialog.waitFor({ state: 'hidden' });
  checkpoint('quick QA answers the quoted fragment in its own session', { answer: qaAnswer.slice(0, 40) });
  // 思考等级是一个药丸按钮（WorkBuddy 对齐），展开后才是等级列表。
  const thinkingPill = page.getByRole('button', { name: /思考等级/ });
  await thinkingPill.click();
  await page.getByRole('option', { name: '高', exact: true }).click();
  actual = await state(); assert.equal(actual.thinkingLevel, 'high');
  const thinkingRequest = requests.length + 1;
  await send('check fixture reasoning request'); await waitForRequestCount(thinkingRequest);
  assert.equal(requests.at(-1).input.reasoning_effort, 'high');
  checkpoint('thinking changed through the actual pill and SDK request', { level: actual.thinkingLevel, reasoningEffort: requests.at(-1).input.reasoning_effort });
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
  await page.locator('.wb-composer__input').fill('fixture follow-up');
  await page.getByRole('radiogroup', { name: '排队模式' }).getByRole('radio', { name: '完成后发送' }).click();
  await page.getByRole('button', { name: '加入待发送队列', exact: true }).click();
  await page.getByRole('region', { name: '排队中的消息' }).getByText('fixture follow-up', { exact: true }).waitFor();
  await page.locator('.wb-composer__input').fill('fixture steering');
  await page.getByRole('radiogroup', { name: '排队模式' }).getByRole('radio', { name: '立即插话' }).click();
  await page.getByRole('button', { name: '加入待发送队列', exact: true }).click();
  await page.getByRole('region', { name: '排队中的消息' }).getByText('fixture steering', { exact: true }).waitFor();
  const queueSession = (await state()).sessionId;
  const queued = await call('agent_get_queue', { sessionId: queueSession });
  assert.deepEqual(queued.steering, ['fixture steering']); assert.deepEqual(queued.followUp, ['fixture follow-up']);
  await page.getByRole('button', { name: '全部撤回', exact: true }).click();
  await page.getByRole('region', { name: '排队中的消息' }).waitFor({ state: 'hidden' });
  assert.deepEqual(await call('agent_get_queue', { sessionId: queueSession }), { steering: [], followUp: [] });
  assert.equal(typeof releaseHeldResponse, 'function'); releaseHeldResponse();
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
  checkpoint('actual composer queues steering and follow-up in Pi then clears both', {});
  const parent = await state();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '复制会话', exact: true }).click();
  await page.waitForFunction(parentId => window.__modelStates.at(-1)?.sessionId !== parentId, parent.sessionId);
  const child = await state(); assert.notEqual(child.sessionId, parent.sessionId); assert.equal(child.providerId, parent.providerId); assert.equal(child.thinkingLevel, parent.thinkingLevel);
  await page.getByRole('button', { name: '编辑标题', exact: true }).click();
  await page.locator('.main-topbar__title-input').fill('Fixture fork child');
  await page.locator('.main-topbar__title-input').press('Enter');
  await page.getByText('Fixture fork child', { exact: true }).first().waitFor();
  checkpoint('actual topbar copy selects new session and retains provider/thinking', { parent: parent.sessionId, child: child.sessionId });

  // G1-27/G1-30: 删除该消息 / 清空上下文并新开 (真实 UI → 真实会话)。
  const promptsBefore = await page.locator('.msg--user').count();
  assert.ok(promptsBefore > 0, 'the copied session shows the copied prompts');
  await page.locator('.msg--user').first().hover();
  await page.screenshot({ path: 'release/ui-delete-message.png' });
  await page.getByRole('button', { name: '删除该消息', exact: true }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForFunction(count => document.querySelectorAll('.msg--user').length === count - 1, promptsBefore);
  const afterDelete = await page.locator('.msg--user').count();
  assert.equal(afterDelete, promptsBefore - 1, 'deleting a message removes that prompt from the transcript');
  checkpoint('actual user message delete removes the turn from the transcript', { before: promptsBefore, after: afterDelete });
  // WorkBuddy 对齐：聊天页顶栏是「📁 空间 / 会话名」的面包屑。
  const crumb = await page.locator('.main-topbar__crumb').first().innerText().catch(() => '');
  assert.ok(crumb.includes('/'), 'the chat topbar shows the WorkBuddy breadcrumb');
  await page.screenshot({ path: 'release/ui-topbar-crumb.png', clip: { x: 0, y: 0, width: 1200, height: 90 } }).catch(() => {});

  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '清空上下文并新开', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '清空并重新开始', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.msg--user').length === 0);
  assert.equal(await page.locator('.msg--user').count(), 0, 'clearing the context empties the conversation');
  checkpoint('actual clear-context keeps the task and empties the conversation', {});

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
  // G1-30: selection mode toggles rows instead of navigating; cancel leaves the list intact.
  await page.getByRole("button", { name: "批量选择任务" }).click();
  const bulkRows = page.locator(".sidebar__conv");
  await bulkRows.first().click(); await bulkRows.nth(1).click();
  await page.getByText("已选 2 项").waitFor();
  await page.screenshot({ path: 'release/ui-batch-select.png' });
  await page.getByRole("region", { name: "批量操作" }).getByRole("button", { name: "取消" }).click();
  await page.getByText("已选 2 项").waitFor({ state: "hidden" });
  checkpoint('sidebar batch selection counts rows without navigating', {});
  // G1-15: a workspace file shows up under + → 引用对话中的文件.
  await writeFile(join(init.cwd, 'ui-reference.md'), '# reference\n');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.locator('.iam-item').filter({ hasText: '引用对话中的文件' }).hover();
  await page.getByText('ui-reference.md', { exact: true }).waitFor();
  await page.screenshot({ path: 'release/ui-reference-menu.png' });
  await page.keyboard.press('Escape');
  checkpoint('reference menu lists a workspace file', {});
  // G3-1: a real .mmd file in the workspace renders as an SVG diagram in the workbench.
  await writeFile(join(init.cwd, 'ui-diagram.mmd'), 'graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[完成]\n  B -->|否| D[重试]\n');
  await page.getByRole('button', { name: '展开右侧栏' }).click();
  await page.getByRole('tab', { name: '文件' }).click();
  await page.getByText('ui-diagram.mmd', { exact: true }).click();
  await page.locator('.af-mermaid svg').waitFor({ timeout: 20000 });
  const diagramSvg = await page.evaluate(() => {
    const svg = document.querySelector('.af-mermaid svg');
    return svg ? { tag: svg.tagName, bytes: Math.round((svg.outerHTML || '').length) } : null;
  });
  assert.ok(diagramSvg && diagramSvg.bytes > 200, 'the mermaid artifact renders an SVG');
  await page.screenshot({ path: 'release/ui-mermaid.png' });
  checkpoint('a mermaid artifact renders as an SVG diagram', diagramSvg);
  await page.getByRole('button', { name: '收起右侧栏' }).click();

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
  await page.getByText('数据来自本机各任务的真实用量（含缓存读取）。阈值只作提醒，不会阻止发送；费用按模型定价估算。', { exact: true }).waitFor();
  checkpoint('quota clearly states reminder rather than send enforcement', {});
  await more.hover(); await page.getByRole('menuitem', { name: '通知渠道', exact: true }).click();
  await page.getByText('渠道由主进程发送：审批请求、后台任务完成与失败都会推送到已启用的渠道。', { exact: true }).waitFor();
  checkpoint('notification channels state host-side delivery for enabled channels', {});

  // G2-4: the security centre lists the installed skills and can review them statically.
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  await page.getByText('安全中心', { exact: true }).first().click();
  await page.getByText('受保护路径', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('tab', { name: '技能审查' }).click();
  await page.getByText('技能安全审查', { exact: true }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: 'release/ui-security-skills.png' });
  checkpoint('the security centre shows the tool rules and the skill review card', {});
  // G2-1: five sections, keyboard reachable; the sandbox policy is editable for real.
  const tabNames = await page.getByRole('tab').allInnerTexts();
  assert.deepEqual(tabNames, ['工具管控', '沙箱与网络', '技能审查', '审计日志', '系统授权']);
  await page.getByRole('tab', { name: '沙箱与网络' }).click();
  await page.getByText('沙箱与网络策略', { exact: true }).waitFor();
  const fileInput = page.getByPlaceholder('允许写入的路径片段，例如 /work/output');
  await fileInput.fill('/work/output');
  const fileGroup = page.locator('.sec-sandbox__group').first();
  await fileGroup.getByRole('button', { name: '添加' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('/work/output'), undefined, { timeout: 10000 });
  await page.getByRole('tab', { name: '审计日志' }).click();
  await page.getByText('审计日志', { exact: true }).first().waitFor();
  await page.screenshot({ path: 'release/ui-security-audit.png' });
  await page.getByRole('tab', { name: '系统授权' }).click();
  await page.getByText('麦克风', { exact: true }).waitFor();
  checkpoint('the security centre exposes the sandbox policy and the audit log', { tabs: tabNames });
  await page.getByRole('button', { name: '关闭' }).first().click().catch(() => {});

  // G1-17: 设计风格 chip sits after the model selector and lands in the prompt as a
  // prefix. This runs last because it opens a new task, which resets the current
  // session's model to the home default.
  await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
  await page.getByRole('tab', { name: '设计创意' }).click();
  const styleChip = page.getByRole('button', { name: /设计风格：/ });
  await styleChip.waitFor({ timeout: 15000 });
  await styleChip.click();
  await page.getByRole('option', { name: /专业严谨/ }).click();
  await page.getByRole('button', { name: '设计风格：专业严谨' }).waitFor();
  await page.screenshot({ path: 'release/ui-status-chip.png' });
  const styleRequest = requests.length + 1;
  await send('check fixture design style');
  await waitForRequestCount(styleRequest);
  const styleContent = requests.at(-1).input.messages.findLast(message => message.role === 'user')?.content;
  const styleText = typeof styleContent === 'string'
    ? styleContent
    : Array.isArray(styleContent)
      ? styleContent.filter(part => part.type === 'text').map(part => part.text).join('\n')
      : '';
  assert.match(styleText, /【风格：专业严谨】/);
  // The chip lives on the home design scene only; the chat composer has no status chip.
  await page.locator('.msg--user').first().waitFor({ timeout: 15000 });
  const bubbleText = await page.locator('.msg--user').first().innerText();
  assert.ok(!bubbleText.includes('【风格：'), 'the style prefix stays out of the user bubble');
  assert.equal(await page.getByRole('button', { name: /设计风格：/ }).count(), 0);
  checkpoint('the design-style chip writes its prefix into the prompt but not the bubble', { prefix: '【风格：专业严谨】', bubble: bubbleText.trim() });

  // WorkBuddy chat input (real app, 1440×900): a 16px hairline card whose main area
  // stays transparent (`.cr-input-box__main{background:0 0}`), a 15px editor, the
  // WorkBuddy placeholder, and a filled round send button with a white arrow.
  const composerSkin = await page.evaluate(() => {
    const card = document.querySelector('.wb-composer');
    const slot = document.querySelector('.wb-composer__main');
    const input = document.querySelector('.wb-composer__input');
    const send = document.querySelector('.wb-composer__send');
    const sendStyle = send ? getComputedStyle(send) : null;
    const inputStyle = input ? getComputedStyle(input) : null;
    return {
      cardRadius: card ? getComputedStyle(card).borderRadius : '',
      cardWidth: card ? Math.round(card.getBoundingClientRect().width) : 0,
      viewport: window.innerWidth,
      slotFill: slot ? getComputedStyle(slot).backgroundColor : '',
      slotGradient: slot ? getComputedStyle(slot).backgroundImage : '',
      sendFill: sendStyle?.backgroundColor ?? '',
      sendSize: sendStyle ? [sendStyle.width, sendStyle.height] : [],
      sendRadius: sendStyle?.borderRadius ?? '',
      inputFont: inputStyle?.fontSize ?? '',
      inputLineHeight: inputStyle?.lineHeight ?? '',
      placeholder: input?.getAttribute('placeholder') ?? '',
    };
  });
  assert.match(composerSkin.cardRadius, /^16px/);
  // WorkBuddy's chat card is exactly 800px wide, centred in the content area.
  assert.equal(composerSkin.cardWidth, 800);
  assert.equal(composerSkin.slotFill, 'rgba(0, 0, 0, 0)');
  assert.equal(composerSkin.slotGradient, 'none');
  assert.deepEqual(composerSkin.sendSize, ['32px', '32px']);
  assert.equal(composerSkin.sendRadius, '50%');
  assert.equal(composerSkin.inputFont, '15px');
  assert.equal(composerSkin.placeholder, '今天帮你做些什么？ @ 引用资产文件、项目待办或调用技能');
  // Empty input keeps the WorkBuddy disabled look (20% black circle); typing switches
  // it to the near-black circle (#000000e6).
  assert.equal(composerSkin.sendFill, 'rgba(0, 0, 0, 0.2)');
  await page.locator('.wb-composer__input').fill('对齐检查');
  await page.waitForFunction(() => {
    const send = document.querySelector('.wb-composer__send');
    return !!send && getComputedStyle(send).backgroundColor === 'rgba(0, 0, 0, 0.9)';
  }, undefined, { timeout: 10000 });
  const sendFillReady = await page.evaluate(() => {
    const send = document.querySelector('.wb-composer__send');
    return send ? getComputedStyle(send).backgroundColor : '';
  });
  assert.equal(sendFillReady, 'rgba(0, 0, 0, 0.9)');
  await page.screenshot({ path: 'release/ui-composer.png' });
  await page.locator('.wb-composer__input').fill('');
  checkpoint('the chat composer matches the WorkBuddy input skin', { ...composerSkin, sendFillReady });

  // WorkBuddy home: the gradient input slot lives on the home composer only.
  await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
  await page.locator('.wb-composer--home').waitFor({ timeout: 15000 });
  const homeSkin = await page.evaluate(() => {
    const slot = document.querySelector('.wb-composer--home .wb-composer__main');
    return { gradient: slot ? getComputedStyle(slot).backgroundImage : '' };
  });
  assert.match(homeSkin.gradient, /linear-gradient/);
  await page.screenshot({ path: 'release/ui-composer-home.png' });
  checkpoint('the home composer keeps the WorkBuddy gradient input slot', homeSkin);
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
