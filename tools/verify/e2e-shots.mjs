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
  // R1: the additive host_capabilities command, called through the real renderer → preload → IPC path.
  const caps = await step('host capabilities', `
    const caps = await ctx.call('host_capabilities');
    return { protocolVersion: caps.protocolVersion, platform: caps.platform, commands: caps.commands.length, events: caps.events.length, includesSelf: caps.commands.includes('host_capabilities'), includesNative: caps.commands.includes('dialog_open') && caps.events.includes('window://resized'), features: caps.features };`);
  if (caps.protocolVersion !== 1 || caps.platform !== 'desktop' || !caps.includesSelf || !caps.includesNative) throw new Error(`unexpected host_capabilities: ${JSON.stringify(caps)}`);
  // 20261116-pii W2.1–W2.3: 专家中心 → 我的专家 → 新建 → 召唤（只预填，不发送）→ 发送 → 模型收到的系统提示词带人设 → 解绑。
  await step('experts center', `
    await page.keyboard.press('Escape');
    await page.locator('button[aria-label="关闭设置"]').waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.wb-composer__add').first().click();
    await page.locator('.iam-item', { hasText: '专家' }).first().hover();
    const footer = page.locator('.iam-sub-footer', { hasText: '专家中心' });
    await footer.waitFor({ timeout: 5000 });
    await footer.click();
    await page.getByText('精选场景', { exact: true }).waitFor({ timeout: 15000 });
    await page.locator('.ec-grid [data-expert-id="data-analyst"]').waitFor({ timeout: 10000 });
    const count = await page.locator('.ec-grid .ec-card').count();
    if (count < 8) throw new Error('expected at least 8 built-in experts, got ' + count);
    await ctx.sleep(600);
    return { cards: count, shot: await ctx.shot('20-experts-center') };`);
  await step('experts detail', `
    await page.locator('.ec-grid [data-expert-id="data-analyst"]').click();
    const dialog = page.getByRole('dialog', { name: '专家：数据分析师' });
    await dialog.waitFor({ timeout: 5000 });
    await ctx.sleep(400);
    const shot = await ctx.shot('21-expert-detail');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    return shot;`);
  await step('my experts (empty)', `
    await page.getByRole('button', { name: '我的专家' }).click();
    await page.getByText('还没有创建任何专家', { exact: true }).waitFor({ timeout: 5000 });
    await ctx.sleep(400);
    return await ctx.shot('22-my-experts-empty');`);
  await step('expert editor: create', `
    await page.getByRole('button', { name: '+ 创建专家' }).first().click();
    const editor = page.getByRole('dialog', { name: '创建专家' });
    await editor.waitFor({ timeout: 5000 });
    await editor.getByRole('button', { name: '头像 🌱' }).click();
    await editor.getByLabel('专家名称').fill('旅行规划师');
    await editor.getByLabel('类别').selectOption('office');
    await editor.getByLabel('简介').fill('按预算和兴趣规划行程，给出每天的路线、交通和备选方案。');
    await editor.getByLabel('人设').fill('你是一名细致的旅行规划师。先确认出发地、天数、预算和兴趣，再给出按天拆分的行程：每段写清交通方式、时长和费用估算，并为雨天准备备选方案。');
    await editor.getByLabel('示例任务').fill('帮我规划一个三天两晚的杭州周末行程，预算 2000 元\\n周末带父母去苏州，安排轻松一点的路线');
    await editor.getByLabel('标签').fill('行程规划，预算');
    await ctx.sleep(400);
    const shot = await ctx.shot('23-expert-editor');
    await editor.getByRole('button', { name: '创建', exact: true }).click();
    await editor.waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('.ec-my-card', { hasText: '旅行规划师' }).waitFor({ timeout: 5000 });
    await ctx.sleep(500);
    const list = await ctx.call('agents_list', {});
    if (!list.some(e => e.name === '旅行规划师' && e.scope === 'user')) throw new Error('agents_list does not contain the new expert');
    return [shot, await ctx.shot('24-my-experts')];`);
  await step('summon → composer prefilled (not sent)', `
    const before = ctx.fixture.requests.length;
    await page.locator('.ec-my-card', { hasText: '旅行规划师' }).getByRole('button', { name: '召唤' }).click();
    const input = page.locator('.wb-composer__input');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="composer-expert"]', { hasText: '旅行规划师' }).waitFor({ timeout: 5000 });
    // The chip renders first; the sample task lands in a follow-up render (HomePage effect), so poll.
    await page.waitForFunction(() => document.querySelector('.wb-composer__input')?.value.includes('杭州'), null, { timeout: 5000 }).catch(() => {});
    const value = await input.inputValue();
    if (!value.includes('杭州')) throw new Error('composer was not pre-filled with the sample task: ' + value);
    await ctx.sleep(1500);
    if (ctx.fixture.requests.length !== before) throw new Error('summon must not send anything');
    return { prefilled: value, shot: await ctx.shot('25-summon-prefilled') };`);
  await step('send → persona reaches the model', `
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('人设已生效：旅行规划师', { exact: false }).first().waitFor({ timeout: 30000 });
    const last = ctx.fixture.requests.at(-1);
    if (last.persona !== '旅行规划师') throw new Error('system prompt did not carry the persona: ' + JSON.stringify(last));
    await page.locator('[data-testid="bound-expert"]', { hasText: '旅行规划师' }).waitFor({ timeout: 5000 });
    await ctx.sleep(1200);
    return { persona: last.persona, shot: await ctx.shot('26-persona-answer') };`);
  await step('unbind expert', `
    await page.getByRole('button', { name: '移除专家 旅行规划师' }).click();
    await page.locator('[data-testid="bound-expert"]').waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('.wb-composer__input').fill('谢谢，再确认一下行程');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('以上内容由本地测试服务器生成', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(1000);
    const last = ctx.fixture.requests.at(-1);
    if (last.persona) throw new Error('persona still sent after unbinding');
    return await ctx.shot('27-expert-unbound');`);
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
