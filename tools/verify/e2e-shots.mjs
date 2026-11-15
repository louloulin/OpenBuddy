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
  // 20261116-pii W1.1: regenerate → ‹ 2/2 ›, then switch back and forth; the transcript must change.
  await step('branch switcher', `
    const panel = page.getByRole('button', { name: '收起右侧栏', exact: true });
    if (await panel.isVisible()) await panel.click();
    const input = page.locator('.wb-composer__input');
    await input.fill('__BRANCH__ 给这个工作台写一句口号');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('口号版本 1', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(800);
    await page.locator('.turn--last').getByRole('button', { name: '重试', exact: true }).click();
    await page.getByText('口号版本 2', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.getByRole('group', { name: '回答版本 2/2' }).waitFor({ timeout: 15000 });
    await ctx.sleep(800);
    const transcript = () => page.locator('.chatview__inner').innerText();
    if ((await transcript()).includes('口号版本 1')) throw new Error('regenerate kept the old answer on screen');
    const two = await ctx.shot('08-branch-2of2');
    await page.getByRole('button', { name: '上一版本', exact: true }).click();
    await page.getByRole('group', { name: '回答版本 1/2' }).waitFor({ timeout: 15000 });
    await page.getByText('口号版本 1', { exact: false }).first().waitFor({ timeout: 15000 });
    let text = await transcript();
    if (!text.includes('口号版本 1') || text.includes('口号版本 2')) throw new Error('version 1 not shown: ' + text.slice(-300));
    await ctx.sleep(600);
    const one = await ctx.shot('08-branch-1of2');
    await page.getByRole('button', { name: '下一版本', exact: true }).click();
    await page.getByRole('group', { name: '回答版本 2/2' }).waitFor({ timeout: 15000 });
    await page.getByText('口号版本 2', { exact: false }).first().waitFor({ timeout: 15000 });
    text = await transcript();
    if (!text.includes('口号版本 2') || text.includes('口号版本 1')) throw new Error('version 2 not shown again: ' + text.slice(-300));
    return [two, one];`);
  // W1.2: \`!echo hello\` runs in the task; the output row streams in (and reaches the model next turn).
  await step('bang command', `
    const input = page.locator('.wb-composer__input');
    await input.fill('!echo hello');
    await page.locator('.bang-hint').waitFor({ timeout: 5000 });
    await ctx.sleep(300);
    const hint = await ctx.shot('09-bash-mode');
    await input.press('Enter');
    const row = page.locator('.bash-row').last();
    await row.waitFor({ timeout: 15000 });
    await row.locator('.bash-row__status--ok').waitFor({ timeout: 15000 });
    const output = await row.locator('.bash-row__output').innerText();
    if (!output.includes('hello')) throw new Error('bash output missing: ' + output);
    await ctx.sleep(600);
    return [hint, await ctx.shot('09-bash-output'), output.trim()];`);
  // W1.3: typing @ in a workspace task lists its files (this task's artifacts first) and inserts the pick.
  await step('@ file mention', `
    const input = page.locator('.wb-composer__input');
    await input.fill('看看 @');
    const list = page.getByRole('listbox', { name: '引用文件' });
    await list.waitFor({ timeout: 10000 });
    await list.getByRole('option').first().waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    const all = await ctx.shot('10-file-mention-all');
    const groups = await list.locator('.mention-pop__group').allInnerTexts().catch(() => []);
    await input.fill('看看 @rep');
    await list.getByRole('option').filter({ hasText: 'report.md' }).first().waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    const shot = await ctx.shot('10-file-mention');
    const items = await list.getByRole('option').allInnerTexts();
    await input.press('Enter');
    const value = await input.inputValue();
    if (!value.includes('@docs/report.md ')) throw new Error('mention not inserted: ' + value);
    await input.fill('');
    return { all, groups, shot, items: items.slice(0, 6), value };`);
  // 20261116-pii W3.1–W3.3: 想一想 records the plan with the built-in ob_todo tool (auto-allowed even in
  // "ask" mode), 按此计划执行 works through it, the transcript shows compact plan rows, the top bar the overview.
  await step('plan: 想一想 records steps with ob_todo', `
    await ctx.call('permission_mode_set', { mode: 'ask' });
    const collapse = page.getByRole('button', { name: '收起右侧栏', exact: true });
    if (await collapse.isVisible()) await collapse.click();
    // The tooltip (CSS ::after from data-tip) is part of the accessible name, so match the label text.
    await page.locator('.composer-mode__opt', { hasText: '想一想' }).click();
    const input = page.locator('.wb-composer__input');
    await input.fill('__PLAN__ 把季度销售数据整理成分析报告和看板');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '按此计划执行', exact: true }).waitFor({ timeout: 30000 });
    const card = page.getByRole('region', { name: '任务计划' });
    await card.getByText('0/4', { exact: true }).waitFor({ timeout: 10000 });
    if (await page.getByRole('button', { name: '允许本次', exact: true }).count()) throw new Error('ob_todo asked for approval');
    await ctx.sleep(800);
    return await ctx.shot('11-plan-ready');`);
  await step('plan: 按此计划执行 updates the steps', `
    await page.getByRole('button', { name: '按此计划执行', exact: true }).click();
    await page.getByText('需要你确认统计口径', { exact: false }).first().waitFor({ timeout: 60000 });
    const card = page.getByRole('region', { name: '任务计划' });
    await card.getByText('2/4', { exact: true }).waitFor({ timeout: 10000 });
    await card.getByLabel('第 3 步 进行中：撰写分析报告 docs/report.md').waitFor({ timeout: 5000 });
    if (await page.locator('.composer-mode__opt', { hasText: '做一做' }).getAttribute('aria-checked') !== 'true') throw new Error('mode did not switch to 做一做');
    if (await page.getByRole('button', { name: '允许本次', exact: true }).count()) throw new Error('ob_todo asked for approval');
    await ctx.sleep(800);
    return await ctx.shot('12-plan-progress');`);
  await step('plan: ob_todo rows in the transcript', `
    const fold = page.locator('.turn--last .turn__fold');
    if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
    const row = page.locator('.turn--last .toolrow', { hasText: '完成 #2' }).first();
    await row.waitFor({ timeout: 10000 });
    await row.scrollIntoViewIfNeeded();
    const rows = await page.locator('.turn--last .toolrow').allInnerTexts();
    if (!rows.some(t => t.includes('更新计划') && t.includes('开始 #3'))) throw new Error('missing compact ob_todo rows: ' + rows.join(' | '));
    if (rows.some(t => t.includes('"action"'))) throw new Error('raw ob_todo JSON in transcript');
    await ctx.sleep(600);
    return [await ctx.shot('13-plan-transcript'), rows.filter(t => t.includes('更新计划')).map(t => t.replace(/\\s+/g, ' '))];`);
  await step('plan: task overview popover', `
    const button = page.getByRole('button', { name: '任务概览', exact: true });
    await button.waitFor({ timeout: 10000 });
    const label = (await button.innerText()).replace(/\\s+/g, ' ');
    if (!label.includes('步骤 2/4') || !/产物 \\d+/.test(label)) throw new Error('unexpected overview label: ' + label);
    await button.click();
    const pop = page.getByRole('dialog', { name: '任务概览' });
    await pop.waitFor({ timeout: 5000 });
    for (const text of ['任务进度', '产物 ·', '任务进程 ·', 'report.md']) await pop.getByText(text, { exact: false }).first().waitFor({ timeout: 5000 });
    await ctx.sleep(600);
    const shot = await ctx.shot('14-task-overview');
    await page.keyboard.press('Escape');
    return [shot, label];`);
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
