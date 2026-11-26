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
const call = (command, payload = {}) => page.evaluate(({ command, payload }) => window.openbuddy.invoke(command, payload), { command, payload });
await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 30000 });

// 一个可用的本地回环模型，避免首页卡在「未配置」。
await call('providers_save_provider', {
  provider: { id: 'magpie', providerKind: 'magpie', label: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', apiBackend: 'chat_completions', authScheme: 'bearer' },
}).catch(() => {});
await call('agent_extensions_install_package', { source: repo });
await call('agent_extensions_set_enabled', { enabled: true });
const init = await call('agent_init');
await call('folder_trust_respond', { cwd: init.cwd, trusted: true });

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

// 2) 扩展中心：UpUp 子包开关 + 健康检查
await page.getByRole('button', { name: /更多.*文件/ }).hover();
await page.getByRole('menuitem', { name: '专家·技能·连接器', exact: true }).click().catch(async () => {
  await page.getByRole('button', { name: '专家·技能·连接器', exact: true }).first().click();
});
await page.getByRole('tab', { name: '扩展' }).click().catch(() => {});
await page.getByText('UpUp 子包开关', { exact: true }).waitFor({ timeout: 30000 });
await page.screenshot({ path: 'release/ui-upup-extensions.png', fullPage: true });
console.log('SHOT extensions');

// 3) 安全中心：平台工具策略
await page.getByRole('button', { name: '设置', exact: true }).first().click();
await page.getByText('安全中心', { exact: true }).first().click();
await page.locator('[aria-label="平台工具策略"]').first().waitFor({ state: 'attached', timeout: 30000 });
await page.locator('[aria-label="平台工具策略"]').first().scrollIntoViewIfNeeded();
await page.screenshot({ path: 'release/ui-upup-policy.png' });
console.log('SHOT policy');

await app.close();
console.log('UPUP_SHOTS_DONE', await realpath('release'));
