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
    if (moreItems.some(t => ['策略设置', '灵感', '云存储'].includes(t.trim()))) throw new Error('offline entry offered: ' + moreItems.join(','));
    await ctx.sleep(400);
    const shot = await ctx.shot('08-sidebar-registry');
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
  // U7.6: 技能与 MCP merged into 专家·技能·连接器 (catalog tabs hidden until their commands exist).
  await step('experts hub with skills and MCP', `
    await page.locator('.sidebar__nav > [data-feature="experts-hub"]').click();
    await page.getByRole('tab', { name: '技能' }).waitFor({ timeout: 10000 });
    const tabs = await page.locator('.um-pills [role=tab]').allTextContents();
    await ctx.sleep(800);
    const skills = await ctx.shot('09-hub-skills');
    await page.getByRole('tab', { name: '连接器' }).click();
    await page.getByText('远程服务授权', { exact: true }).waitFor({ timeout: 10000 });
    await ctx.sleep(900);
    const mcp = await ctx.shot('10-hub-connectors-mcp');
    await page.getByRole('tab', { name: '扩展' }).click();
    await ctx.sleep(800);
    const extensions = await ctx.shot('11-hub-extensions');
    return { tabs, shots: [skills, mcp, extensions] };`);
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
    const palette = await ctx.shot('12-palette-content-search');
    await page.locator('.palette__row--hit').first().click();
    const find = page.getByRole('textbox', { name: '查找' });
    await find.waitFor({ timeout: 15000 });
    const findValue = await find.inputValue();
    if (findValue !== '统一卡片的圆角') throw new Error('find bar got ' + findValue);
    await ctx.sleep(1500);
    const opened = await ctx.shot('13-palette-hit-opened');
    const count = await page.locator('.findbar__count').textContent();
    const highlights = await page.evaluate(() => (globalThis.CSS && CSS.highlights && CSS.highlights.get('ob-find')) ? CSS.highlights.get('ob-find').size : 0);
    return { marks, findValue, count, highlights, shots: [palette, opened] };`);
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
