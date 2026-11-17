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
  // 20261116-pii W6.1/W6.2: 安全中心 — 分类规则可改，受保护路径可增删并写入本地设置。
  await step('安全中心（受保护路径 + 规则）', `
    await page.locator('.settings-navigation__label').getByText('安全中心', { exact: true }).first().click();
    await page.getByText('受保护路径', { exact: true }).waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    const before = await ctx.shot('56-security-center');
    await page.getByPlaceholder('.env / *.pem / .git / config/secrets.json').fill('config/secrets.json');
    // 用卡片内的主按钮定位：按钮里带图标，按可访问名匹配容易受图标文本影响。
    await page.locator('.sec-card').filter({ hasText: '受保护路径' }).locator('.sec-btn--ink').click();
    await page.getByText('config/secrets.json', { exact: true }).waitFor({ timeout: 5000 });
    const gate = await ctx.call('permission_protected_get');
    if (!gate.paths.includes('config/secrets.json')) throw new Error('protected path not saved: ' + JSON.stringify(gate));
    await page.locator('.sec-add--rule select').selectOption('write');
    await page.locator('.sec-add--rule input').fill('e2e-protected');
    await page.locator('.sec-add--rule .sec-btn--ink').click();
    const rule = page.locator('.sec-rule', { hasText: 'e2e-protected' });
    await rule.waitFor({ timeout: 5000 });
    await rule.getByRole('button', { name: '拒绝' }).click();
    await ctx.sleep(500);
    const rules = await ctx.call('permission_list');
    if (!rules.some((r) => r.tool === 'write' && r.action === 'deny' && r.pattern === 'e2e-protected'))
      throw new Error('rule not saved: ' + JSON.stringify(rules));
    await ctx.sleep(400);
    const after = await ctx.shot('57-security-configured');
    // 清理，避免影响后续步骤。
    await rule.getByRole('button', { name: '删除规则 write' }).click();
    await page.getByRole('button', { name: '移除受保护路径 config/secrets.json' }).click();
    await ctx.sleep(400);
    const cleaned = await ctx.call('permission_protected_get');
    if (cleaned.paths.includes('config/secrets.json')) throw new Error('protected path not removed');
    return { before, after, paths: gate.paths, ruleSaved: true };`);
  // 20261116-pii W0.4: 设置 · 智能体 — persisted Pi settings (pi-settings.json), reopened to prove they stuck.
  await step('agent settings persisted (pii W0.4)', `
    await page.locator('.settings-navigation__label').getByText('智能体', { exact: true }).first().click();
    const compaction = page.getByRole('switch', { name: '自动压缩' }).first();
    await compaction.waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    const before = await ctx.shot('15-settings-agent');
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
    const after = await ctx.shot('16-settings-agent-persisted');
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
    const menu = await ctx.shot('17-model-menu-favorites');
    await page.keyboard.press('Escape');
    const saved = await ctx.call('settings_agent_get');
    if (saved.favoriteModels.length !== 2) throw new Error('favourites not saved: ' + JSON.stringify(saved.favoriteModels));
    await page.locator('.wb-composer__input').click();
    await page.keyboard.press('Control+P');
    await page.getByRole('button', { name: /^选择模型：Fixture 计费/ }).first().waitFor({ timeout: 10000 });
    await page.getByText('已切换到 Fixture 计费').first().waitFor({ timeout: 5000 });
    await page.getByRole('img', { name: '当前模型不支持思考' }).first().waitFor({ timeout: 5000 });
    await ctx.sleep(300);
    const cycled = await ctx.shot('18-ctrl-p-cycled');
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
    const popover = await ctx.shot('19-context-popover');
    await page.locator('label.ob-switch', { has: auto }).first().click();
    await ctx.sleep(600);
    const saved = await ctx.call('settings_agent_get');
    if (saved.autoCompaction.enabled !== true) throw new Error('popover switch did not save');
    await page.getByRole('button', { name: '立即压缩', exact: true }).click();
    await page.locator('.context-usage__message').first().waitFor({ timeout: 30000 });
    await ctx.sleep(400);
    const compacted = await ctx.shot('20-context-compact');
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
    const shot = await ctx.shot('21-mode-restored');
    return { title, shot, checked: await ask().getAttribute('aria-checked') };`);
  await step('close settings', `
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });
    return true;`);
  // pii W0.2/W0.3: the sidebar and 更多 only list what the host serves (host_capabilities + FeatureRegistry).
  await step('sidebar after cleanup', `
    const nav = await page.locator('.sidebar__nav [data-feature]').evaluateAll(els => els.map(e => e.getAttribute('data-feature') + ':' + e.textContent.trim()));
    if (await page.locator('.sidebar__nav').getByText('技能与 MCP', { exact: true }).count()) throw new Error('技能与 MCP is still a sidebar entry');
    const more = page.getByRole('button', { name: /更多.*文件/ });
    await more.hover();
    await page.locator('.sidebar__more-popover').waitFor({ timeout: 5000 });
    const moreItems = await page.locator('.sidebar__more-popover [role=menuitem]').allTextContents();
    // 灵感 is online since W2.8 (static scene cards); 策略设置 stays until W6 (it says it is a local preview).
    // 云存储 needs a provider account and must not be offered.
    if (moreItems.some(t => ['云存储'].includes(t.trim()))) throw new Error('offline entry offered: ' + moreItems.join(','));
    await ctx.sleep(400);
    const shot = await ctx.shot('22-sidebar-registry');
    await page.mouse.move(900, 500);
    await ctx.sleep(300);
    return { nav, moreItems, shot };`);
  // pii W0.3 acceptance: click every entry the registry renders; none may hit not_implemented.
  await step('click every entry', `
    const before = (await ctx.audit()).main.length;
    const visited = [];
    for (const id of await page.locator('.sidebar__nav > [data-feature]').evaluateAll(els => els.map(e => e.getAttribute('data-feature')))) {
      await page.locator('.sidebar__nav > [data-feature="' + id + '"]').click();
      await ctx.sleep(1000);
      visited.push(id);
    }
    const more = page.getByRole('button', { name: /更多.*文件/ });
    await more.hover();
    await page.locator('.sidebar__more-popover').waitFor({ timeout: 5000 });
    const moreIds = await page.locator('.sidebar__more-popover [data-feature]').evaluateAll(els => els.map(e => e.getAttribute('data-feature')));
    for (const id of moreIds) {
      await more.hover();
      await page.locator('.sidebar__more-popover [data-feature="' + id + '"]').click();
      await ctx.sleep(1000);
      visited.push(id);
    }
    const fresh = (await ctx.audit()).main.slice(before);
    const notImplemented = fresh.filter(r => /not_implemented/.test(r.error ?? '')).map(r => r.command);
    if (notImplemented.length) throw new Error('not_implemented while clicking entries: ' + notImplemented.join(','));
    return { visited, commands: [...new Set(fresh.map(r => r.command))].sort(), rejected: fresh.filter(r => r.status === 'rejected').map(r => r.command + ': ' + r.error), notImplemented };`);
  // W5.5: 资料库 has three tabs — 记忆 / 我的文件 / 知识库.
  await step('资料库三标签', `
    await page.locator('.sidebar__nav > [data-feature="library"]').click();
    await page.getByRole('tab', { name: '记忆' }).waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    const memory = await ctx.shot('38-library-memory');
    await page.getByRole('tab', { name: '我的文件' }).click();
    await page.locator('.my-files-panel, .resources-panel').first().waitFor({ timeout: 10000 });
    await ctx.sleep(800);
    const files = await ctx.shot('39-library-files');
    await page.getByRole('tab', { name: '知识库' }).click();
    await page.getByText('知识库', { exact: true }).first().waitFor({ timeout: 10000 });
    await ctx.sleep(700);
    const knowledge = await ctx.shot('40-library-knowledge');
    return { memory, files, knowledge };`);
  // W2.8: 灵感 is static scene cards; 存为指令 writes a /scene- prompt template.
  await step('灵感静态场景', `
    const more = page.getByRole('button', { name: /更多.*文件/ });
    await more.hover();
    await page.locator('.sidebar__more-popover [data-feature="inspiration"]').click();
    await page.getByRole('heading', { name: '财报分析全流程' }).waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    const cards = await page.locator('.inspiration-card').count();
    const grid = await ctx.shot('41-inspiration');
    const first = page.locator('.inspiration-card').first();
    await first.getByRole('button', { name: /存为指令/ }).click();
    await ctx.sleep(1200);
    const prompts = await ctx.call('prompts_list');
    const scene = prompts.find((entry) => String(entry.name).startsWith('scene-working-'));
    if (!scene) throw new Error('scene template not saved');
    return { cards, grid, scene: scene.name };`);
  // W5.6: 用量统计 reads the host's real usage snapshot.
  await step('用量统计', `
    const more = page.getByRole('button', { name: /更多.*文件/ });
    await more.hover();
    await page.locator('.sidebar__more-popover [data-feature="usage"]').click();
    await page.locator('.quota-panel__stat-value').first().waitFor({ timeout: 10000 });
    await ctx.sleep(1000);
    const values = await page.locator('.quota-panel__stat-value').allTextContents();
    const snapshot = await ctx.call('usage_snapshot');
    if (!snapshot || typeof snapshot.totals !== 'object') throw new Error('usage_snapshot shape: ' + JSON.stringify(snapshot));
    return { values, totals: snapshot.totals, shot: await ctx.shot('42-usage') };`);
  // 20261116-pii W4.1–W4.3: 自动化 — create a task, 测试运行 (a real background session), open its record.
  await step('自动化：创建 → 测试运行 → 运行记录 → 打开会话', `
    await page.locator('.sidebar__nav > [data-feature="automation"]').click();
    await page.getByText('开启你的第一个自动化任务吧', { exact: true }).waitFor({ timeout: 10000 });
    await ctx.sleep(600);
    const empty = await ctx.shot('43-automation-empty');
    await page.getByRole('button', { name: '+ 添加自动化' }).click();
    await page.getByRole('button', { name: '保存', exact: true }).waitFor({ timeout: 10000 });
    await page.locator('.atm-modal-input').first().fill('每日销售摘要');
    const workspace = page.locator('.atm-workspace-input .atm-modal-input');
    await workspace.click();
    const option = page.locator('.atm-workspace-input__option').first();
    await option.waitFor({ timeout: 10000 });
    await option.click();
    await page.locator('.atm-prompt-textarea').fill('用一句话总结今天的销售情况');
    await ctx.sleep(400);
    const form = await ctx.shot('44-automation-form');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    // 完全访问的创建要先确认风险；改为默认权限后需再点一次保存，同样验证无人值守执行。
    const risk = page.getByRole('dialog').filter({ hasText: '完全访问权限' });
    await risk.waitFor({ timeout: 5000 }).catch(() => {});
    if (await risk.isVisible().catch(() => false)) {
      await risk.getByRole('button', { name: /改为「默认权限」运行/ }).click();
      await page.getByRole('button', { name: '保存', exact: true }).click();
    }
    const row = page.locator('.atm-row', { hasText: '每日销售摘要' }).first();
    await row.waitFor({ timeout: 15000 });
    await ctx.sleep(600);
    const saved = await ctx.shot('45-automation-saved');
    await row.hover();
    await row.locator('button[title="测试运行"]').click();
    await page.getByText('已触发测试运行', { exact: false }).first().waitFor({ timeout: 60000 });
    await page.getByRole('tab', { name: '运行记录' }).click();
    const record = page.locator('.atm-inbox-row', { hasText: '每日销售摘要' }).first();
    await record.waitFor({ timeout: 15000 });
    await ctx.sleep(800);
    const records = await ctx.shot('46-automation-records');
    const recordText = await record.innerText();
    if (!recordText.includes('成功')) throw new Error('run record not successful: ' + recordText);
    await record.click();
    await page.locator('.chatview__inner').waitFor({ timeout: 15000 });
    await page.getByText('本地 fixture', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(1000);
    const session = await ctx.shot('47-automation-session');
    const snapshot = await ctx.call('automations_snapshot');
    return { empty, form, saved, records, session, automations: snapshot.automations.map(a => a.name), recordsCount: snapshot.records.length, recordText: recordText.replace(/\\s+/g, ' ') };`);
  // W4.3: 会话 ⋯ 菜单 → 保存为自动化，预填名称 / 最后一条用户消息 / 工作空间。
  await step('保存为自动化（会话 ⋯ 菜单）', `
    await page.getByRole('button', { name: '更多操作' }).first().click();
    await page.getByRole('button', { name: '保存为自动化' }).click();
    await page.getByText('执行频率').waitFor({ timeout: 10000 });
    const name = await page.locator('.atm-modal-input').first().inputValue();
    const prompt = await page.locator('.atm-prompt-textarea').inputValue();
    const cwd = await page.locator('.atm-workspace-input .atm-modal-input').inputValue();
    if (!name || !prompt.includes('销售')) throw new Error('draft not prefilled: ' + JSON.stringify({ name, prompt, cwd }));
    await ctx.sleep(600);
    return { name, prompt: prompt.slice(0, 40), cwd, shot: await ctx.shot('48-save-as-automation') };`);
  // U7.6: 技能与 MCP merged into 专家·技能·连接器 (catalog tabs hidden until their commands exist).
  await step('experts hub with skills and MCP', `
    await page.locator('.sidebar__nav > [data-feature="experts-hub"]').click();
    await page.getByRole('tab', { name: '技能' }).waitFor({ timeout: 10000 });
    const tabs = await page.locator('.um-pills [role=tab]').allTextContents();
    await ctx.sleep(800);
    const skills = await ctx.shot('23-hub-skills');
    // W2.4: configure a real MCP-over-HTTP server (the driver's fixture), then 测试连接 against it.
    await ctx.call('mcp_upsert', { server: { name: '销售数据', transport: 'streamable_http', target: 'http://127.0.0.1:${FIXTURE_PORT}/mcp', headers: { Authorization: 'Bearer local-fixture-only' }, enabled: true } });
    await page.getByRole('tab', { name: '连接器' }).click();
    await page.getByText('MCP 服务', { exact: true }).waitFor({ timeout: 10000 });
    await page.locator('.mcp-server', { hasText: '销售数据' }).waitFor({ timeout: 10000 });
    await ctx.sleep(500);
    const configured = await ctx.shot('24-hub-connectors-mcp');
    await page.locator('.mcp-server', { hasText: '销售数据' }).getByRole('button', { name: '测试连接' }).click();
    // Wait for a result banner either way, so a failure reports its message instead of timing out.
    await page.locator('.mcp-server__badge--ok, .mcp-server__badge--bad').first().waitFor({ timeout: 30000 });
    const testError = await page.locator('.mcp-server__error').first().textContent().catch(() => null);
    const tools = await page.locator('.mcp-server__tools code').allTextContents();
    if (!tools.includes('query_sales')) throw new Error('test connect failed: ' + (testError ?? tools.join(',')));
    await ctx.sleep(700);
    const mcp = await ctx.shot('24b-hub-connectors-tested');
    await page.getByRole('tab', { name: '扩展' }).click();
    // W2.6: 扩展中心 shows a card per path (or its empty state).
    await page.getByText('扩展中心', { exact: true }).waitFor({ timeout: 10000 });
    await ctx.sleep(800);
    const extensions = await ctx.shot('25-hub-extensions');
    await page.getByRole('tab', { name: '我的指令' }).click();
    // W2.7 / S8: 我的指令 lists the Pi prompt templates and opens an editor.
    await page.getByRole('button', { name: /新建指令/ }).waitFor({ timeout: 10000 });
    await ctx.sleep(800);
    const prompts = await ctx.shot('25b-hub-prompts');
    await page.getByRole('button', { name: /新建指令/ }).click();
    await page.getByPlaceholder('weekly-report').waitFor({ timeout: 5000 });
    await page.getByPlaceholder('weekly-report').fill('weekly-report');
    await page.getByPlaceholder('一句话说明这条指令做什么').fill('按本周要点写一份周报');
    await page.getByPlaceholder('<本周要点>').fill('<本周要点>');
    await page.locator('.um-prompts__editor-content textarea').fill('请根据 $1 整理本周工作，写成一份结构清晰的周报。');
    await ctx.sleep(500);
    const editor = await ctx.shot('25c-prompt-editor');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.um-prompts__item', { hasText: 'weekly-report' }).waitFor({ timeout: 10000 });
    await ctx.sleep(700);
    const saved = await ctx.shot('25d-prompt-saved');
    const templates = await ctx.call('prompts_list');
    return { tabs, shots: [skills, configured, mcp, extensions, prompts, editor, saved], tools, templates: templates.map(t => t.scope + '/' + t.name) };`);
  // 20261116-pii W3.4: ob_subagent runs two child sessions; the transcript shows their cards.
  await step('subagent cards', `
    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 10000 });
    // The home composer has no mode control yet; a fresh task starts in 做一做 anyway.
    await page.locator('.wb-composer__input').fill('__SUBAGENT__ 并行核对一下本季度销售数据');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const allow = page.getByRole('button', { name: '允许本次', exact: true });
    await allow.waitFor({ timeout: 30000 });
    await ctx.sleep(500);
    await allow.click();
    const card = page.locator('.subagent-card').first();
    await card.waitFor({ timeout: 30000 });
    await page.locator('.subagent-card__state--done').first().waitFor({ timeout: 60000 });
    await ctx.sleep(1200);
    const collapsed = await ctx.shot('36-subagent-cards');
    const states = await page.locator('.subagent-card__state').allTextContents();
    await card.locator('.subagent-card__head').first().click();
    await ctx.sleep(500);
    return { collapsed, states, expanded: await ctx.shot('37-subagent-expanded') };`);
  await step('second task', `
    await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
    const input = page.locator('.wb-composer__input');
    await input.waitFor({ timeout: 10000 });
    await input.fill('写一段周报开头');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('本地 fixture', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(1500);
    return true;`);
  // pii W1.4: Ctrl/Cmd+K 内容 group (session_search over saved message text), highlighted snippet, opens the turn.
  await step('palette content search', `
    await page.keyboard.press('Control+K');
    const input = page.locator('.palette__input');
    await input.waitFor({ timeout: 5000 });
    await input.fill('统一卡片的圆角');
    await page.locator('.palette__group', { hasText: '内容' }).waitFor({ timeout: 10000 });
    await page.locator('mark.search-hit__mark').first().waitFor({ timeout: 10000 });
    const marks = await page.locator('mark.search-hit__mark').allTextContents();
    await ctx.sleep(600);
    const palette = await ctx.shot('26-palette-content-search');
    await page.locator('.palette__row--hit').first().click();
    const find = page.getByRole('textbox', { name: '查找' });
    await find.waitFor({ timeout: 15000 });
    const findValue = await find.inputValue();
    if (findValue !== '统一卡片的圆角') throw new Error('find bar got ' + findValue);
    await ctx.sleep(1500);
    const opened = await ctx.shot('27-palette-hit-opened');
    const count = await page.locator('.findbar__count').textContent();
    const highlights = await page.evaluate(() => (globalThis.CSS && CSS.highlights && CSS.highlights.get('ob-find')) ? CSS.highlights.get('ob-find').size : 0);
    return { marks, findValue, count, highlights, shots: [palette, opened] };`);
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
    const center = await ctx.shot('28-experts-center');
    // W3.5 专家团: preset pipelines install as a /team- prompt template.
    const team = page.locator('.team-card').first();
    await team.scrollIntoViewIfNeeded();
    await team.waitFor({ timeout: 10000 });
    const teamShot = await ctx.shot('28b-expert-teams');
    let teamCommand = '';
    if (!(await team.getByText('已在我的指令').count())) {
      await team.getByRole('button', { name: /添加到我的指令/ }).click();
      await team.getByText('已在我的指令').waitFor({ timeout: 10000 });
    }
    teamCommand = (await team.locator('.team-card__command').textContent())?.trim() ?? '';
    await ctx.sleep(500);
    const installed = await ctx.call('prompts_list');
    if (!installed.some((entry) => '/' + entry.name === teamCommand)) throw new Error('team not installed: ' + teamCommand);
    return { cards: count, shots: [center, teamShot, await ctx.shot('28c-expert-team-installed')], teamCommand };`);
  await step('experts detail', `
    await page.locator('.ec-grid [data-expert-id="data-analyst"]').click();
    const dialog = page.getByRole('dialog', { name: '专家：数据分析师' });
    await dialog.waitFor({ timeout: 5000 });
    await ctx.sleep(400);
    const shot = await ctx.shot('29-expert-detail');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    return shot;`);
  await step('my experts (empty)', `
    await page.getByRole('button', { name: '我的专家' }).click();
    await page.getByText('还没有创建任何专家', { exact: true }).waitFor({ timeout: 5000 });
    await ctx.sleep(400);
    return await ctx.shot('30-my-experts-empty');`);
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
    const shot = await ctx.shot('31-expert-editor');
    await editor.getByRole('button', { name: '创建', exact: true }).click();
    await editor.waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('.ec-my-card', { hasText: '旅行规划师' }).waitFor({ timeout: 5000 });
    await ctx.sleep(500);
    const list = await ctx.call('agents_list', {});
    if (!list.some(e => e.name === '旅行规划师' && e.scope === 'user')) throw new Error('agents_list does not contain the new expert');
    return [shot, await ctx.shot('32-my-experts')];`);
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
    return { prefilled: value, shot: await ctx.shot('33-summon-prefilled') };`);
  await step('send → persona reaches the model', `
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('人设已生效：旅行规划师', { exact: false }).first().waitFor({ timeout: 30000 });
    const last = ctx.fixture.requests.at(-1);
    if (last.persona !== '旅行规划师') throw new Error('system prompt did not carry the persona: ' + JSON.stringify(last));
    await page.locator('[data-testid="bound-expert"]', { hasText: '旅行规划师' }).waitFor({ timeout: 5000 });
    await ctx.sleep(1200);
    return { persona: last.persona, shot: await ctx.shot('34-persona-answer') };`);
  await step('unbind expert', `
    await page.getByRole('button', { name: '移除专家 旅行规划师' }).click();
    await page.locator('[data-testid="bound-expert"]').waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('.wb-composer__input').fill('谢谢，再确认一下行程');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('以上内容由本地测试服务器生成', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(1000);
    const last = ctx.fixture.requests.at(-1);
    if (last.persona) throw new Error('persona still sent after unbinding');
    return await ctx.shot('35-expert-unbound');`);
  // W4.6: 通知渠道 — configure a webhook in the renderer, send a real test message from the host.
  await step('通知渠道（主进程发送）', `
    const more = page.getByRole('button', { name: /更多.*文件/ });
    await more.hover();
    await page.locator('.sidebar__more-popover [data-feature="notify-channels"]').click();
    await page.getByRole('region', { name: '通知渠道' }).waitFor({ timeout: 10000 });
    await ctx.sleep(500);
    const empty = await ctx.shot('50-notify-channels-empty');
    await page.getByLabel('渠道类型').selectOption('generic-webhook');
    await page.getByPlaceholder('Webhook URL').fill('http://127.0.0.1:${FIXTURE_PORT}/webhook');
    await page.getByPlaceholder('显示名(可选)').fill('销售群机器人');
    await page.getByRole('button', { name: '+ 添加' }).click();
    const row = page.locator('.notify-panel__row', { hasText: '销售群机器人' });
    await row.waitFor({ timeout: 10000 });
    await ctx.sleep(400);
    const configured = await ctx.shot('51-notify-channels-configured');
    const before = ctx.fixture.webhooks.length;
    await row.getByRole('button', { name: '测试' }).click();
    await page.getByText('测试消息已发送到 销售群机器人', { exact: false }).first().waitFor({ timeout: 15000 });
    await ctx.sleep(500);
    if (ctx.fixture.webhooks.length !== before + 1) throw new Error('host did not POST the webhook: ' + JSON.stringify(ctx.fixture.webhooks));
    const sent = ctx.fixture.webhooks.at(-1);
    if (!sent.body.title || !sent.body.title.includes('OpenBuddy')) throw new Error('unexpected webhook payload: ' + sent.raw);
    const listed = await ctx.call('notify_channels_list');
    if (!listed.some((c) => c.label === '销售群机器人' && c.enabled)) throw new Error('channel not persisted: ' + JSON.stringify(listed));
    const tested = await ctx.shot('52-notify-channels-tested');
    return { empty, configured, tested, payload: sent.body, channels: listed.map((c) => c.label + ':' + c.kind + ':' + c.enabled) };`);
  // W4.7: 文件触发 — the automation watches a file; writing it runs the task.
  await step('文件触发自动化', `
    await page.locator('.sidebar__nav > [data-feature="automation"]').click();
    // 前面已经建过任务，工具栏里是「添加自动化」（空态里才是「+ 添加自动化」）。
    await page.locator('.atm-create-btn').waitFor({ timeout: 10000 });
    await page.locator('.atm-create-btn').click();
    await page.getByRole('button', { name: '保存', exact: true }).waitFor({ timeout: 10000 });
    const watched = ctx.tmpPath('watched-inbox.csv');
    await ctx.writeFile(watched, 'name,qty\\nwidget,3\\n');
    // 复用上一个任务的工作空间（收件箱，已信任），否则新的未信任目录会弹出目录信任弹窗。
    const prior = await ctx.call('automations_snapshot');
    const workspace = prior.automations.find((a) => a.cwds)?.cwds.split(',')[0].trim();
    if (!workspace) throw new Error('no existing automation workspace to reuse');
    await page.locator('.atm-modal-input').first().fill('收件箱文件触发');
    await page.locator('.atm-workspace-input .atm-modal-input').fill(workspace);
    await page.locator('.atm-prompt-textarea').fill('根据这个文件生成一行摘要');
    await page.getByRole('tab', { name: '文件变化' }).click();
    await page.getByLabel(/监听路径/).fill(watched);
    await ctx.sleep(400);
    const form = await ctx.shot('53-automation-file-trigger');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const risk = page.getByRole('dialog').filter({ hasText: '完全访问权限' });
    await risk.waitFor({ timeout: 5000 }).catch(() => {});
    if (await risk.isVisible().catch(() => false)) {
      await risk.getByRole('button', { name: /改为「默认权限」运行/ }).click();
      await page.getByRole('button', { name: '保存', exact: true }).click();
    }
    const row = page.locator('.atm-row', { hasText: '收件箱文件触发' }).first();
    await row.waitFor({ timeout: 15000 });
    await ctx.sleep(500);
    const saved = await ctx.shot('54-automation-file-trigger-saved');
    const summary = await row.innerText();
    if (!summary.includes('文件变化')) throw new Error('row does not show the file trigger: ' + summary);
    // 写文件 → 防抖 5 秒 → 任务真的跑了一次。面板不会自己刷新，所以先问宿主，再重进面板截图。
    await ctx.writeFile(watched, 'name,qty\\nwidget,7\\n');
    let run;
    for (let i = 0; i < 60; i += 1) {
      const snap = await ctx.call('automations_snapshot');
      run = snap.records.find((r) => r.automationName === '收件箱文件触发');
      if (run && run.status !== 'running') break;
      await ctx.sleep(1000);
    }
    if (!run || run.status !== 'success') throw new Error('file trigger run did not succeed: ' + JSON.stringify(run));
    await page.locator('.sidebar__nav > [data-feature="library"]').click();
    await page.locator('.sidebar__nav > [data-feature="automation"]').click();
    await page.getByRole('tab', { name: '运行记录' }).click();
    const record = page.locator('.atm-inbox-row', { hasText: '收件箱文件触发' }).first();
    await record.waitFor({ timeout: 15000 });
    await ctx.sleep(800);
    const records = await ctx.shot('55-automation-file-trigger-record');
    const text = (await record.innerText()).replace(/\\s+/g, ' ');
    if (!text.includes('成功')) throw new Error('file trigger record not shown as success: ' + text);
    const snapshot = await ctx.call('automations_snapshot');
    const task = snapshot.automations.find((a) => a.name === '收件箱文件触发');
    if (!task || !task.fileTrigger || task.fileTrigger.path !== watched) throw new Error('file trigger not persisted: ' + JSON.stringify(task));
    if (task.nextRunAt) throw new Error('a file-triggered task must not have a scheduled run: ' + task.nextRunAt);
    if (!run.sessionId) throw new Error('file trigger record has no session');
    return { form, saved, records, text, trigger: task.fileTrigger, recordStatus: run.status, sessionId: run.sessionId, recordCount: snapshot.records.length };`);
  // pii W4.5: the sidebar 运行中 panel lists the running turn with elapsed time; stop cancels it.
  await step('运行中面板（任务 / 用时 / 停止）', `
    ctx.fixture.delayMs = 1500;
    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.wb-composer__input').fill('慢慢写一段说明，让我看看运行中面板');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const panel = page.locator('.tasks-panel');
    await panel.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => /[1-9]\\d* 秒|\\d+ 分/.test(document.querySelector('.tasks-panel')?.textContent ?? ''), null, { timeout: 15000 });
    await ctx.sleep(300);
    const shot = await ctx.shot('49-running-tasks');
    const rows = await panel.locator('.tasks-panel__item').allInnerTexts();
    if (!rows.length || !rows.some((text) => text.includes('任务'))) throw new Error('running panel rows: ' + JSON.stringify(rows));
    const before = (await ctx.audit()).main.filter((r) => r.command === 'task_kill').length;
    await panel.locator('.tasks-panel__kill').first().click();
    await page.waitForFunction(() => !document.querySelector('.tasks-panel'), null, { timeout: 15000 });
    const kills = (await ctx.audit()).main.filter((r) => r.command === 'task_kill').length;
    if (kills !== before + 1) throw new Error('stop did not call task_kill');
    ctx.fixture.delayMs = 60;
    return { shot, rows, kills };`);
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
