import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * UpUp 核心 UI 截图 (20261126-upup)。
 *
 * 真机 Electron：装 UpUp（本地 checkout）→ 启用 + 信任 → 截四张图：
 *   1. 输入卡 + `+ → 应用`（应用卡与场景）
 *   2. 扩展中心（UpUp 子包开关 + 会话工具健康检查）
 *   3. 安全中心（平台工具策略）
 *
 *   node apps/desktop/scripts/upup-ui-shots.mjs
 */
const require = createRequire(import.meta.url);
const main = resolve(process.env.OPENBUDDY_MAIN ?? 'dist-electron/main.js');
const repo = process.env.UPUP_REPO ?? join(process.env.HOME ?? '', 'stock', 'upup');
const temp = await mkdtemp(join(tmpdir(), 'openbuddy-upup-shots-'));
const profile = join(temp, 'profile');
const harness = join(temp, 'bootstrap');
await mkdir(profile);
await mkdir(harness);
await mkdir('release', { recursive: true });
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'openbuddy-upup-shots', main: 'bootstrap.cjs' }));
await writeFile(join(harness, 'bootstrap.cjs'), `
const {app}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
import(${JSON.stringify(pathToFileURL(main).href)}).catch(e=>{console.error(e);app.exit(1)});
`);

const app = await electron.launch({
  executablePath: require('electron'),
  args: [harness],
  env: { ...process.env, OPENBUDDY_SMOKE_TEST: '0' },
  timeout: 30000,
});
const page = await app.firstWindow();
page.on('pageerror', (error) => { (globalThis.__errs ??= []).push(String(error)); console.log('PAGEERROR', String(error).slice(0, 200)); });
const call = (command, payload = {}) => page.evaluate(({ command, payload }) => window.openbuddy.invoke(command, payload), { command, payload });
await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 30000 });

// 一个可用的本地回环模型，避免首页卡在「未配置」。
await call('providers_save_provider', {
  provider: { id: 'magpie', providerKind: 'magpie', label: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', apiBackend: 'chat_completions', authScheme: 'bearer' },
}).catch(() => {});
// 免 Key 的本机网关也要有「模型」才算就绪（修复后 authStatus 认 keyless，但没有模型仍然是未配置）。
const fetched = await call('providers_fetch_models', { providerId: 'magpie' }).catch(() => []);
const chosen = (fetched ?? []).find((m) => /MiniMax-M3\.1-Flash$/i.test(m.id)) ?? (fetched ?? [])[0];
if (chosen) {
  await call('providers_save_model', { model: { modelId: chosen.id, providerId: 'magpie', displayName: chosen.id } }).catch(() => {});
}
await call('agent_extensions_install_package', { source: repo });
await call('agent_extensions_set_enabled', { enabled: true });
const init = await call('agent_init');
await call('folder_trust_respond', { cwd: init.cwd, trusted: true });

// 0) 首页（应用场景行）：装完应用后刷新一次，让首页读到最新应用
await page.reload();
await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'release/ui-upup-home-scenes.png' });
console.log('SHOT home-scenes');

// 0b) 侧栏「Buddy 应用」切换器（WorkBuddy 顶栏药丸 → 面板）
await page.getByRole('button', { name: /当前应用|选择应用/ }).first().click();
await page.getByRole('dialog', { name: 'Buddy 应用' }).waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'release/ui-upup-app-switcher.png' });
console.log('SHOT app-switcher');
await page.keyboard.press('Escape');
await page.locator('body').click({ position: { x: 700, y: 400 } }).catch(() => {});

// 1) 输入卡 + `+ → 应用`
await page.getByRole('button', { name: '添加', exact: true }).click();
// 子菜单是 hover 触发的（带防抖），多试几次直到它出现。
let appMenuOpen = false;
for (let attempt = 0; attempt < 6 && !appMenuOpen; attempt += 1) {
  await page.getByRole('menuitem', { name: '应用', exact: true }).hover();
  appMenuOpen = await page.locator('.iam-submenu').isVisible().catch(() => false);
  if (!appMenuOpen) await page.waitForTimeout(400);
}
if (!appMenuOpen) {
  console.log('APPS_BODY', (await page.locator('.iam-popover').innerText().catch(() => 'no-menu')).slice(0, 200));
  throw new Error('app submenu did not open');
}
await page.getByText('应用场景', { exact: true }).waitFor({ timeout: 20000 });
await page.screenshot({ path: 'release/ui-upup-app-picker.png' });
console.log('SHOT app-picker');
await page.keyboard.press('Escape');

// 1b) 应用页（WorkBuddy「Buddy 应用」式的网格）
await page.getByRole('button', { name: /更多.*文件/ }).hover();
await page.getByRole('menuitem', { name: '应用', exact: true }).click();
await page.getByText('应用', { exact: true }).first().waitFor({ timeout: 20000 });
await page.locator('.apps-grid').waitFor({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: 'release/ui-upup-apps-page.png' });
console.log('SHOT apps-page');

// 2) 扩展中心：UpUp 子包开关 + 健康检查
await page.getByRole('button', { name: /更多.*文件/ }).hover();
await page.getByRole('menuitem', { name: '专家·技能·连接器', exact: true }).click().catch(async () => {
  await page.getByRole('button', { name: '专家·技能·连接器', exact: true }).first().click();
});
await page.getByRole('tab', { name: '扩展' }).click().catch(() => {});
await page.getByText('UpUp 子包开关', { exact: true }).waitFor({ timeout: 30000 });
// 先拍「健康检查」那张（在面板上方），再滚到子包开关。
await page.evaluate(() => {
  document.querySelector('[aria-label="会话工具健康检查"]')?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'release/ui-upup-health.png' });
console.log('SHOT health');
await page.evaluate(() => {
  document.querySelector('[aria-label="UpUp 子包"]')?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(800);
await page.screenshot({ path: 'release/ui-upup-extensions.png' });
console.log('SHOT extensions');

// 3) 安全中心：平台工具策略（卡片在面板下方，先滚到它）
await page.locator('.sidebar__icon-btn[aria-label="设置"]').first().click();
await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 20000 });
await page.getByText('安全中心', { exact: true }).first().click();
await page.waitForFunction(() => !!document.querySelector('[aria-label="平台工具策略"]'), undefined, { timeout: 30000 });
await page.evaluate(() => {
  document.querySelector('[aria-label="平台工具策略"]')?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'release/ui-upup-policy.png' });
console.log('SHOT policy');

await app.close();
console.log('UPUP_SHOTS_DONE', await realpath('release'));
