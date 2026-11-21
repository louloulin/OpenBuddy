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
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

// S18: a WorkBuddy-format package written on disk so the expert import is verified for real.
const WB_FIXTURE = join(tmpdir(), `openbuddy-e2e-workbuddy-${process.pid}`);
mkdirSync(join(WB_FIXTURE, '.codebuddy-plugin'), { recursive: true });
mkdirSync(join(WB_FIXTURE, 'agents'), { recursive: true });
mkdirSync(join(WB_FIXTURE, 'skills', 'e2e-skill'), { recursive: true });
mkdirSync(join(WB_FIXTURE, 'commands'), { recursive: true });
writeFileSync(join(WB_FIXTURE, '.codebuddy-plugin', 'plugin.json'), JSON.stringify({
  name: 'e2e-workbuddy',
  agents: ['./agents/quant-analyst.md', './agents/risk-officer.md'],
  expertType: 'team',
  agentName: 'quant-analyst',
  teamInfo: { leadAgent: 'quant-analyst', memberAgents: ['risk-officer'] },
  displayName: { zh: 'E2E 投研团队' },
  displayDescription: { zh: 'E2E 导入夹具' },
  categoryId: '08-FinanceInvestment',
  tags: [{ zh: '测试' }],
  quickPrompts: [{ zh: '回测一下这个策略' }],
  skills: ['./skills/e2e-skill'],
  commands: ['./commands'],
  mcpServers: { e2e: { type: 'http', url: 'https://example.invalid/mcp' } },
  hooks: './hooks/hooks.json',
  members: [
    { id: 'quant-analyst', displayName: { zh: '测试量化师' }, role: 'lead' },
    { id: 'risk-officer', displayName: { zh: '测试风控官' }, role: 'member' },
  ],
}));
writeFileSync(join(WB_FIXTURE, 'skills', 'e2e-skill', 'SKILL.md'), '---\nname: e2e-skill\ndescription: E2E 技能\n---\n\n按步骤执行。\n');
writeFileSync(join(WB_FIXTURE, 'commands', 'e2e-report.md'), '---\ndescription: E2E 指令\n---\n\n生成一份测试报告。\n');
writeFileSync(join(WB_FIXTURE, 'settings.json'), JSON.stringify({ agent: 'quant-analyst' }));
writeFileSync(join(WB_FIXTURE, 'agents', 'quant-analyst.md'), '---\nname: quant-analyst\ndescription: 量化策略师\ndisplayName:\n  zh: 测试量化师\n---\n\n你是量化策略师。\n');
writeFileSync(join(WB_FIXTURE, 'agents', 'risk-officer.md'), '---\nname: risk-officer\ndescription: 风控官\ndisplayName:\n  zh: 测试风控官\n---\n\n你是风控官。\n');
const cleanupFixture = () => { try { rmSync(WB_FIXTURE, { recursive: true, force: true }); } catch { /* already gone */ } };
process.on('exit', cleanupFixture);

// A3: a local release-manifest mirror + a deterministic installer so 检查更新 and 下载安装包
// both exercise the real HTTP path (checksum + size verified by the host).
const UPDATE_PORT = Number(process.env.UPDATE_PORT || 47225);
const INSTALLER = Buffer.from(Array.from({ length: 4096 }, (_, i) => String.fromCharCode(65 + (i % 26))).join(''));
const INSTALLER_SHA = createHash('sha256').update(INSTALLER).digest('hex');
const updateServer = createServer((req, res) => {
  if (req.url?.startsWith('/latest.json')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      version: '9.9.9',
      channel: 'stable',
      publishedAt: '2026-11-20T00:00:00.000Z',
      notes: 'A3 更新说明：修复若干问题。',
      download: { url: `http://127.0.0.1:${UPDATE_PORT}/installer/OpenBuddy-9.9.9.dmg`, sha256: INSTALLER_SHA, size: INSTALLER.length },
    }));
    return;
  }
  if (req.url?.startsWith('/installer/OpenBuddy-9.9.9.dmg')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(INSTALLER.length) });
    res.end(INSTALLER);
    return;
  }
  res.writeHead(404).end('not found');
});
await new Promise((done) => updateServer.listen(UPDATE_PORT, '127.0.0.1', done));
process.on('exit', () => { try { updateServer.close(); } catch { /* already closed */ } });

const env = { ...process.env, SHOTS_DIR: OUT, RUN_DIR, CONTROL_PORT: String(CONTROL_PORT), FIXTURE_PORT: String(FIXTURE_PORT), OPENBUDDY_UPDATE_FEED: `http://127.0.0.1:${UPDATE_PORT}/latest.json`, OPENBUDDY_E2E_EXTENSION: join(REPO, 'examples/pi-extension-demo/extension.mjs') };
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
  console.log('E2E_STEP', name, JSON.stringify(json.result ?? null).slice(0, 300), `pageErrors=${(json.errors ?? []).length}`);
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
    // A4: cold start = process spawn → composer ready, including the first window's boot.
    const coldStartMs = Date.now() - ctx.launchedAt;
    if (coldStartMs > 30000) throw new Error('cold start too slow: ' + coldStartMs + 'ms');
    // 赛博海豚品牌标识: the SVG must actually decode (not just exist in the DOM).
    const brand = page.locator('.sidebar__logo-mark');
    if ((await brand.count()) === 0) throw new Error('sidebar brand mark missing');
    if (!(await brand.first().evaluate((img) => img.complete && img.naturalWidth > 0))) throw new Error('sidebar brand mark failed to load');
    return { shot: await ctx.shot('01-home'), coldStartMs, brand: true };`);
  // B3e: the Grok Bot layout holds at 1280 / 1440 / 1920 without horizontal overflow.
  await step('首页三视口（B3e）', `
    const shots = [];
    for (const [width, height] of [[1280, 800], [1440, 900], [1920, 1080]]) {
      await ctx.setSize(width, height);
      await ctx.sleep(600);
      const guard = await page.evaluate(() => {
        const el = document.querySelector('.wb-composer');
        const box = el ? el.getBoundingClientRect() : null;
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, composer: box ? { x: Math.round(box.x), right: Math.round(box.right) } : null };
      });
      if (guard.scrollWidth > guard.width + 1) throw new Error('horizontal overflow at ' + width + ': ' + JSON.stringify(guard));
      if (!guard.composer || guard.composer.x < 0 || guard.composer.right > guard.width + 1) throw new Error('composer outside viewport at ' + width + ': ' + JSON.stringify(guard));
      shots.push(await ctx.shot('01a-home-' + width));
    }
    await ctx.setSize(1440, 900);
    await ctx.sleep(400);
    return { sizes: [1280, 1440, 1920], shots };`);
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
    // W6.1 深链：审批卡 → 安全中心，并高亮对应分类。
    await page.getByRole('button', { name: '查看拦截规则' }).click();
    await page.getByRole('dialog', { name: '设置' }).waitFor({ timeout: 10000 });
    await page.locator('.sec-group.is-focus, .sec-card.is-focus').first().waitFor({ timeout: 10000 });
    await ctx.sleep(400);
    const rules = await ctx.shot('62-approval-rules');
    await page.locator('button[aria-label="关闭设置"]').click();
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });
    await allow.click();
    await page.getByText('工具调用正常完成', { exact: false }).first().waitFor({ timeout: 30000 });
    await ctx.sleep(800);
    return [shot, rules, await ctx.shot('04-tool-done')];`);
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
    const shot = await ctx.shot('05-workbench');
    // W1.9 (U1.9): an edit made outside the app raises the banner; 重新加载 shows the new bytes.
    const item = page.locator('.bench-item__main').first();
    await item.waitFor({ timeout: 10000 });
    const path = await item.getAttribute('title');
    if (!path) throw new Error('artifact path missing');
    await item.click();
    await page.locator('.bench-viewer').waitFor({ timeout: 10000 });
    const original = await ctx.call('read_text_file', { path, maxBytes: 1048576 });
    await ctx.writeFile(path, String(original) + '\\n\\nEXTERNAL_EDIT_MARKER\\n');
    await page.locator('.bench-external').waitFor({ timeout: 20000 });
    const external = await ctx.shot('67-external-modified');
    await page.getByRole('button', { name: '重新加载' }).click();
    await page.locator('.bench-external').waitFor({ state: 'detached', timeout: 5000 });
    await page.getByText('EXTERNAL_EDIT_MARKER', { exact: false }).first().waitFor({ timeout: 10000 });
    return [shot, external];`);
  // B3d: 独立阅读、同版本双处刷新、分享前态、删除后仍可读。
  await step('产物独立阅读与删除态（B3d）', `
    const viewer = page.locator('.bench-viewer');
    await viewer.waitFor({ timeout: 10000 });
    const path = await viewer.locator('.bench-viewer__title').getAttribute('title');
    if (!path) throw new Error('open artifact path missing');
    const workspaces = await ctx.call('agent_list_workspaces');
    const cwd = workspaces[0]?.cwd;
    if (!cwd) throw new Error('no workspace for artifact reader');
    const sessions = await ctx.call('agent_list_sessions', { cwd });
    let sessionId = null;
    for (const session of sessions) {
      const list = await ctx.call('artifacts_list', { sessionId: session.sessionId });
      if (Array.isArray(list) && list.some((item) => item.path === path)) { sessionId = session.sessionId; break; }
    }
    if (!sessionId) throw new Error('no session owns artifact ' + path);
    const original = await ctx.call('read_text_file', { path, maxBytes: 1048576 });
    await viewer.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '独立阅读' }).click();
    const reader = page.locator('.bench-reader');
    await reader.waitFor({ timeout: 10000 });
    const first = await ctx.shot('05b-artifact-reader');

    // Same version in two places: artifact_save emits agent://artifacts; both reload.
    const marker = 'B3D_SYNC_MARKER';
    await ctx.call('artifact_save', { sessionId, path, content: String(original) + '\\n\\n' + marker + '\\n' });
    await reader.getByText(marker, { exact: false }).waitFor({ timeout: 15000 });
    await page.locator('.bench-viewer__body').getByText(marker, { exact: false }).waitFor({ timeout: 15000 });
    const synced = await ctx.shot('05c-artifact-reader-synced');

    // Share pre-state: local export works, cloud is explicitly unavailable (C2).
    await reader.getByRole('button', { name: '分享', exact: true }).click();
    const share = page.locator('.bench-share');
    await share.waitFor({ timeout: 10000 });
    // B4: focus starts inside the dialog, Tab cycles inside, Escape restores the trigger.
    if (!(await page.evaluate(() => !!document.activeElement?.closest('.bench-share')))) throw new Error('share dialog did not take focus');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => !!document.activeElement?.closest('.bench-share')))) throw new Error('Tab escaped the share dialog');
    }
    const cloud = share.getByRole('button', { name: /云端链接/ });
    if (!(await cloud.isDisabled())) throw new Error('cloud share should be disabled before C2');
    const shared = await ctx.shot('05d-artifact-share');
    await page.keyboard.press('Escape');
    await share.waitFor({ state: 'detached', timeout: 5000 });
    const restored = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    if (restored !== '分享') throw new Error('focus not restored to 分享: ' + restored);

    // Deleting the file: the reader switches to the last checkpoint body instead of a dead end.
    await ctx.rm(path);
    await reader.getByText('文件已不在磁盘上', { exact: false }).waitFor({ timeout: 15000 });
    await reader.getByText(marker, { exact: false }).waitFor({ timeout: 15000 });
    const deleted = await ctx.shot('05e-artifact-deleted-readable');
    await page.locator('.bench-gone').waitFor({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await reader.waitFor({ state: 'detached', timeout: 5000 });
    // 恢复文件，后面的 @ 文件提及仍能引用本任务产物。
    await ctx.call('artifact_save', { sessionId, path, content: String(original) + '\\n\\n' + marker + '\\n' });
    return { path, sessionId, first, synced, shared, deleted };`);
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
  // W1.8: 逐条回答 lives in the turn ⋯ menu.
  await step('turn menu: 逐条回答', `
    const menuButton = page.locator('.turn--last .turn-action__menu button[aria-label="更多"]').first();
    await menuButton.scrollIntoViewIfNeeded();
    await menuButton.click();
    const item = page.getByRole('menuitem', { name: '逐条回答' });
    await item.waitFor({ timeout: 5000 });
    await ctx.sleep(300);
    const shot = await ctx.shot('68-qna-menu');
    await item.click();
    await ctx.sleep(300);
    const input = page.locator('.wb-composer__input');
    const value = await input.inputValue();
    await input.fill('');
    return [shot, value.slice(0, 80)];`);
  // W1.9: 批注 goes to the tray and rides along with the next prompt.
  await step('批注托盘 + 窄窗口标签下拉', `
    await ctx.sleep(2600);
    const openPanel = page.getByRole('button', { name: '展开右侧栏', exact: true });
    if (await openPanel.isVisible()) await openPanel.click();
    await page.locator('.bench-item__main').first().click();
    await page.locator('.bench-viewer').waitFor({ timeout: 10000 });
    const preview = page.locator('.bench-preview--text').first();
    await preview.waitFor({ timeout: 10000 });
    await preview.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const comment = page.getByRole('button', { name: '批注', exact: true });
    await comment.waitFor({ timeout: 5000 });
    await comment.click();
    const tray = page.locator('.composer-annotations');
    await tray.waitFor({ timeout: 5000 });
    await tray.scrollIntoViewIfNeeded();
    const annotated = await ctx.shot('69-annotation-tray');
    // A second tab + a narrow window folds the tab bar into a dropdown (U1.2).
    const items = page.locator('.bench-item__main');
    if (await items.count() > 1) await items.nth(1).click();
    // Shrink the panel so the tab strip really overflows, then narrow the window.
    const sash = page.locator('.bench__sash');
    if (await sash.isVisible()) {
      const box = await sash.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 170, box.y + box.height / 2, { steps: 8 });
        await page.mouse.up();
      }
    }
    const size = await ctx.setSize(880, 820);
    const state = await page.evaluate(() => ({
      width: innerWidth,
      media: matchMedia('(max-width: 900px)').matches,
      tabs: document.querySelectorAll('.bench-tab').length,
      picker: !!document.querySelector('.bench__tabs-picker'),
      bar: !!document.querySelector('.bench__tabs'),
    }));
    const picker = page.locator('.bench__tabs-picker').first();
    if (!state.picker) {
      const debug = await ctx.shot('70-debug-tabs');
      throw new Error('picker missing: ' + JSON.stringify({ ...state, size, debug }));
    }
    await picker.waitFor({ timeout: 8000 });
    await picker.click();
    await page.locator('.bench__tabs-menu').waitFor({ timeout: 5000 });
    await ctx.sleep(300);
    const narrow = await ctx.shot('70-tabs-dropdown');
    await page.keyboard.press('Escape');
    await ctx.setSize(1440, 900);
    return [annotated, narrow];`);
  // W1.7: 交接到新任务 builds a self-contained draft and never auto-sends.
  await step('交接到新任务', `
    const collapse = page.getByRole('button', { name: '收起右侧栏', exact: true });
    if (await collapse.isVisible()) await collapse.click();
    await page.locator('.topbar-actions button[aria-label="更多操作"]').click();
    await page.getByRole('button', { name: '交接到新任务…' }).click();
    const dialog = page.locator('.app-dialog');
    await dialog.waitFor({ timeout: 5000 });
    await dialog.locator('.app-dialog__input').fill('把这套方案实现到团队版里');
    await dialog.getByRole('button', { name: '生成交接草稿' }).click();
    await page.locator('.chatview__handoff').waitFor({ timeout: 20000 });
    const value = await page.locator('.wb-composer__input').inputValue();
    if (!value.includes('## 背景接手') || !value.includes('把这套方案实现到团队版里')) throw new Error('handoff draft missing: ' + value.slice(0, 120));
    await ctx.sleep(500);
    const shot = await ctx.shot('71-handoff');
    await page.locator('.wb-composer__input').fill('');
    return [shot, value.slice(0, 120)];`);
  // W2.4 P2: built-in connector catalog installs a real MCP config; the "+" menu toggles it per task.
  await step('连接器目录 + 本任务连接器开关', `
    await page.getByRole('button', { name: /专家·技能·连接器/ }).first().click();
    await page.getByRole('tab', { name: '连接器' }).click();
    const card = page.locator('.cn-card', { hasText: '本地文件系统' });
    await card.waitFor({ timeout: 10000 });
    await ctx.sleep(500);
    const catalog = await ctx.shot('72-connectors-catalog');
    await card.locator('.sk-add').click();
    await page.getByText('已连接「本地文件系统」', { exact: false }).first().waitFor({ timeout: 15000 });
    const servers = await ctx.call('mcp_list');
    if (!servers.some((s) => s.name === 'filesystem')) throw new Error('filesystem not installed: ' + JSON.stringify(servers));
    await page.locator('.cn-card', { hasText: '本地文件系统' }).getByText('已连接').first().waitFor({ timeout: 8000 });
    await ctx.sleep(400);
    const installed = await ctx.shot('73-connectors-installed');
    // Back to the task: the "+" menu lists this session's connectors with a switch.
    await page.locator('.sidebar__conv').filter({ hasText: '交接任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '添加' }).click();
    const connectorItem = page.locator('.iam-item', { hasText: '连接器' }).first();
    await connectorItem.hover();
    const toggle = page.getByRole('button', { name: /filesystem/ }).first();
    await toggle.waitFor({ timeout: 8000 });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') throw new Error('connector not enabled for the task');
    await ctx.sleep(400);
    const tray = await ctx.shot('74-session-connectors');
    await toggle.click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('.iam-sub-item')].find((node) => node.textContent?.includes('filesystem'));
      return button?.getAttribute('aria-pressed') === 'false';
    }, undefined, { timeout: 8000 });
    return [catalog, installed, tray];`);
  // W2.6 P2 / S14 + S15: Pi package install entry and the npm-backed package market.
  await step('扩展中心 · npm / git 安装入口与包市场', `
    await page.getByRole('button', { name: /专家·技能·连接器/ }).first().click();
    await page.getByRole('tab', { name: '扩展' }).click();
    await page.getByText('从 npm / git 安装', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByLabel('扩展包来源').waitFor({ timeout: 5000 });
    await page.getByText('发现 Pi 扩展包', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByLabel('搜索 Pi 扩展包').waitFor({ timeout: 5000 });
    const packages = await ctx.call('agent_extensions_packages', {});
    if (!Array.isArray(packages)) throw new Error('packages not an array: ' + JSON.stringify(packages));
    const resources = await ctx.call('agent_extensions_resources', {});
    if (!resources || !Array.isArray(resources.extensions) || !Array.isArray(resources.skills)) throw new Error('resources malformed: ' + JSON.stringify(resources));
    // S17: the per-package filter command is wired; an unknown package is refused, not written.
    let rejected = false;
    try {
      await ctx.call('agent_extensions_set_package_resources', { source: 'npm:openbuddy-e2e-missing-package', resources: { skills: false } });
    } catch (error) {
      rejected = /not_found/.test(String(error));
    }
    if (!rejected) throw new Error('package resource filter command did not reject an unknown package');
    // S15: the market renders real npm rows. Offline runs show the friendly alert instead.
    const market = page.locator('.res-panel__card').filter({ hasText: '发现 Pi 扩展包' });
    await market.getByLabel('搜索 Pi 扩展包').fill('web');
    await market.getByRole('button', { name: '搜索', exact: true }).click();
    const row = market.locator('.ext-market__item').first();
    const alert = page.locator('.res-panel__error').first();
    await Promise.race([row.waitFor({ timeout: 20000 }), alert.waitFor({ timeout: 20000 })]);
    if (await alert.count()) {
      const message = await alert.innerText();
      if (!/包市场/.test(message)) throw new Error('market search failed: ' + message);
    } else {
      if (!(await row.locator('.ext-market__name').innerText())) throw new Error('market row has no package name');
      // E1: npm's own score is shown next to the download count.
      if ((await market.locator('.ext-market__badge--score').count()) === 0) throw new Error('npm score badge missing');
      // S16/E1: sort by real download counts, then page to a second npm result set.
      await market.getByRole('combobox', { name: '市场排序' }).selectOption('downloads');
      const before = await market.locator('.ext-market__item').count();
      await market.getByRole('button', { name: '加载更多' }).click();
      await page.waitForFunction((count) => document.querySelectorAll('.ext-market__item').length > count, before, { timeout: 20000 });
      // E1: capability categories come from the packages' own npm keywords; the filter must narrow the list.
      const categories = await market.locator('.ext-market__cat').count();
      if (categories === 0) throw new Error('no capability categories derived from npm keywords');
      const categorySelect = market.getByRole('combobox', { name: '按能力筛选' });
      if ((await categorySelect.count()) === 0) throw new Error('capability filter missing');
      const allRows = await market.locator('.ext-market__item').count();
      const firstOption = await categorySelect.locator('option').nth(1).getAttribute('value');
      await categorySelect.selectOption(firstOption);
      await ctx.sleep(300);
      const filteredRows = await market.locator('.ext-market__item').count();
      if (filteredRows === 0) throw new Error('capability filter hid every package');
      if (filteredRows > allRows) throw new Error('capability filter widened the list');
      await categorySelect.selectOption('all');
      // E1: package details come from the real npm packument (integrity / maintainers / commit).
      const detailsName = await market.locator('.ext-market__name').first().innerText();
      const details = await ctx.call('agent_extensions_package_details', { name: detailsName.trim() });
      if (!details || !details.name) throw new Error('package details empty: ' + JSON.stringify(details).slice(0, 200));
      if (!Array.isArray(details.categories) || !details.categories.length) throw new Error('details have no categories');
      await market.locator('.ext-market__item').first().getByRole('button', { name: '详情' }).click();
      await page.getByRole('dialog', { name: '包详情' }).waitFor({ timeout: 15000 });
      const detailText = await page.getByRole('dialog', { name: '包详情' }).innerText();
      if (!detailText.includes('integrity')) throw new Error('details dialog missing integrity: ' + detailText.slice(0, 200));
      await page.getByRole('button', { name: '关闭' }).click();
    }
    await ctx.sleep(400);
    const shot = await ctx.shot('78-extension-packages');
    // Back to the task: later steps use the composer and model menu.
    await page.locator('.sidebar__conv').filter({ hasText: '交接任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ timeout: 10000 });
    return shot;`);
  // S15: the market goes through the real npm registry. Offline runs skip it explicitly
  // instead of failing the suite; online runs must return real packages.
  await step('扩展包市场 · npm 实时搜索', `
    let result;
    try {
      result = await ctx.call('agent_extensions_search_registry', { query: 'web' });
    } catch (error) {
      const message = String(error);
      if (message.includes('registry_unreachable')) return { skipped: 'registry unreachable' };
      throw error;
    }
    if (!result || !Array.isArray(result.packages) || result.packages.length === 0) throw new Error('no registry packages: ' + JSON.stringify(result).slice(0, 500));
    const first = result.packages[0];
    if (!first.name || !first.version) throw new Error('registry row missing name/version: ' + JSON.stringify(first));
    return { total: result.total, packages: result.packages.length, first: first.name + '@' + first.version };`);
  // S18: import a WorkBuddy-format expert package (fixture written on disk before launch).
  await step('专家 · WorkBuddy 包导入', `
    const result = await ctx.call('experts_import_workbuddy', { path: ${JSON.stringify(WB_FIXTURE)} });
    if (!result || !Array.isArray(result.imported) || result.imported.length !== 2) throw new Error('workbuddy import: ' + JSON.stringify(result).slice(0, 500));
    if (!result.imported.some((expert) => expert.name === '测试量化师')) throw new Error('workbuddy display name missing: ' + JSON.stringify(result.imported.map((e) => e.name)));
    const list = await ctx.call('agents_list', {});
    const ids = new Set(result.imported.map((expert) => expert.id));
    const found = list.filter((expert) => ids.has(expert.id));
    if (found.length !== 2) throw new Error('agents_list missing imported experts: ' + JSON.stringify(found.map((e) => e.id)));
    // S21: team packages also install a /team-wb-… prompt.
    const command = result.team?.command;
    if (!command) throw new Error('team command missing: ' + JSON.stringify(result.team));
    const prompts = await ctx.call('prompts_list', {});
    if (!prompts.some((entry) => entry.name === command)) throw new Error('team prompt not installed: ' + command);
    // B1b: skills / commands / mcpServers declared by the same package reach Pi's surfaces.
    const contributions = result.contributions ?? [];
    if (!contributions.some((entry) => entry.kind === 'skill' && entry.name === 'e2e-skill' && entry.enabled)) throw new Error('skill contribution missing: ' + JSON.stringify(contributions));
    if (!contributions.some((entry) => entry.kind === 'prompt' && entry.name === 'e2e-report')) throw new Error('prompt contribution missing: ' + JSON.stringify(contributions));
    const mcpContribution = contributions.find((entry) => entry.kind === 'mcp' && entry.name === 'e2e');
    if (!mcpContribution || mcpContribution.enabled !== false) throw new Error('mcp contribution should be disabled: ' + JSON.stringify(mcpContribution));
    if (!(result.skippedContributions ?? []).some((entry) => entry.kind === 'hook')) throw new Error('hook skip reason missing: ' + JSON.stringify(result.skippedContributions));
    const installedSkills = await ctx.call('skills_list', {});
    if (!installedSkills.some((entry) => entry.name === 'e2e-skill' && entry.enabled)) throw new Error('Pi skills_list missing e2e-skill: ' + JSON.stringify(installedSkills.map((s) => s.name)));
    const installedPrompts = await ctx.call('prompts_list', {});
    if (!installedPrompts.some((entry) => entry.name === 'e2e-report')) throw new Error('prompts_list missing e2e-report');
    const servers = await ctx.call('mcp_list');
    if (!servers.some((entry) => entry.name === 'e2e' && entry.enabled === false)) throw new Error('mcp_list missing disabled e2e: ' + JSON.stringify(servers));
    // B1a: the descriptor is persisted; pack-level and per-contribution switches are real.
    const packId = result.packId;
    if (!packId) throw new Error('capability pack id missing: ' + JSON.stringify(result.contributions));
    const packs = await ctx.call('capability_packs_list');
    const pack = packs.find((entry) => entry.id === packId);
    if (!pack || pack.contributions.length < 3) throw new Error('capability_packs_list missing pack: ' + JSON.stringify(packs));
    const disabledPacks = await ctx.call('capability_packs_set_enabled', { id: packId, enabled: false });
    if (disabledPacks.find((entry) => entry.id === packId)?.enabled !== false) throw new Error('pack disable not persisted: ' + JSON.stringify(disabledPacks));
    const offSkills = await ctx.call('skills_list');
    if (!offSkills.some((entry) => entry.name === 'e2e-skill' && entry.enabled === false)) throw new Error('pack disable did not switch the skill off: ' + JSON.stringify(offSkills.map((s) => s.name + ':' + s.enabled)));
    const offPrompts = await ctx.call('prompts_list');
    if (offPrompts.some((entry) => entry.name === 'e2e-report')) throw new Error('pack disable did not hide the prompt');
    const offMcp = await ctx.call('mcp_list');
    if (!offMcp.some((entry) => entry.name === 'e2e' && entry.enabled === false)) throw new Error('pack disable did not switch MCP off');
    await ctx.call('capability_packs_set_enabled', { id: packId, enabled: true });
    const onSkills = await ctx.call('skills_list');
    if (!onSkills.some((entry) => entry.name === 'e2e-skill' && entry.enabled === true)) throw new Error('pack enable did not restore the skill');
    const onPrompts = await ctx.call('prompts_list');
    if (!onPrompts.some((entry) => entry.name === 'e2e-report')) throw new Error('pack enable did not restore the prompt');
    const single = await ctx.call('capability_packs_set_contribution', { id: packId, kind: 'prompt', name: 'e2e-report', enabled: false });
    if (!single.find((entry) => entry.id === packId)?.contributions.some((item) => item.kind === 'prompt' && item.name === 'e2e-report' && item.enabled === false)) throw new Error('per-contribution toggle not persisted');
    const removal = await ctx.call('capability_packs_remove', { id: packId });
    if (!removal.removed) throw new Error('capability pack not removed: ' + JSON.stringify(removal));
    if ((await ctx.call('capability_packs_list')).some((entry) => entry.id === packId)) throw new Error('pack still listed after removal');
    if ((await ctx.call('skills_list')).some((entry) => entry.name === 'e2e-skill')) throw new Error('skill still loaded after rollback');
    if ((await ctx.call('prompts_list')).some((entry) => entry.name === 'e2e-report')) throw new Error('prompt still listed after rollback');
    // Keep the later expert-count / prompt steps stable.
    for (const expert of result.imported) await ctx.call('agents_delete', { id: expert.id });
    await ctx.call('prompts_delete', { name: command, scope: 'global' });
    await ctx.call('mcp_delete', { name: 'e2e' });
    return { package: result.package, packId, names: result.imported.map((expert) => expert.name), team: command, contributions: contributions.map((entry) => entry.kind + ':' + entry.name), skipped: (result.skippedContributions ?? []).map((entry) => entry.kind + ':' + entry.name), lifecycle: 'disable → enable → per-item off → remove' };`);
  // W7.1 / W7.2: independent session window + global quick input.
  await step('独立窗口 + 全局快速输入', `
    const init = await ctx.call('agent_init', {});
    const list = await ctx.call('agent_list_sessions', { cwd: init.cwd });
    const sessionId = list[0]?.sessionId;
    if (!sessionId) throw new Error('no session for window test');
    await ctx.call('window_open_session', { sessionId });
    await ctx.sleep(1500);
    const opened = await ctx.app.evaluate(async ({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      const urls = [];
      for (const win of wins) {
        const hash = await win.webContents.executeJavaScript('window.location.hash');
        urls.push({ url: win.webContents.getURL(), hash });
        if (hash.includes('/session/')) {
          const png = (await win.webContents.capturePage()).toPNG().toString('base64');
          return { count: wins.length, url: win.webContents.getURL(), hash, png, urls };
        }
      }
      return { count: wins.length, url: '', hash: '', png: '', urls };
    });
    if (opened.count < 2 || !opened.hash.includes('/session/')) throw new Error('session window missing: ' + JSON.stringify(opened));
    await ctx.savePng('75-session-window', opened.png);
    await ctx.call('window_open_quick', {});
    await ctx.sleep(1200);
    const quick = await ctx.app.evaluate(async ({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      const win = wins.find(w => w.webContents.getURL().includes('#/quick'));
      if (!win) return { count: wins.length, url: '', png: '' };
      const png = (await win.webContents.capturePage()).toPNG().toString('base64');
      return { count: wins.length, url: win.webContents.getURL(), png };
    });
    if (!quick.url.includes('#/quick')) throw new Error('quick window missing: ' + JSON.stringify(quick));
    await ctx.savePng('76-quick-window', quick.png);
    // The system-wide accelerator really registers in the main process.
    const shortcut = await ctx.call('quick_shortcut_get');
    const applied = await ctx.call('quick_shortcut_set', { accelerator: shortcut });
    if (!shortcut || applied !== shortcut) throw new Error('quick shortcut registration failed: ' + shortcut + ' / ' + applied);
    await ctx.app.evaluate(async ({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        const hash = await win.webContents.executeJavaScript('window.location.hash').catch(() => '');
        if (hash.startsWith('#/session/') || hash.startsWith('#/quick')) win.close();
      }
    });
    return { sessionWindow: opened.url, quickWindow: quick.url, windows: opened.count };`);
  await step('settings', `
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    await ctx.sleep(1200);
    return await ctx.shot('06-settings');`);
  // Every settings section, so splitting SettingsSections (R8) is covered by before/after shots.
  // W6.3 order: 通用 → 模型 → 助理 → 智能体 → 安全 → 个性化 → 记忆 → 快捷键 → 邮箱 → 数据 → 帮助 → 关于.
  const SETTINGS_SECTIONS = [['general', '通用'], ['model', '模型'], ['assistant', '助理设置'], ['agent-settings', '智能体'], ['security', '安全中心'], ['personalize', '个性化'], ['memory', '记忆'], ['shortcuts', '快捷键'], ['agent-mail', '智能体邮箱'], ['data', '数据管理'], ['help', '帮助与反馈'], ['about', '关于']];
  await step('settings sections', `
    const out = [];
    for (const [id, label] of ${JSON.stringify(SETTINGS_SECTIONS)}) {
      await page.locator('.settings-navigation__label').getByText(label, { exact: true }).first().click();
      await ctx.sleep(700);
      out.push(await ctx.shot('07-settings-' + id));
    }
    return out;`);
  // 20261116-pii W6.3: 通用偏好 — 主题 / 字号 / 密度 / 发送键立即生效并保存在本机。
  // W8: point the local-model card at the fixture's OpenAI-compatible server, probe and enable it.
  await step('本地模型（W8）', `
    await page.locator('.settings-navigation__label').getByText('模型', { exact: true }).first().click();
    const url = page.locator('.ms-local__field--wide input');
    await url.waitFor({ timeout: 10000 });
    await url.fill('http://127.0.0.1:${FIXTURE_PORT}/v1');
    await page.getByRole('button', { name: /探测/ }).click();
    await page.getByText(/发现 \\d+ 个模型/).waitFor({ timeout: 10000 });
    const modelSelect = page.locator('.ms-local__field select');
    await modelSelect.waitFor({ timeout: 10000 });
    await modelSelect.selectOption('fixture-model');
    await page.locator('.ms-local__switch input').check();
    await page.getByRole('button', { name: /保存/ }).click();
    await page.getByText('本地模型已启用', { exact: false }).waitFor({ timeout: 10000 });
    const list = await ctx.call('providers_list');
    if (!list.providers.some((provider) => provider.id === 'llama.cpp')) throw new Error('local provider missing: ' + JSON.stringify(list.providers.map((p) => p.id)));
    if (!list.models.some((model) => model.providerId === 'llama.cpp' && model.modelId === 'fixture-model')) throw new Error('local model missing');
    await ctx.sleep(500);
    return await ctx.shot('77-local-model');`);
  await step('通用偏好（主题 / 字号 / 密度 / 发送键）', `
    await page.locator('.settings-navigation__label').getByText('通用', { exact: true }).first().click();
    await page.locator('.pref-card').waitFor({ timeout: 10000 });
    await ctx.sleep(500);
    const light = await ctx.shot('59-general');
    await page.locator('.pref-row', { hasText: '主题' }).getByRole('button', { name: '深色' }).click();
    // 字号与密度按钮的可访问名就是“大 / 紧凑”。
    await page.getByRole('group', { name: '字号' }).getByRole('button', { name: '大' }).click();
    await page.getByRole('group', { name: '信息密度' }).getByRole('button', { name: '紧凑' }).click();
    await page.getByRole('group', { name: '发送键' }).getByRole('button', { name: 'Ctrl/Cmd+Enter' }).click();
    await ctx.sleep(700);
    const attrs = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      fontSize: document.documentElement.dataset.fontSize,
      density: document.documentElement.dataset.density,
      sendKey: localStorage.getItem('openbuddy.sendKey'),
    }));
    if (attrs.theme !== 'dark' || attrs.fontSize !== 'large' || attrs.density !== 'compact' || attrs.sendKey !== 'mod+enter')
      throw new Error('preferences not applied: ' + JSON.stringify(attrs));
    const dark = await ctx.shot('60-general-dark-large');
    // 复位，避免影响后续截图。
    await page.locator('.pref-row', { hasText: '主题' }).getByRole('button', { name: '浅色' }).click();
    await page.getByRole('group', { name: '字号' }).getByRole('button', { name: '标准' }).click();
    await page.getByRole('group', { name: '信息密度' }).getByRole('button', { name: '宽松' }).click();
    await page.getByRole('group', { name: '发送键' }).getByRole('button', { name: 'Enter', exact: true }).click();
    await ctx.sleep(300);
    await page.locator('.settings-navigation__label').getByText('关于', { exact: true }).first().click();
    await page.locator('.about-card').waitFor({ timeout: 10000 });
    await ctx.sleep(400);
    const about = await ctx.shot('61-about');
    // W4.4 托盘常驻：开关由主进程持久化，验证真实命令后再关掉。
    await page.locator('.settings-navigation__label').getByText('通用', { exact: true }).first().click();
    const trayGroup = page.getByRole('group', { name: '托盘常驻' });
    await trayGroup.waitFor({ timeout: 10000 });
    await trayGroup.getByRole('button', { name: '开启' }).click();
    await ctx.sleep(500);
    const trayOn = await ctx.call('tray_get');
    if (!trayOn.enabled) throw new Error('tray not enabled: ' + JSON.stringify(trayOn));
    const tray = await ctx.shot('63-tray-enabled');
    await trayGroup.getByRole('button', { name: '关闭' }).click();
    await ctx.sleep(400);
    const trayOff = await ctx.call('tray_get');
    if (trayOff.enabled) throw new Error('tray not disabled: ' + JSON.stringify(trayOff));
    return { light, dark, about, tray, attrs };`);
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
  // 20261116-pii W6.5: 诊断报告在本地生成、脱敏、预览，不上传。
  await step('诊断报告（本地预览）', `
    await page.locator('.settings-navigation__label').getByText('帮助与反馈', { exact: true }).first().click();
    await page.getByText('诊断与反馈', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByPlaceholder('例如：点「导出为 JSONL」没有反应').fill('e2e 诊断');
    await page.getByRole('button', { name: /生成诊断报告/ }).click();
    await page.locator('.diag-preview').waitFor({ timeout: 15000 });
    const text = await page.locator('.diag-preview').innerText();
    if (!text.includes('OpenBuddy 诊断报告')) throw new Error('diagnostics missing: ' + text.slice(0, 300));
    if (text.includes('sk-') || /\\/Users\\//.test(text)) throw new Error('diagnostics leaked a key or absolute path');
    await ctx.sleep(500);
    return { shot: await ctx.shot('58-diagnostics'), lines: text.split('\\n').length };`);
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
      // The popover unmounts/re-renders between items; hover again and dispatch the item's own click.
      if ((await page.locator('.sidebar__more-popover').count()) === 0) {
        await page.mouse.move(900, 500);
        await ctx.sleep(200);
        await more.hover();
        await page.locator('.sidebar__more-popover').waitFor({ timeout: 5000 });
      }
      const item = page.locator('.sidebar__more-popover [data-feature="' + id + '"]');
      await item.waitFor({ timeout: 5000 });
      await item.evaluate((el) => el.click());
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
  // B3c: 修订语义 + 交付目标不可用 + 失败记录重试（真实命令 + 运行记录 UI）。
  await step('自动化修订：编辑不改运行、目标不可用留记录、失败可重试', `
    const draft = {
      id: '', name: '目标不可用演练', prompt: '写一句话', cwds: '/nonexistent/openbuddy-b3c-target',
      status: 'ACTIVE', skills: [], connectorIds: [], permissionMode: 'default',
      scheduleType: 'recurring',
      schedule: { freq: 'DAILY', interval: 1, byday: [], bymonthday: [], bymonth: [], byhour: 9, byminute: 0, intervalHours: 1 },
      pushToWeChat: false,
    };
    const v1 = await ctx.call('automations_save', { automation: draft });
    if (v1.revision !== 1) throw new Error('first save revision: ' + v1.revision);
    const v2 = await ctx.call('automations_save', { automation: { ...v1, name: '目标不可用演练（二版）' } });
    if (v2.revision !== 2) throw new Error('second save revision: ' + v2.revision);
    const run = await ctx.call('automations_run', { id: v2.id });
    if (run.ok !== false || !String(run.error || '').includes('交付目标不可用')) throw new Error('run should fail with delivery reason: ' + JSON.stringify(run));
    let snap = await ctx.call('automations_snapshot');
    const failed = snap.records.find((r) => r.id === run.recordId);
    if (!failed || failed.status !== 'failed' || failed.automationRevision !== 2) throw new Error('failed record: ' + JSON.stringify(failed));
    // Editing again must not rewrite the finished record's revision.
    await ctx.call('automations_save', { automation: { ...v2, prompt: '改过的提示词' } });
    snap = await ctx.call('automations_snapshot');
    const frozen = snap.records.find((r) => r.id === run.recordId);
    if (frozen.automationRevision !== 2) throw new Error('record revision changed: ' + JSON.stringify(frozen));
    const retry = await ctx.call('automation_retry', { recordId: run.recordId });
    snap = await ctx.call('automations_snapshot');
    const retried = snap.records.find((r) => r.id === retry.recordId);
    if (!retried || retried.retryOf !== run.recordId) throw new Error('retry link: ' + JSON.stringify(retried));

    await page.locator('.sidebar__nav > [data-feature="automation"]').click();
    await page.getByRole('tab', { name: '运行记录' }).click();
    const row = page.locator('.atm-inbox-row', { hasText: '目标不可用演练' }).first();
    await row.waitFor({ timeout: 10000 });
    const text = (await row.innerText()).replace(/\\s+/g, ' ');
    if (!text.includes('失败') || !text.includes('修订 ' + retried.automationRevision)) throw new Error('record row: ' + text);
    await row.hover();
    const retryBtn = row.locator('button[title="重试这次运行"]');
    if (await retryBtn.count() !== 1) throw new Error('retry button missing');
    await ctx.sleep(500);
    const shot = await ctx.shot('46b-automation-revision-retry');
    await ctx.call('automations_delete', { id: v2.id });
    // 返回上一段留下的会话，后续步骤继续在对话页操作。
    await page.locator('.atm-inbox-row', { hasText: '每日销售摘要' }).first().click();
    await page.locator('.chatview__inner').waitFor({ timeout: 15000 });
    return { v1: v1.revision, v2: v2.revision, error: run.error, retryOf: retried.retryOf, row: text, shot };`);
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
    await page.locator('section[aria-label="MCP 服务"]').waitFor({ timeout: 10000 });
    await page.locator('.mcp-server', { hasText: '销售数据' }).waitFor({ timeout: 10000 });
    await ctx.sleep(500);
    const configured = await ctx.shot('24-hub-connectors-mcp');
    await page.locator('.mcp-server', { hasText: '销售数据' }).getByRole('button', { name: '测试连接' }).click();
    // Wait for a result banner either way, so a failure reports its message instead of timing out.
    await page.locator('.mcp-server__badge--ok, .mcp-server__badge--bad').first().waitFor({ timeout: 30000 });
    const testError = await page.locator('.mcp-server__error').first().textContent().catch(() => null);
    const tools = await page.locator('.mcp-tool code').allTextContents();
    if (!tools.includes('query_sales')) throw new Error('test connect failed: ' + (testError ?? tools.join(',')));
    await ctx.sleep(700);
    const mcp = await ctx.shot('24b-hub-connectors-tested');
    // W2.4 P2: 工具级规则写进普通权限规则；延迟暴露整体切换并写回 mcp.json。
    const toolSelect = page.getByRole('combobox', { name: tools[0] + ' 的权限' });
    await toolSelect.selectOption('deny');
    await page.waitForFunction((tool) => {
      const select = [...document.querySelectorAll('.mcp-tool__select')].find((el) => el.getAttribute('aria-label') === tool + " 的权限");
      return select?.value === 'deny';
    }, tools[0], { timeout: 10000 });
    const rules = await ctx.call('permission_list');
    if (!rules.some((r) => r.tool === 'mcp__销售数据__' + tools[0] && r.action === 'deny')) throw new Error('MCP tool rule not saved: ' + JSON.stringify(rules));
    await ctx.sleep(300);
    const toolRules = await ctx.shot('65-mcp-tool-rules');
    await toolSelect.selectOption('');
    await page.waitForFunction((tool) => {
      const select = [...document.querySelectorAll('.mcp-tool__select')].find((el) => el.getAttribute('aria-label') === tool + " 的权限");
      return select?.value === '';
    }, tools[0], { timeout: 10000 });
    const deferredToggle = page.locator('.mcp-deferred input');
    await deferredToggle.check();
    await page.waitForFunction(() => {
      const content = document.querySelector('.mcp-config-editor textarea')?.value ?? '';
      return content.includes('"exposure": "deferred"');
    }, null, { timeout: 10000 }).catch(() => {});
    const deferredConfig = await ctx.call('mcp_config_read');
    if (!String(deferredConfig.content).includes('"exposure": "deferred"')) throw new Error('deferred exposure not written');
    await ctx.sleep(300);
    const deferred = await ctx.shot('66-mcp-deferred');
    await deferredToggle.uncheck();
    await ctx.sleep(300);
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
    return { tabs, shots: [skills, configured, mcp, toolRules, deferred, extensions, prompts, editor, saved], tools, templates: templates.map(t => t.scope + '/' + t.name) };`);
  // B1a: the capability-pack descriptor is visible and switchable in 扩展; removal rolls back.
  await step('能力包管理（B1a）', `
    const root = ctx.tmpPath('b1a-pack');
    await ctx.mkdir(root + '/.codebuddy-plugin');
    await ctx.mkdir(root + '/skills/ui');
    await ctx.mkdir(root + '/commands');
    await ctx.writeFile(root + '/.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'ui-pack', displayName: { zh: '界面能力包' }, skills: ['./skills/ui'], commands: ['./commands'] }));
    await ctx.writeFile(root + '/skills/ui/SKILL.md', '---\\nname: ui-skill\\ndescription: UI 演示技能\\n---\\n演示。\\n');
    await ctx.writeFile(root + '/commands/ui-report.md', '---\\ndescription: 界面指令\\n---\\n写报告。\\n');
    const imported = await ctx.call('experts_import_workbuddy', { path: root });
    const packId = imported.packId;
    if (!packId) throw new Error('ui pack id missing: ' + JSON.stringify(imported));
    await page.getByRole('tab', { name: '扩展' }).click();
    const section = page.locator('section[aria-label="能力包"]');
    await section.waitFor({ timeout: 10000 });
    await section.getByText('ui-pack · 2/2 项启用').waitFor({ timeout: 10000 });
    await ctx.sleep(500);
    const shot = await ctx.shot('25e-capability-pack');
    await section.getByRole('button', { name: /^ui-pack/ }).click();
    const toggle = page.getByRole('checkbox', { name: '指令 · ui-report' });
    await toggle.waitFor({ timeout: 5000 });
    await toggle.click();
    // Persisting a switch rebuilds live sessions first, and the list re-renders; poll the text,
    // not an element handle, so re-rendering cannot detach the thing we are waiting for.
    await page.waitForFunction(() => {
      const current = document.querySelector('section[aria-label="能力包"]');
      return !!current && current.textContent.includes('ui-pack · 1/2 项启用');
    }, null, { timeout: 20000 });
    if (await page.getByRole('checkbox', { name: '指令 · ui-report' }).isChecked()) {
      const errorText = await section.locator('[role="alert"]').first().textContent().catch(() => null);
      const failed = await ctx.shot('25e-capability-pack-failed');
      throw new Error('UI toggle did not apply: ' + (errorText ?? 'no alert') + ' shot=' + failed);
    }
    await ctx.sleep(400);
    const off = await ctx.shot('25f-capability-pack-off');
    if ((await ctx.call('prompts_list')).some((entry) => entry.name === 'ui-report')) throw new Error('UI prompt toggle did not hide ui-report');
    const removal = await ctx.call('capability_packs_remove', { id: packId });
    if (!removal.removed) throw new Error('capability pack rollback failed: ' + JSON.stringify(removal));
    if ((await ctx.call('prompts_list')).some((entry) => entry.name === 'ui-report')) throw new Error('ui-report survived rollback');
    return { packId, shot, off, lifecycle: 'UI 逐项关闭 → 回退' };`);
  // B3a: attempt IPC surface is wired; the real four-state flow runs in mcp-oauth.test.ts.
  await step('授权尝试命令面（B3a）', `
    const attempts = await ctx.call('mcp_auth_attempts', { sessionId: null });
    if (!Array.isArray(attempts)) throw new Error('mcp_auth_attempts shape: ' + JSON.stringify(attempts));
    const missing = await ctx.call('mcp_auth_attempt', { id: '11111111-2222-3333' });
    if (missing !== null) throw new Error('unknown attempt should be null: ' + JSON.stringify(missing));
    const cancelled = await ctx.call('mcp_auth_cancel', { id: '11111111-2222-3333' });
    if (cancelled !== false) throw new Error('cancelling an unknown attempt should be false: ' + JSON.stringify(cancelled));
    return { attempts: attempts.length, missing, cancelled };`);
  // B3b: 专家链接 — preview, one import per content digest, duplicate opens the existing expert.
  await step('专家链接导入（B3b）', `
    const root = ctx.tmpPath('b3b-link');
    await ctx.mkdir(root + '/.codebuddy-plugin');
    await ctx.mkdir(root + '/agents');
    await ctx.writeFile(root + '/.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'link-pkg', displayName: { zh: '链接包' }, agents: ['./agents/linker.md'] }));
    await ctx.writeFile(root + '/agents/linker.md', '---\\nname: linker\\ndescription: 链接专家\\ndisplayName:\\n  zh: 链接员\\n---\\n\\n你是链接员。\\n');
    const before = (await ctx.call('agents_list', {})).length;
    const preview = await ctx.call('experts_link_preview', { source: root });
    if (preview.package !== 'link-pkg' || preview.experts.length !== 1 || preview.duplicate) throw new Error('preview: ' + JSON.stringify(preview));
    const first = await ctx.call('experts_link_import', { source: root });
    if (first.duplicate || first.imported.length !== 1) throw new Error('first import: ' + JSON.stringify(first).slice(0, 400));
    const afterFirst = (await ctx.call('agents_list', {})).length;
    if (afterFirst !== before + 1) throw new Error('expert count after first import: ' + before + ' → ' + afterFirst);
    const second = await ctx.call('experts_link_import', { source: root });
    if (!second.duplicate || second.imported.length !== 0) throw new Error('duplicate import: ' + JSON.stringify(second).slice(0, 400));
    if ((await ctx.call('agents_list', {})).length !== afterFirst) throw new Error('duplicate import wrote another expert');
    const previewAgain = await ctx.call('experts_link_preview', { source: root });
    if (!previewAgain.duplicate || !previewAgain.importedExpertIds?.length) throw new Error('preview duplicate: ' + JSON.stringify(previewAgain));

    await page.locator('.sidebar__nav > [data-feature="experts-hub"]').click();
    await page.getByRole('tab', { name: '专家' }).click();
    await page.getByRole('button', { name: '我的专家' }).click();
    await page.getByRole('button', { name: '从链接导入' }).click();
    await page.locator('#expert-link-source').fill(root);
    await page.getByRole('button', { name: '预览', exact: true }).click();
    await page.getByText('link-pkg', { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByText('这个链接的内容已经导入过', { exact: false }).waitFor({ timeout: 10000 });
    await ctx.sleep(400);
    const shot = await ctx.shot('25i-link-import');
    await page.getByRole('button', { name: '导入', exact: true }).click();
    await page.getByText('链接员', { exact: false }).first().waitFor({ timeout: 10000 });
    await ctx.sleep(400);
    const detail = await ctx.shot('25j-link-detail');
    await page.keyboard.press('Escape');
    // 回到专家中心，后续步骤继续从「专家」页签开始。
    await page.locator('.um-back').first().click();
    await page.getByRole('tab', { name: '专家' }).waitFor({ timeout: 10000 });
    // 清理本次导入，后面的「我的专家（空态）」步骤仍从干净状态开始。
    await ctx.call('agents_delete', { id: first.imported[0].id });
    return { preview: preview.package, experts: preview.experts.map((e) => e.name), duplicate: second.duplicate, importedIds: second.importedExpertIds, shots: [shot, detail] };`);
  // B1c: marketplace install copies into <pi>/skills, shows the version, batch-switches and exports.
  await step('技能市场安装 / 导出（B1c）', `
    const root = ctx.tmpPath('b1c-market');
    await ctx.mkdir(root + '/.codebuddy-connector');
    await ctx.mkdir(root + '/connectors/demo/skills/references');
    await ctx.mkdir(root + '/connectors/beta/skills');
    await ctx.writeFile(root + '/.codebuddy-connector/connectors.json', JSON.stringify({ connectors: [{ id: 'demo' }, { id: 'beta' }] }));
    await ctx.writeFile(root + '/connectors/demo/skills/SKILL.md', '---\\nname: market-alpha\\ndescription: 市场技能甲\\nversion: 3.1.0\\n---\\n\\n执行甲。\\n');
    await ctx.writeFile(root + '/connectors/demo/skills/references/a.md', '参考甲');
    await ctx.writeFile(root + '/connectors/beta/skills/SKILL.md', '---\\nname: market-beta\\ndescription: 市场技能乙\\nversion: 0.9.0\\n---\\n\\n执行乙。\\n');
    await page.evaluate((value) => localStorage.setItem('skillsCatalogRoot', value), root);
    // Remount the catalog so it reads the new root.
    await page.getByRole('tab', { name: '专家' }).click();
    await page.getByRole('tab', { name: '技能' }).click();
    const card = page.locator('.sk-card', { hasText: 'market-alpha' });
    await card.waitFor({ timeout: 15000 });
    await card.click();
    await page.locator('.sk-detail').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '导入技能' }).click();
    await page.locator('.sk-detail-installed').waitFor({ timeout: 20000 });
    const installedShot = await ctx.shot('25g-skill-market-installed');
    await page.locator('.sk-detail-bar .um-back').click();
    // A second skill through the same IPC path, for the batch switch.
    const second = await ctx.call('skills_install_from_catalog', { dirs: [root + '/connectors/beta/skills'] });
    if (second.failed.length) throw new Error('second install failed: ' + JSON.stringify(second.failed));
    await page.getByRole('button', { name: /我安装的/ }).click();
    const alphaRow = page.locator('.sk-inst-row', { hasText: 'market-alpha' });
    await alphaRow.waitFor({ timeout: 10000 });
    if (!(await alphaRow.textContent()).includes('v3.1.0')) throw new Error('version badge missing: ' + (await alphaRow.textContent()).slice(0, 120));
    await page.getByRole('button', { name: '全部停用' }).click();
    let alphaOff;
    for (let i = 0; i < 40; i++) {
      alphaOff = (await ctx.call('skills_list')).find((entry) => entry.name === 'market-alpha');
      if (alphaOff && !alphaOff.enabled) break;
      await ctx.sleep(250);
    }
    if (!alphaOff || alphaOff.enabled || !alphaOff.market) throw new Error('batch disable failed: ' + JSON.stringify(alphaOff));
    // The panel state updates after the IPC round-trips; wait for the row before the next batch.
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll('.sk-inst-row')].find((node) => node.textContent.includes('market-alpha'));
      return !!row && row.querySelector('input[type=checkbox]')?.checked === false;
    }, null, { timeout: 20000 });
    const batchShot = await ctx.shot('25h-skill-batch-off');
    await page.getByRole('button', { name: '全部启用' }).click();
    let alpha;
    for (let i = 0; i < 40; i++) {
      alpha = (await ctx.call('skills_list')).find((entry) => entry.name === 'market-alpha');
      if (alpha?.enabled) break;
      await ctx.sleep(250);
    }
    if (!alpha?.enabled) throw new Error('batch enable failed: ' + JSON.stringify(alpha));
    const on = await ctx.call('skills_list');
    const target = ctx.tmpPath('market-alpha.zip');
    const exported = await ctx.call('skills_export_zip', { path: alpha.path, target });
    if (!exported.files.includes('SKILL.md')) throw new Error('zip missing SKILL.md: ' + JSON.stringify(exported.files));
    const b64 = await ctx.call('read_file_base64', { path: target, maxBytes: 1048576 });
    if (!String(b64).startsWith('UEsDB')) throw new Error('exported file is not a ZIP');
    const beta = on.find((entry) => entry.name === 'market-beta');
    if (beta?.path) await ctx.call('skills_remove', { path: beta.path });
    await ctx.call('skills_remove', { path: alpha.path });
    if ((await ctx.call('skills_list')).some((entry) => entry.name === 'market-alpha')) throw new Error('market-alpha survived removal');
    return { version: '3.1.0', files: exported.files.length, market: alpha.market === true, shots: [installedShot, batchShot] };`);
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
  // B2a: team pipeline — each child is bound to its own expert, events carry team/role.
  await step('团队子代理（B2a）', `
    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').fill('__TEAM__ 按投研流程完成这份材料');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const allow = page.getByRole('button', { name: '允许本次', exact: true });
    await allow.waitFor({ timeout: 30000 });
    await allow.click();
    await page.locator('.subagent-card').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.subagent-card__state--done').length >= 2, null, { timeout: 60000 });
    await ctx.sleep(800);
    const titles = await page.locator('.subagent-card__title').allTextContents();
    if (!titles.some((title) => title.includes('深度调研员'))) throw new Error('builtin expert name not resolved: ' + JSON.stringify(titles));
    if (!titles.some((title) => title.includes('代码审查员'))) throw new Error('builtin expert name not resolved: ' + JSON.stringify(titles));
    if (!titles.some((title) => title.includes('调研'))) throw new Error('team role 调研 missing: ' + JSON.stringify(titles));
    if (!titles.some((title) => title.includes('审阅'))) throw new Error('team role 审阅 missing: ' + JSON.stringify(titles));
    return { titles, shot: await ctx.shot('36b-team-subagent-cards') };`);
  // B2b: ob_docx / ob_xlsx / ob_pptx are ordinary Pi tools — approval gate, checkpoint, artifacts refresh.
  await step('办公产物（B2b）', `
    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.wb-composer__input').fill('__OFFICE__ 生成季度销售表格');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const allow = page.getByRole('button', { name: '允许本次', exact: true });
    await allow.waitFor({ timeout: 30000 });
    await allow.click();
    await page.getByText('表格已生成', { exact: false }).first().waitFor({ timeout: 60000 });
    const toggle = page.getByRole('button', { name: '展开右侧栏', exact: true });
    if (await toggle.isVisible()) await toggle.click();
    await page.locator('.bench-item__main').first().waitFor({ timeout: 15000 });
    const paths = await page.locator('.bench-item__main').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('title')));
    const path = paths.find((p) => p && p.endsWith('.xlsx'));
    if (!path) throw new Error('xlsx artifact missing: ' + JSON.stringify(paths));
    const b64 = await ctx.call('read_file_base64', { path, maxBytes: 1048576 });
    if (!String(b64).startsWith('UEsDB')) throw new Error('not an OOXML (ZIP) file: ' + String(b64).slice(0, 12));
    await ctx.sleep(800);
    return { paths, path, shot: await ctx.shot('36c-office-xlsx') };`);
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
  // W6.5: 会话 JSONL 导出 → 导入为新会话（新 id，原会话不变）。
  await step('会话导出 / 导入（JSONL）', `
    const workspaces = await ctx.call('agent_list_workspaces');
    const cwd = workspaces[0] && workspaces[0].cwd;
    if (!cwd) throw new Error('no workspace to export from');
    const sessions = await ctx.call('agent_list_sessions', { cwd });
    const source = sessions.find((s) => s.sessionId)?.sessionId;
    if (!source) throw new Error('no session to export');
    const file = ctx.tmpPath('session-export.jsonl');
    const exported = await ctx.call('agent_export_jsonl', { sessionId: source, outputPath: file });
    if (exported !== file) throw new Error('unexpected export path: ' + exported);
    const imported = await ctx.call('agent_import_jsonl', { path: file });
    if (!imported || imported === source) throw new Error('import did not create a new session: ' + imported);
    const info = await ctx.call('agent_session_info', { sessionId: imported });
    if (!info || info.sessionId !== imported) throw new Error('imported session not loadable: ' + JSON.stringify(info));
    return { source, imported, exported };`);
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
    await page.waitForFunction(() => [...document.querySelectorAll('.tasks-panel__item')].some((node) => node.textContent?.includes('任务')), null, { timeout: 15000 });
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
  // W5.4: 项目由宿主持久化；清掉渲染层缓存并重载后仍在；项目说明进入新会话的系统提示词。
  await step('项目后端与项目说明 (pii W5.4)', `
    await page.locator('.sidebar [data-feature="projects"]').click();
    await page.getByRole('button', { name: /新建项目/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('请输入项目名称').fill('E2E 项目');
    await dialog.getByPlaceholder(/提供当前项目的背景信息/).fill('所有回答先给结论，再展开理由。');
    await dialog.getByRole('button', { name: '确定', exact: true }).click();
    await page.getByText('E2E 项目', { exact: true }).first().waitFor({ timeout: 10000 });
    const saved = await ctx.call('projects_snapshot');
    const project = saved.projects.find((p) => p.name === 'E2E 项目');
    if (!project || !String(project.instructions ?? '').includes('先给结论')) throw new Error('projects_snapshot: ' + JSON.stringify(saved).slice(0, 400));
    if (!project.cwd) throw new Error('project is not bound to the workspace');
    const shot = await ctx.shot('64-projects-host');
    // 清掉 localStorage 后重载：项目必须从宿主的 projects.json 回来。
    await page.evaluate(() => localStorage.removeItem('openbuddy.projects'));
    await page.reload();
    await page.locator('.sidebar [data-feature="projects"]').waitFor({ timeout: 20000 });
    await page.locator('.sidebar [data-feature="projects"]').click();
    await page.getByText('E2E 项目', { exact: true }).first().waitFor({ timeout: 10000 });
    // 新任务（同 cwd）的系统提示词应带上项目说明。
    await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
    await page.locator('.wb-composer__input').waitFor({ timeout: 15000 });
    await page.locator('.wb-composer__input').fill('确认项目说明已生效');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('以上内容由本地测试服务器生成', { exact: false }).first().waitFor({ timeout: 30000 });
    const last = ctx.fixture.requests.at(-1);
    if (last.project !== 'E2E 项目') throw new Error('project prompt missing: ' + JSON.stringify(last).slice(0, 300));
    return { shot, id: project.id, reloaded: true, projectPrompt: last.project };`);

  // U1: pin persists to projects.json, pinned cards sort first, and tasks filter by their real source.
  const pins = await step('项目置顶与任务来源筛选（U1）', `
    await page.locator('.sidebar [data-feature="projects"]').click();
    await page.getByText('E2E 项目', { exact: true }).first().waitFor({ timeout: 15000 });
    const card = page.locator('.project-card2').filter({ hasText: 'E2E 项目' }).first();
    await card.getByRole('button', { name: '置顶' }).click({ force: true });
    await page.waitForFunction(() => {
      const node = [...document.querySelectorAll('.project-card2')].find((item) => item.textContent.includes('E2E 项目'));
      return !!node && !!node.querySelector('.project-card2__pin--on');
    }, null, { timeout: 10000 });
    const snapshot = await ctx.call('projects_snapshot');
    const project = snapshot.projects.find((item) => item.name === 'E2E 项目');
    if (!project || !project.pinned) throw new Error('pin did not reach the host: ' + JSON.stringify(project).slice(0, 200));
    await ctx.call('projects_save', { project: { ...project, tasks: [
      { id: 'u1-manual', title: '手动任务', scope: 'personal', source: 'manual', status: 'pending' },
      { id: 'u1-import', title: '导入任务', scope: 'personal', source: 'imported', status: 'pending' },
    ] } });
    await page.reload();
    await page.locator('.sidebar [data-feature="projects"]').waitFor({ timeout: 20000 });
    await page.locator('.sidebar [data-feature="projects"]').click();
    await page.getByText('E2E 项目', { exact: true }).first().click();
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await page.getByText('手动任务').waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.pd-select option').length >= 3, null, { timeout: 10000 });
    const select = page.getByRole('combobox', { name: '按来源筛选' });
    await select.selectOption('imported');
    if (await page.getByText('手动任务').count()) throw new Error('source filter kept a manual task');
    if (!(await page.getByText('导入任务').count())) throw new Error('source filter hid the imported task');
    const options = await select.locator('option').count();
    const shot = await ctx.shot('78b-project-pin');
    await page.getByRole('button', { name: '新建任务', exact: true }).first().click();
    await page.locator('.wb-composer__input').waitFor({ timeout: 15000 });
    return { pinned: true, options, shot };`);
  // B4: keyboard + accessible names on the main surfaces, narrow viewport included.
  const a11y = await step('无障碍与键盘（B4）', `
    const scan = () => page.evaluate(() => {
      const issues = [];
      const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
      const named = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        if (visible(el) && !named(el)) issues.push('button:' + (el.className || el.tagName));
      }
      for (const el of document.querySelectorAll('input, textarea, select')) {
        if (!visible(el)) continue;
        const id = el.id;
        const labelled = (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) || el.closest('label')
          || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder') || el.getAttribute('title');
        if (!labelled) issues.push('control:' + el.tagName + '.' + el.className);
      }
      for (const el of document.querySelectorAll('img')) {
        if (visible(el) && !el.hasAttribute('alt')) issues.push('img:' + String(el.getAttribute('src')).slice(0, 40));
      }
      for (const el of document.querySelectorAll('[role="dialog"]')) {
        if (!visible(el)) continue;
        if (el.getAttribute('aria-modal') !== 'true') issues.push('dialog-modal:' + el.className);
        if (!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) issues.push('dialog-name:' + el.className);
      }
      return issues;
    });
    const results = {};
    results.chat = await scan();

    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ timeout: 15000 });
    await ctx.sleep(500);
    results.home = await scan();

    await page.locator('.sidebar__nav > [data-feature="experts-hub"]').click();
    await page.getByRole('tab', { name: '专家' }).waitFor({ timeout: 10000 });
    await ctx.sleep(500);
    results.experts = await scan();

    await page.locator('.sidebar__nav > [data-feature="automation"]').click();
    await ctx.sleep(600);
    results.automation = await scan();

    // Keyboard: focus 设置, Enter opens, Escape closes (no mouse involved).
    const settingsBtn = page.getByRole('button', { name: '设置', exact: true }).first();
    await settingsBtn.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: '设置' }).waitFor({ timeout: 10000 });
    await ctx.sleep(500);
    results.settings = await scan();
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });

    // Narrow viewport: the same scan at 900×800.
    await ctx.setSize(900, 800);
    await ctx.sleep(500);
    results.narrow = await scan();
    await ctx.setSize(1440, 900);
    await ctx.sleep(300);

    const issues = Object.entries(results).flatMap(([screen, list]) => list.map((item) => screen + ':' + item));
    if (issues.length) throw new Error('a11y issues: ' + issues.slice(0, 12).join(' | '));
    return { screens: Object.keys(results), counts: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length])) };`);

  // O1: a renderer error reaches the main process' JSONL log, and the log is redacted on disk.
  const o1 = await step('可观测与恢复（O1）', `
    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 20000 });
    const secret = 'sk-e2e-observe-1234567890';
    const absPath = '/Users/e2e/secret-project/app.ts';
    await page.evaluate(([secret, absPath]) => console.error('O1LOGPROBE ' + secret + ' ' + absPath), [secret, absPath]);
    let logs = await ctx.readLogs();
    for (let i = 0; i < 25 && !logs.some(f => f.content.includes('O1LOGPROBE')); i += 1) {
      await ctx.sleep(200);
      logs = await ctx.readLogs();
    }
    const all = logs.map(f => f.content).join('');
    if (!all.includes('O1LOGPROBE')) throw new Error('renderer console error never reached <userData>/logs');
    if (all.includes(secret) || all.includes('/Users/e2e')) throw new Error('log leaked a credential or absolute path');
    if (!all.includes('[redacted]') || !all.includes('[path]')) throw new Error('log redaction markers missing');
    if (!/"scope":"renderer"/.test(all)) throw new Error('renderer record missing from structured JSONL');
    if (!/"scope":"main"/.test(all)) throw new Error('main-process startup record missing');
    return { files: logs.map(f => f.name), records: all.trim().split('\\n').length, redacted: true };`);

  // O1: the in-app viewer reads the same files through host commands (no renderer-supplied paths).
  const logViewer = await step('日志查看器（O1）', `
    const listed = await ctx.call('logs_list');
    if (!listed.files || !listed.files.length) throw new Error('logs_list returned no files');
    if (!listed.dir) throw new Error('logs_list did not report its directory');
    const first = listed.files[0].name;
    const read = await ctx.call('logs_read', { name: first, limit: 50 });
    if (!read.entries.length) throw new Error('logs_read returned no entries');
    if (read.entries.some((entry) => typeof entry.message !== 'string')) throw new Error('bad log entry shape');
    if (!read.entries.some((entry) => entry.message.includes('O1LOGPROBE'))) throw new Error('probe missing from the viewer payload');
    let refused = false;
    try { await ctx.call('logs_read', { name: '../../etc/passwd' }); } catch { refused = true; }
    if (!refused) throw new Error('logs_read accepted a path instead of a log name');
    // O1: merged cross-file read returns a time-ordered page.
    const merged = await ctx.call('logs_read', { name: 'all', limit: 5 });
    if (merged.name !== 'all' || !merged.entries.length) throw new Error('logs_read all failed: ' + JSON.stringify(merged).slice(0, 200));
    if ((await page.locator('.settings-modal-overlay').count()) === 0) {
      await page.getByRole('button', { name: '设置', exact: true }).first().click();
    }
    await page.locator('.settings-modal-overlay').waitFor({ state: 'visible', timeout: 15000 });
    // Dispatch the tab's own click: the modal overlay covers pointer hit-testing mid-animation.
    await page.locator('.settings-navigation__label').filter({ hasText: '帮助与反馈' }).first().evaluate((el) => el.click());
    await page.locator('.log-list').waitFor({ state: 'visible', timeout: 15000 });
    for (let i = 0; i < 25 && (await page.locator('.log-row').count()) === 0; i += 1) await ctx.sleep(200);
    const rows = await page.locator('.log-row').count();
    if (rows < 1) throw new Error('log viewer rendered no rows');
    // O1: switch to the merged view and keep the export action available.
    await page.getByRole('combobox', { name: '选择日志文件' }).selectOption('all');
    await page.waitForFunction(() => document.querySelectorAll('.log-row').length > 0, null, { timeout: 10000 });
    if (await page.getByRole('button', { name: /导出 \.txt/ }).isDisabled()) throw new Error('export action stayed disabled');
    const shot = await ctx.shot('77-log-viewer');
    // Leave the app on the home screen for the steps that follow (the modal blocks the sidebar).
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal-overlay').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    return { files: listed.files.map((file) => file.name), dir: listed.dir, entries: read.entries.length, rows, shot };`);

  // A2: versioned files, full export/restore (credentials omitted) and snapshot rollback on disk.
  const a2 = await step('数据导出 / 恢复与快照（A2）', `
    const exported = await ctx.call('data_export');
    const bundle = exported.bundle;
    if (bundle.kind !== 'openbuddy-data' || bundle.schemaVersion !== 1) throw new Error('bad bundle header: ' + JSON.stringify(bundle).slice(0, 200));
    if (!bundle.files['projects.json']) throw new Error('bundle missing projects.json');
    if (bundle.files['credentials.enc.json']) throw new Error('bundle leaked credentials');
    if (!bundle.omitted.includes('credentials.enc.json')) throw new Error('credentials not declared omitted');

    const projectsFile = JSON.parse(await ctx.readDataFile('projects.json'));
    if (projectsFile.schemaVersion !== 1 || !Array.isArray(projectsFile.projects) || !projectsFile.projects.length)
      throw new Error('projects.json is not versioned: ' + JSON.stringify(projectsFile).slice(0, 200));

    const restored = await ctx.call('data_restore', { bundle });
    if (!restored.restored.includes('projects.json') || restored.restartRequired !== true) throw new Error('restore result: ' + JSON.stringify(restored));
    if (!restored.snapshotId) throw new Error('restore did not snapshot the previous state');

    // Mutate after the restore, then roll the pre-restore snapshot back and check the disk.
    await ctx.call('projects_save', { project: { id: 'e2e-a2-temp', name: 'A2 临时项目' } });
    const dirty = JSON.parse(await ctx.readDataFile('projects.json'));
    if (!dirty.projects.some((p) => p.id === 'e2e-a2-temp')) throw new Error('temporary project was not persisted');

    const rolled = await ctx.call('data_snapshot_restore', { id: restored.snapshotId });
    if (!rolled.restored.includes('projects.json')) throw new Error('snapshot rollback restored nothing');
    const rolledFile = JSON.parse(await ctx.readDataFile('projects.json'));
    if (rolledFile.projects.some((p) => p.id === 'e2e-a2-temp')) throw new Error('rollback left the temporary project on disk');

    const { snapshots } = await ctx.call('data_snapshots');
    return { files: Object.keys(bundle.files), omitted: bundle.omitted, snapshots: snapshots.length, rollbackKept: rolledFile.projects.length };`);

  // A4: runtime budgets — one local turn, then main+renderer working set and renderer heap.
  const perf = await step('性能预算（A4）', `
    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 20000 });
    const started = Date.now();
    await page.locator('.wb-composer__input').fill('A4 性能预算：本地快速回复');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('以上内容由本地测试服务器生成', { exact: false }).first().waitFor({ timeout: 20000 });
    const turnLatencyMs = Date.now() - started;
    if (turnLatencyMs > 20000) throw new Error('turn latency too slow: ' + turnLatencyMs + 'ms');

    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, wsKb: m.memory.workingSetSize })));
    const workingSetMb = Math.round(metrics.reduce((sum, m) => sum + m.wsKb, 0) / 1024);
    const heapMb = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
    if (workingSetMb > 900) throw new Error('working set too large: ' + workingSetMb + 'MB');
    if (heapMb > 450) throw new Error('renderer heap too large: ' + heapMb + 'MB');
    return { turnLatencyMs, workingSetMb, heapMb, processes: metrics.length };`);

  // A3: real manifest fetch through the host, insecure feeds rejected, About UI shows the release.
  const a3 = await step('更新检查（A3）', `
    const direct = await ctx.call('update_check');
    if (direct.status !== 'available' || direct.version !== '9.9.9') throw new Error('update_check: ' + JSON.stringify(direct));
    if (!String(direct.notes).includes('A3')) throw new Error('update notes missing');
    let rejected = '';
    try {
      await ctx.call('update_check', { feedUrl: 'http://evil.example.com/latest.json' });
    } catch (error) {
      rejected = String(error);
    }
    if (!/insecure_feed_url/.test(rejected)) throw new Error('insecure feed was not rejected: ' + rejected);

    const settingsBtn = page.getByRole('button', { name: '设置', exact: true }).first();
    await settingsBtn.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: '设置' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '关于', exact: true }).click();
    await page.getByRole('button', { name: /检查更新/ }).click();
    await page.getByText('发现新版本 v9.9.9').waitFor({ timeout: 15000 });
    const region = await page.getByRole('region', { name: '可用更新' }).innerText();
    if (!region.includes('A3 更新说明')) throw new Error('release notes missing from About: ' + region.slice(0, 200));
    await page.getByRole('button', { name: /打开下载页/ }).waitFor({ timeout: 5000 });
    // A3: download the installer; the host must verify size + sha256 before revealing it.
    await page.getByRole('button', { name: /下载安装包/ }).click();
    await page.getByText('已下载到本机并通过校验', { exact: false }).waitFor({ timeout: 20000 });
    const path = (await page.locator('.about-card__path').innerText()).trim();
    if (!/updates[\\/]OpenBuddy-9\\.9\\.9\\.dmg$/.test(path)) throw new Error('installer path: ' + path);
    const digest = await ctx.fileDigest(path);
    if (!digest.exists || digest.size !== 4096) throw new Error('installer missing or wrong size: ' + JSON.stringify(digest));
    if (digest.sha256 !== ${JSON.stringify(INSTALLER_SHA)}) throw new Error('installer checksum mismatch: ' + digest.sha256);
    const shot = await ctx.shot('78c-update-download');
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });
    return { status: direct.status, version: direct.version, rejected: true, ui: true, downloadedBytes: digest.size, verified: true, shot };`);

  // B4: contrast ratios, 1024×768 and 125% zoom (no overflow, composer stays usable).
  const contrast = await step('对比度与缩放（B4）', `
    const scanContrast = () => page.evaluate(() => {
      const parse = (value) => {
        const m = String(value).match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const p = m[1].split(',').map((x) => Number(x.trim()));
        return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
      };
      const lum = ({ r, g, b }) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (x, y) => { const a = lum(x); const b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
      const background = (el) => {
        const layers = [];
        for (let node = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          const c = parse(style.backgroundColor);
          if (c && c.a > 0) layers.push(c);
          if (c && c.a >= 1) break;
        }
        let out = { r: 255, g: 255, b: 255, a: 1 };
        for (const layer of layers.reverse()) out = blend(layer, out);
        return out;
      };
      const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
      const issues = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!visible(el)) continue;
        const ownText = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
        if (!ownText) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        if (el.closest('[disabled],[aria-disabled="true"]')) continue;
        if (style.backgroundImage !== 'none') continue;
        const fg = parse(style.color);
        if (!fg) continue;
        const bg = background(el);
        const fgFinal = fg.a < 1 ? blend(fg, bg) : fg;
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (Number(style.fontWeight) >= 600 && size >= 18.66);
        const need = large ? 3 : 4.5;
        const value = ratio(fgFinal, bg);
        if (value + 0.01 < need) {
          issues.push({ text: ownText.slice(0, 24), cls: String(el.className).slice(0, 40), color: style.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')', ratio: Math.round(value * 100) / 100, need });
        }
      }
      return issues.slice(0, 20);
    });
    const overflow = () => page.evaluate(() => {
      const box = document.querySelector('.wb-composer')?.getBoundingClientRect();
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        composer: box ? { x: Math.round(box.x), right: Math.round(box.right) } : null,
      };
    });

    // The A4 step left us on a conversation: audit message text before navigating away.
    const chatLight = await scanContrast();

    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 20000 });
    await ctx.sleep(400);
    const light = await scanContrast();
    const homeShot = await ctx.shot('66-home-contrast');

    // Dark theme: same scanner over the home and the settings dialog.
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await ctx.sleep(500);
    const darkHome = await scanContrast();
    const darkShot = await ctx.shot('69-home-dark-contrast');
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    await page.getByRole('dialog', { name: '设置' }).waitFor({ timeout: 10000 });
    await ctx.sleep(400);
    const darkSettings = await scanContrast();
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    await ctx.sleep(300);

    await ctx.setSize(1024, 768);
    await ctx.sleep(500);
    const small = await overflow();
    if (small.scrollWidth > small.width + 1) throw new Error('horizontal overflow at 1024×768: ' + JSON.stringify(small));
    if (!small.composer || small.composer.x < 0 || small.composer.right > small.width + 1) throw new Error('composer outside 1024×768: ' + JSON.stringify(small));
    const smallShot = await ctx.shot('67-home-1024x768');

    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25); });
    await ctx.sleep(600);
    const zoomed = await overflow();
    if (zoomed.scrollWidth > zoomed.width + 1) throw new Error('horizontal overflow at 125%: ' + JSON.stringify(zoomed));
    if (!zoomed.composer || zoomed.composer.x < 0 || zoomed.composer.right > zoomed.width + 1) throw new Error('composer outside 125%: ' + JSON.stringify(zoomed));
    const zoomShot = await ctx.shot('68-home-125pct');
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1); });
    await ctx.setSize(1440, 900);
    await ctx.sleep(400);

    // Settings (dialog) contrast in the normal viewport.
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    await page.getByRole('dialog', { name: '设置' }).waitFor({ timeout: 10000 });
    await ctx.sleep(400);
    const settingsIssues = await scanContrast();
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });

    const issues = [
      ...chatLight.map((i) => ({ screen: 'chat', ...i })),
      ...light.map((i) => ({ screen: 'home', ...i })),
      ...settingsIssues.map((i) => ({ screen: 'settings', ...i })),
      ...darkHome.map((i) => ({ screen: 'dark-home', ...i })),
      ...darkSettings.map((i) => ({ screen: 'dark-settings', ...i })),
    ];
    if (issues.length) throw new Error('contrast issues: ' + JSON.stringify(issues.slice(0, 8)));
    return { issues: 0, screens: ['chat', 'home', 'settings', 'dark-home', 'dark-settings'], sizes: { small, zoomed }, shots: [homeShot, darkShot, smallShot, zoomShot] };`);

  // B4: the settings surface switches to English, survives a reload, and switches back.
  const i18n = await step('界面语言（B4）', `
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    await page.getByRole('dialog', { name: '设置' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '通用', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'About', exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'New task', exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Projects', exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'About', exact: true }).click();
    await page.getByRole('heading', { name: 'About', exact: true }).waitFor({ timeout: 5000 });
    if (!(await page.getByText('WorkBuddy on Pi', { exact: false }).count())) throw new Error('english About copy missing');
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });

    // Reload: the choice lives in localStorage and must survive.
    await page.reload();
    await page.locator('.sidebar__nav-item').first().waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('button', { name: 'About', exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'General', exact: true }).click();
    await page.getByRole('button', { name: '简体中文', exact: true }).click();
    await page.getByRole('button', { name: '关于', exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '新建任务', exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '设置', exact: true }).waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });
    return { switched: 'en-US', persisted: true, restored: 'zh-CN' };`);

  // B1a: a real JS extension is loaded by Pi's loader, listed, and its tool runs end-to-end.
  const extension = await step('Pi 扩展试点（B1a）', `
    const path = ctx.repo + '/examples/pi-extension-demo/extension.mjs';
    const listed = await ctx.call('agent_extensions_list');
    const item = (listed.items ?? []).find((entry) => String(entry.path).endsWith('extension.mjs'));
    if (!item || !item.ok) throw new Error('example extension not loaded: ' + JSON.stringify(listed).slice(0, 400));
    if (!item.tools.includes('demo_echo')) throw new Error('demo_echo not registered: ' + JSON.stringify(item));
    if (!item.commands.includes('demo')) throw new Error('demo command not registered: ' + JSON.stringify(item));
    const inspected = await ctx.call('agent_extensions_inspect', { path });
    if (!inspected.ok || !inspected.tools.includes('demo_echo')) throw new Error('inspect failed: ' + JSON.stringify(inspected));

    await page.locator('.sidebar__nav-item', { hasText: '新建任务' }).first().click();
    await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('.wb-composer__input').fill('__EXT_DEMO__ 用示例扩展回显一段文字');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const allow = page.getByRole('button', { name: '允许本次', exact: true });
    if (await allow.count()) await allow.first().click();
    await page.getByText('扩展回声：demo:pi-extension-ok', { exact: false }).first().waitFor({ timeout: 30000 });
    return { tools: item.tools, commands: item.commands, executed: true };`);

  // B5: the Help panel links to the shipped user docs (real hrefs, no placeholders).
  const docsStep = await step('帮助文档（B5）', `
    await page.getByRole('button', { name: '设置', exact: true }).first().click();
    await page.getByRole('dialog', { name: '设置' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '帮助与反馈', exact: true }).click();
    await page.getByRole('heading', { name: '帮助与反馈', exact: true }).waitFor({ timeout: 5000 });
    const expected = [['用户手册', 'docs/user-guide.md'], ['常见问题', 'docs/faq.md'], ['故障排查', 'docs/troubleshooting.md'], ['隐私说明', 'docs/privacy.md'], ['更新说明', 'docs/release-notes.md']];
    for (const [name, suffix] of expected) {
      const link = page.getByRole('link', { name, exact: true });
      const href = await link.getAttribute('href');
      if (!href || !href.endsWith(suffix)) throw new Error('bad doc link ' + name + ': ' + href);
    }
    if (await page.getByText('即将上线').count()) throw new Error('help panel still shows a placeholder');
    await page.keyboard.press('Escape');
    await page.locator('.settings-modal').waitFor({ state: 'detached', timeout: 5000 });
    return { links: expected.length };`);

  const audit = await step('audit', `
    const a = await ctx.audit();
    const rejected = a.main.filter(r => r.status === 'rejected');
    return {
      invoked: a.main.length,
      distinctCommands: [...new Set(a.main.map(r => r.command))].length,
      byCommand: Object.fromEntries(Object.entries(a.main.reduce((m, r) => ({ ...m, [r.command]: (m[r.command] ?? 0) + 1 }), {})).sort()),
      rejected: rejected.map(r => ({ command: r.command, error: r.error })),
      notImplemented: [...a.main.filter(r => /not_implemented/.test(r.error ?? '')), ...a.renderer.filter(r => /not_implemented/.test(r.message))].map(r => r.command),
      pageErrors: ctx.pageErrors.map(e => ({ message: e.message, stack: e.stack })),
      fixtureRequests: ctx.fixture.requests.length,
    };`);
  if (audit.pageErrors.length) throw new Error(`renderer page errors: ${audit.pageErrors.map(e => e.message + ' @ ' + String(e.stack ?? '').split('\\n').slice(0, 3).join(' <- ')).join(' | ')}`);
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
