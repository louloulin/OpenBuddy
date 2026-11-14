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
  const audit = await step('audit', `
    const a = await ctx.audit();
    const rejected = a.main.filter(r => r.status === 'rejected');
    return {
      invoked: a.main.length,
      distinctCommands: [...new Set(a.main.map(r => r.command))].length,
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
