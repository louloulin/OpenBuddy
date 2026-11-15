#!/usr/bin/env node
// Real-Electron end-to-end verification + screenshots (20261115-md §13).
//
// Starts the existing ui-explore driver (real Electron + the built dist-electron/main.js,
// isolated throwaway profile, local OpenAI-compatible SSE fixture, no real keys) under Xvfb,
// then walks the main path: home → chat with Markdown answer → tool approval → agent writes
// files → workbench → settings. Fails on any missing UI, renderer page error or
// not_implemented IPC rejection.
//
// Usage: node tools/verify/e2e-shots.mjs <outDir>
//   requires a fresh `pnpm build:electron`; Linux needs xvfb-run.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.argv[2] ?? join(REPO, 'docs/plan/shots-20261115-md/latest'));
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 47223);
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT || 47224);
const RUN_DIR = join(tmpdir(), `openbuddy-e2e-${process.pid}`);
const driver = ['apps/desktop/scripts/ui-explore/driver.mjs', 'scripts/ui-explore/driver.mjs'].map(p => join(REPO, p)).find(existsSync);
if (!driver) throw new Error('ui-explore driver not found');
await mkdir(OUT, { recursive: true });

const env = { ...process.env, SHOTS_DIR: OUT, RUN_DIR, CONTROL_PORT: String(CONTROL_PORT), FIXTURE_PORT: String(FIXTURE_PORT) };
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const child = useXvfb
  ? spawn('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', 'node', driver], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn('node', [driver], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', d => { log += d; });
child.stderr.on('data', d => { log += d; });
const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);

async function waitFor(pattern, ms) {
  const deadline = Date.now() + ms;
  while (!pattern.test(log)) {
    if (child.exitCode !== null) throw new Error(`driver exited early:\n${log.slice(-3000)}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${pattern}:\n${log.slice(-3000)}`);
    await new Promise(r => setTimeout(r, 200));
  }
}
async function ev(name, body) {
  const res = await fetch(`http://127.0.0.1:${CONTROL_PORT}/`, { method: 'POST', body });
  const json = await res.json();
  if (!json.ok) throw new Error(`step "${name}" failed:\n${json.error}`);
  console.log('E2E_STEP', name, JSON.stringify(json.result ?? null).slice(0, 300));
  return json.result;
}

const steps = [];
const step = async (name, body) => { const result = await ev(name, body); steps.push({ name, result }); return result; };
let failure;
try {
  await waitFor(/LAUNCHED/, 90_000);
  await step('home', `
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 60000 });
    await ctx.setSize(1440, 900);
    await ctx.sleep(800);
    return await ctx.shot('01-home');`);
  await step('configure fixture provider', `
    await ctx.call('providers_save_provider', { provider: { id: 'fixture', providerKind: 'custom', label: 'Fixture', baseUrl: 'http://127.0.0.1:${FIXTURE_PORT}/v1', apiBackend: 'chat_completions', authScheme: 'bearer', apiKey: 'local-fixture-only' } });
    await ctx.call('providers_save_model', { model: { providerId: 'fixture', modelId: 'fixture-model', name: 'Fixture 模型', reasoning: true, input: ['text', 'image'], contextWindow: 128000, maxTokens: 4096 } });
    await ctx.call('agents_defaults_save', { defaults: { defaultModel: 'fixture-model', defaultProviderId: 'fixture', defaultPermission: 'ask' } });
    await page.getByRole('button', { name: /^选择模型：/ }).first().waitFor({ timeout: 20000 });
    return await ctx.call('providers_list');`);
  await step('chat markdown answer', `
    const input = page.locator('.wb-composer__input');
    await input.fill('__LONG__ 帮我整理一个重构方案');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('完成后再运行一次', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(1200);
    return await ctx.shot('02-chat-markdown');`);
  // Markdown host behaviour (R6): the code-block copy button must reach the main-process clipboard.
  await step('code block copy', `
    const before = (await ctx.audit()).main.filter(r => r.command === 'clipboard_write_text').length;
    const copy = page.locator('button.md-code-action').first();
    await copy.scrollIntoViewIfNeeded();
    await copy.hover();
    await copy.click();
    await page.locator('button.md-code-action[aria-label="已复制"]').first().waitFor({ timeout: 5000 });
    const after = (await ctx.audit()).main.filter(r => r.command === 'clipboard_write_text').length;
    if (after !== before + 1) throw new Error('code block copy did not call clipboard_write_text');
    await ctx.sleep(2500);
    return { clipboardWrites: after };`);
  await step('tool approval', `
    const input = page.locator('.wb-composer__input');
    await input.fill('__TOOL__ 看看当前环境');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const allow = page.getByRole('button', { name: '允许本次', exact: true });
    await allow.waitFor({ timeout: 30000 });
    await ctx.sleep(600);
    const shot = await ctx.shot('03-approval');
    await allow.click();
    await page.getByText('工具调用正常完成', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(800);
    return [shot, await ctx.shot('04-tool-done')];`);
  await step('agent writes files → workbench', `
    await ctx.call('permission_mode_set', { mode: 'always-approve' });
    const input = page.locator('.wb-composer__input');
    await input.fill('__FILES__ 生成季度报告、看板和数据');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('已定稿', { exact: false }).first().waitFor({ timeout: 60000 });
    await ctx.sleep(1000);
    const toggle = page.getByRole('button', { name: '展开右侧栏', exact: true });
    if (await toggle.isVisible()) await toggle.click();
    await ctx.sleep(1500);
    return await ctx.shot('05-workbench');`);
  await step('settings', `
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    await ctx.sleep(1200);
    return await ctx.shot('06-settings');`);
  // Every settings section, so splitting SettingsSections (R8) is covered by before/after shots.
  const SETTINGS_SECTIONS = [['account', '账户管理'], ['agent-mail', '智能体邮箱'], ['shortcuts', '快捷键'], ['model', '模型'], ['assistant', '助理设置'], ['personalize', '个性化'], ['security', '安全中心'], ['help', '帮助与反馈']];
  await step('settings sections', `
    const out = [];
    for (const [id, label] of ${JSON.stringify(SETTINGS_SECTIONS)}) {
      await page.locator('.settings-navigation__label').getByText(label, { exact: true }).first().click();
      await ctx.sleep(700);
      out.push(await ctx.shot('07-settings-' + id));
    }
    return out;`);
  // 20261116-pii W0.4: 设置 · 智能体 — persisted Pi settings (pi-settings.json), reopened to prove they stuck.
  await step('agent settings persisted (pii W0.4)', `
    await page.locator('.settings-navigation__label').getByText('智能体', { exact: true }).first().click();
    const compaction = page.getByRole('switch', { name: '自动压缩' }).first();
    await compaction.waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    const before = await ctx.shot('08-settings-agent');
    if (!(await compaction.isChecked())) throw new Error('auto-compaction should start on');
    // Click the visible track, as a user does (the label toggles its hidden checkbox).
    await page.locator('label.ob-switch', { has: compaction }).first().click();
    await page.getByRole('radiogroup', { name: '追加的发送方式' }).getByRole('radio', { name: '合并' }).click();
    await page.getByText('已保存，已打开的任务立即生效').first().waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await ctx.sleep(500);
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    await page.locator('.settings-navigation__label').getByText('智能体', { exact: true }).first().click();
    const reopened = page.getByRole('switch', { name: '自动压缩' }).first();
    await reopened.waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    if (await reopened.isChecked()) throw new Error('auto-compaction switch did not persist');
    const merged = await page.getByRole('radiogroup', { name: '追加的发送方式' }).getByRole('radio', { name: '合并' }).getAttribute('aria-checked');
    if (merged !== 'true') throw new Error('follow-up mode did not persist');
    const saved = await ctx.call('settings_agent_get');
    if (saved.autoCompaction.enabled !== false || saved.followUpMode !== 'all') throw new Error('settings_agent_get: ' + JSON.stringify(saved));
    const after = await ctx.shot('09-settings-agent-persisted');
    await page.keyboard.press('Escape');
    await ctx.sleep(400);
    return { before, after, autoCompaction: saved.autoCompaction, followUpMode: saved.followUpMode, builtins: saved.builtins.map(b => b.id + ':' + b.enabled) };`);
  // W1.6: star two models in the model menu (pi-settings enabledModels), then Ctrl+P cycles them in this task.
  await step('model favourites (pii W1.6)', `
    await ctx.call('providers_save_model', { model: { providerId: 'fixture', modelId: 'fixture-priced', name: 'Fixture 计费', input: ['text'], contextWindow: 64000, maxTokens: 4096, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } } });
    await ctx.sleep(800);
    await page.getByRole('button', { name: /^选择模型：/ }).first().click();
    await page.getByRole('listbox', { name: '可用模型' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '收藏 Fixture 模型', exact: true }).click();
    await page.getByRole('button', { name: '取消收藏 Fixture 模型', exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '收藏 Fixture 计费', exact: true }).click();
    await page.getByRole('button', { name: '取消收藏 Fixture 计费', exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('option', { name: /Fixture 计费/ }).hover();
    await ctx.sleep(500);
    const menu = await ctx.shot('10-model-menu-favorites');
    await page.keyboard.press('Escape');
    const saved = await ctx.call('settings_agent_get');
    if (saved.favoriteModels.length !== 2) throw new Error('favourites not saved: ' + JSON.stringify(saved.favoriteModels));
    await page.locator('.wb-composer__input').click();
    await page.keyboard.press('Control+P');
    await page.getByRole('button', { name: /^选择模型：Fixture 计费/ }).first().waitFor({ timeout: 10000 });
    await page.getByText('已切换到 Fixture 计费').first().waitFor({ timeout: 5000 });
    await page.getByRole('img', { name: '当前模型不支持思考' }).first().waitFor({ timeout: 5000 });
    await ctx.sleep(300);
    const cycled = await ctx.shot('11-ctrl-p-cycled');
    const cycles = (await ctx.audit()).main.filter(r => r.command === 'agent_cycle_model' && r.status === 'resolved').length;
    if (cycles !== 1) throw new Error('agent_cycle_model calls: ' + cycles);
    return { menu, cycled, favoriteModels: saved.favoriteModels };`);
  // W1.5: context popover — this session's cost (priced model), 立即压缩 and the auto-compaction switch.
  await step('context popover (pii W1.5)', `
    const requests = ctx.fixture.requests.length;
    await page.locator('.wb-composer__input').fill('看看这一轮的费用');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('本地 fixture', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(1500);
    if (ctx.fixture.requests.length <= requests) throw new Error('no model request');
    await page.getByRole('button', { name: /上下文已使用/ }).first().click();
    await page.getByText('本会话费用').first().waitFor({ timeout: 10000 });
    const auto = page.getByRole('switch', { name: '自动压缩' }).first();
    if (await auto.isChecked()) throw new Error('popover switch should show the saved (off) setting');
    await ctx.sleep(400);
    const popover = await ctx.shot('12-context-popover');
    await page.locator('label.ob-switch', { has: auto }).first().click();
    await ctx.sleep(600);
    const saved = await ctx.call('settings_agent_get');
    if (saved.autoCompaction.enabled !== true) throw new Error('popover switch did not save');
    await page.getByRole('button', { name: '立即压缩', exact: true }).click();
    await page.locator('.context-usage__message').first().waitFor({ timeout: 30000 });
    await ctx.sleep(400);
    const compacted = await ctx.shot('13-context-compact');
    const message = await page.locator('.context-usage__message').first().textContent();
    const cost = await page.locator('.context-usage__cost .context-usage__footer-value').first().textContent();
    await page.keyboard.press('Escape');
    return { popover, compacted, cost, message, autoCompaction: saved.autoCompaction.enabled };`);
  // W0.5: 问一问 is kept by the host; leaving the task (ChatView unmounts) and coming back shows it again.
  await step('mode restored after switching sessions (pii W0.5)', `
    // The mode buttons carry a data-tip tooltip, so match them by their visible text.
    const ask = () => page.locator('.composer-mode__opt', { hasText: '问一问' }).first();
    await ask().click();
    await page.waitForFunction(() => document.querySelector('.composer-mode__opt--on')?.textContent === '问一问');
    const title = (await page.locator('.sidebar__conv--active .sidebar__conv-title').first().textContent()) ?? '';
    await page.keyboard.press('Control+N');
    await ask().waitFor({ state: 'detached', timeout: 10000 });
    await ctx.sleep(500);
    await page.locator('.sidebar__conv', { hasText: title }).first().click();
    await ask().waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('.composer-mode__opt--on')?.textContent === '问一问', null, { timeout: 10000 });
    await ctx.sleep(600);
    const shot = await ctx.shot('14-mode-restored');
    return { title, shot, checked: await ask().getAttribute('aria-checked') };`);
  // R1: the additive host_capabilities command, called through the real renderer → preload → IPC path.
  const caps = await step('host capabilities', `
    const caps = await ctx.call('host_capabilities');
    return { protocolVersion: caps.protocolVersion, platform: caps.platform, commands: caps.commands.length, events: caps.events.length, includesSelf: caps.commands.includes('host_capabilities'), includesNative: caps.commands.includes('dialog_open') && caps.events.includes('window://resized'), features: caps.features };`);
  if (caps.protocolVersion !== 1 || caps.platform !== 'desktop' || !caps.includesSelf || !caps.includesNative) throw new Error(`unexpected host_capabilities: ${JSON.stringify(caps)}`);
  const audit = await step('audit', `
    const a = await ctx.audit();
    const rejected = a.main.filter(r => r.status === 'rejected');
    return {
      invoked: a.main.length,
      distinctCommands: [...new Set(a.main.map(r => r.command))].length,
      byCommand: Object.fromEntries(Object.entries(a.main.reduce((m, r) => ({ ...m, [r.command]: (m[r.command] ?? 0) + 1 }), {})).sort()),
      rejected: rejected.map(r => ({ command: r.command, error: r.error })),
      notImplemented: [...a.main.filter(r => /not_implemented/.test(r.error ?? '')), ...a.renderer.filter(r => /not_implemented/.test(r.message))].map(r => r.command),
      pageErrors: ctx.pageErrors.map(e => e.message),
      fixtureRequests: ctx.fixture.requests.length,
    };`);
  if (audit.pageErrors.length) throw new Error(`renderer page errors: ${audit.pageErrors.join(' | ')}`);
  if (audit.notImplemented.length) throw new Error(`not_implemented: ${audit.notImplemented.join(', ')}`);
} catch (error) {
  failure = error;
} finally {
  await ev('close', 'await app?.close().catch(()=>{}); setTimeout(()=>process.exit(0),200); return "bye"').catch(() => {});
  stop();
  await rm(RUN_DIR, { recursive: true, force: true }).catch(() => {});
}
const report = { at: new Date().toISOString(), ok: !failure, error: failure ? String(failure.message ?? failure).slice(0, 4000) : undefined, steps };
await writeFile(join(OUT, 'e2e-report.json'), JSON.stringify(report, null, 2));
console.log(failure ? 'E2E_FAIL' : 'E2E_PASS', join(OUT, 'e2e-report.json'));
if (failure) { console.error(failure.message ?? failure); process.exit(1); }
process.exit(0);
