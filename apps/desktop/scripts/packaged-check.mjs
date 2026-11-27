import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 打包产物真机验证 (20261127-upup §1.13)：真正的 DMG → 挂载 → 拷出 .app → 用**精简 PATH**启动
 * （模拟从访达/启动台打开：launchd 只给 /usr/bin:/bin:/usr/sbin:/sbin），然后：
 *
 *   1. 首次启动的默认应用安装（Git 源 UpUp，`apps_ensure_default`）在打包环境里真的完成；
 *   2. 配 magpie 本机网关真实模型，在界面输入框里发问 → 真实模型调 UpUp 行情 → 数据卡出现；
 *   3. 连续多轮对话（OPENBUDDY_PACKAGED_ROUNDS，默认 3），每轮都要结束（不卡住），记录主进程 RSS；
 *   4. 收集 pageerror / console error / 主进程日志里的 error。
 *
 *   node apps/desktop/scripts/packaged-check.mjs [path/to.dmg]
 *
 * 每一步都有超时，整体有看门狗；失败时截图并把读数写进 release/packaged-check.json。
 */
const dmg = resolve(process.argv[2] ?? 'release/OpenBuddy-1.0.0-mac-arm64.dmg');
const magpieUrl = process.env.MAGPIE_URL ?? 'http://127.0.0.1:3425/v1';
const rounds = Number(process.env.OPENBUDDY_PACKAGED_ROUNDS ?? 3);
/**
 * `fresh`：模拟一台新电脑（空 HOME + `/bin/sh`）：没有 Node.js/npm（本机 npm 只在 mise 里），
 * 也没有 gitcode 登录凭据（实测 UpUp 仓库需要登录才能克隆）。
 * 期望：默认安装很快失败并记日志、应用页确认卡给出**可读原因**且禁用安装、对话照常可用、不卡住。
 */
const scenario = process.env.OPENBUDDY_PACKAGED_SCENARIO ?? 'default';
const work = realpathSync(mkdtempSync(join(tmpdir(), 'openbuddy-packaged-')));
const userData = join(work, 'userData');
const mount = join(work, 'mnt');
const report = { scenario, dmg, dmgMB: Math.round(statSync(dmg).size / 1048576), steps: [], pageErrors: [], consoleErrors: [], rss: [] };
const step = (name, evidence = {}) => { report.steps.push({ name, at: new Date().toISOString(), ...evidence }); console.log('PACKAGED_STEP', name, JSON.stringify(evidence)); };
const save = () => writeFileSync(`release/packaged-check${scenario === 'default' ? '' : `-${scenario}`}.json`, JSON.stringify(report, null, 2));
function mkdirFake(dir) { mkdirSync(dir, { recursive: true }); return dir; }
const mainLog = () => {
  const dir = join(userData, 'logs');
  return existsSync(dir) ? readdirSync(dir).flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n')) : [];
};

async function freshMachine(call, info, rss) {
  // a) 默认安装：失败要快、要记日志，不能挂着。
  const started = Date.now();
  let line;
  while (Date.now() - started < 5 * 60_000 && !(line = mainLog().find((l) => /default-app/.test(l)))) await page.waitForTimeout(2000);
  if (!line) throw new Error('5 分钟内没有默认安装的结果日志');
  const apps = await call('apps_list', {});
  if (apps.some((entry) => entry.id === 'upup')) throw new Error('没有 npm 却装上了 UpUp（场景没模拟成功）');
  step('fresh: default install fails fast and is logged', { ms: Date.now() - started, log: line.slice(0, 400) });
  // b) 应用页：检查并安装 → 确认卡给出可读原因，确认按钮禁用。
  await page.getByRole('button', { name: /更多.*文件/ }).hover();
  await page.getByRole('menuitem', { name: '应用', exact: true }).click();
  await page.getByRole('region', { name: '安装 UpUp' }).getByRole('button', { name: '检查并安装' }).click();
  const confirm = page.getByRole('dialog', { name: /^安装确认/ });
  await confirm.waitFor({ timeout: 240_000 });
  const text = await confirm.innerText();
  const disabled = await confirm.getByRole('button', { name: '确认安装' }).isDisabled();
  await page.screenshot({ path: 'release/packaged-fresh-confirm.png' });
  // 可读原因 = 命中了具体分类（缺 npm / 需要认证 / 网络…），不是兜底的「安装失败。请查看原始信息」。
  if (!/找不到 Node\.js|需要认证|无法连接|缺少 Git/.test(text) || !disabled) throw new Error(`确认卡没有给出可读原因或没禁用：${text}`);
  step('fresh: confirm card explains why and blocks install', { lines: text.split('\n').slice(0, 10), disabled });
  await confirm.getByRole('button', { name: '取消' }).click();
  // c) 没有应用也要能正常对话（内置应用 + 真实模型）。
  await call('providers_save_provider', { provider: { id: 'magpie', providerKind: 'magpie', label: 'magpie', baseUrl: magpieUrl, apiBackend: 'chat_completions', authScheme: 'bearer' } });
  const models = await call('providers_fetch_models', { providerId: 'magpie' });
  const chosen = models.find((m) => /minimax-m3\.1-flash$/i.test(m.id)) ?? models[0];
  await call('providers_save_model', { model: { modelId: chosen.id, providerId: 'magpie', displayName: chosen.id } });
  await call('agents_defaults_save', { defaults: { defaultModel: chosen.id, defaultProviderId: 'magpie', defaultPermission: 'always-approve' } });
  await page.getByRole('button', { name: '新建任务' }).first().click();
  await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 60_000 });
  const turnStarted = Date.now();
  await page.locator('.wb-composer__input').fill('一句话介绍一下你自己。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: /停止/ }).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await page.getByRole('button', { name: /停止/ }).first().waitFor({ state: 'hidden', timeout: 180_000 });
  step('fresh: chat with the built-in app still works', { ms: Date.now() - turnStarted, modelId: chosen.id });
  await rss('fresh chat');
  report.mainLogErrors = mainLog().filter((l) => /"level":"error"/.test(l)).slice(-5);
  step('finished', { pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length, mainLogErrors: report.mainLogErrors.length });
}
const watchdog = setTimeout(() => { report.error = 'watchdog: 整体超过 25 分钟'; save(); console.error('PACKAGED_WATCHDOG'); process.exit(2); }, 25 * 60_000);

let app;
let page;
try {
  // 1) 挂载 DMG，拷出 .app（不直接从只读卷运行，和用户拖进「应用程序」一致）。
  execFileSync('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount], { stdio: 'pipe' });
  const bundle = readdirSync(mount).find((name) => name.endsWith('.app'));
  if (!bundle) throw new Error('DMG 里没有 .app');
  execFileSync('ditto', [join(mount, bundle), join(work, bundle)]);
  execFileSync('hdiutil', ['detach', mount, '-quiet']);
  const executable = join(work, bundle, 'Contents', 'MacOS', bundle.replace(/\.app$/, ''));
  const signature = (() => { try { return execFileSync('codesign', ['-dv', join(work, bundle)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { return String(error.stderr ?? error.message); } })();
  step('dmg mounted and app copied', { bundle, appMB: Math.round(Number(execFileSync('du', ['-sk', join(work, bundle)], { encoding: 'utf8' }).split(/\s+/)[0]) / 1024), signature: signature.split('\n').filter((line) => /Signature|Authority|TeamIdentifier/.test(line)).slice(0, 3) });

  // 2) 用访达式的精简环境启动；userData 隔离到临时目录。
  const started = Date.now();
  app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
    env: {
      HOME: scenario === 'fresh' ? mkdirFake(join(work, 'home')) : process.env.HOME,
      ...(scenario === 'fresh' ? { SHELL: '/bin/sh' } : {}),
      USER: process.env.USER, TMPDIR: process.env.TMPDIR, LANG: 'zh_CN.UTF-8', PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    },
    timeout: 120_000,
  });
  page = await app.firstWindow({ timeout: 120_000 });
  page.on('pageerror', (error) => report.pageErrors.push(String(error).slice(0, 300)));
  page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 300)); });
  await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 120_000 });
  const info = await app.evaluate(({ app: electronApp }) => ({ packaged: electronApp.isPackaged, version: electronApp.getVersion(), userData: electronApp.getPath('userData'), pid: process.pid }));
  if (info.userData !== userData) throw new Error(`userData 未隔离：${info.userData}`);
  step('packaged app launched with a Finder-like PATH', { ms: Date.now() - started, ...info });
  const call = (command, payload = {}) => page.evaluate(({ command, payload }) => window.openbuddy.invoke(command, payload), { command, payload });
  const rss = async (label) => {
    const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(info.pid)], { encoding: 'utf8' }).trim());
    report.rss.push({ label, mb: Math.round(kb / 1024) });
  };
  await rss('launched');

  if (scenario === 'fresh') {
    await freshMachine(call, info, rss);
    throw Object.assign(new Error('done'), { done: true });
  }
  // 3) 首次启动的默认应用：后台从 Git 装 UpUp，最多等 8 分钟。
  const installStarted = Date.now();
  let apps = [];
  while (Date.now() - installStarted < 8 * 60_000) {
    apps = await call('apps_list', {});
    if (apps.some((entry) => entry.id === 'upup')) break;
    // 默认安装失败会写进主进程日志：立刻失败，不干等。
    const logDir = join(userData, 'logs');
    const failed = existsSync(logDir) && readdirSync(logDir).some((name) => /default-app-failed|"installed":false/.test(readFileSync(join(logDir, name), 'utf8')));
    if (failed) break;
    await page.waitForTimeout(3000);
  }
  const upup = apps.find((entry) => entry.id === 'upup');
  if (!upup) {
    const log = (() => { try { return readdirSync(join(userData, 'logs')).flatMap((name) => readFileSync(join(userData, 'logs', name), 'utf8').split('\n')).filter((line) => /default-app/.test(line)).slice(-3); } catch { return []; } })();
    throw new Error(`默认应用 UpUp 没有装上：${JSON.stringify(log)}`);
  }
  step('default UpUp app installed from Git inside the packaged app', { ms: Date.now() - installStarted, packageSource: upup.packageSource, version: upup.version, scenes: upup.sceneList?.length ?? 0 });
  await rss('upup installed');

  // 4) 真实模型：magpie 本机网关（免 Key）。
  await call('providers_save_provider', { provider: { id: 'magpie', providerKind: 'magpie', label: 'magpie', baseUrl: magpieUrl, apiBackend: 'chat_completions', authScheme: 'bearer' } });
  const models = await call('providers_fetch_models', { providerId: 'magpie' });
  const chosen = models.find((m) => /minimax-m3\.1-flash$/i.test(m.id)) ?? models.find((m) => !m.id.startsWith('auto/')) ?? models[0];
  await call('providers_save_model', { model: { modelId: chosen.id, providerId: 'magpie', displayName: chosen.id } });
  await call('agents_defaults_save', { defaults: { defaultModel: chosen.id, defaultProviderId: 'magpie', defaultPermission: 'always-approve' } });
  await call('apps_set_current', { appId: 'upup' });
  step('real model configured', { modelId: chosen.id });

  // 5) 界面多轮：每轮新任务 → 输入框发问 → 等这一轮结束（发送按钮恢复）→ 第一轮要求出行情卡。
  await page.reload();
  await page.locator('.wb-composer__input').waitFor({ state: 'visible', timeout: 60_000 });
  const questions = [
    '用 upup_market_data_quote 查一下贵州茅台（symbol=600519，market=cn）的最新行情，一句话告诉我价格和截至时间。',
    '再用 upup_market_data_quote 查一下宁德时代（symbol=300750，market=cn），一句话说价格。',
    '简单总结一下这两只股票今天的价格对比，不需要再调用工具。',
  ];
  for (let round = 0; round < rounds; round += 1) {
    const text = questions[round % questions.length];
    const roundStarted = Date.now();
    await page.locator('.wb-composer__input').fill(text);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const trust = page.getByRole('button', { name: '信任', exact: true });
    if (await trust.isVisible({ timeout: 3000 }).catch(() => false)) await trust.click();
    // 一轮结束 = 「停止」按钮消失且出现助手回复。
    await page.getByRole('button', { name: /停止/ }).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    await page.getByRole('button', { name: /停止/ }).first().waitFor({ state: 'hidden', timeout: 240_000 });
    const cards = await page.locator('article.finance-card').count();
    if (round === 0) {
      const card = page.locator('article.finance-card').first();
      await card.waitFor({ timeout: 30_000 });
      const cardText = await card.innerText();
      if (!/截至/.test(cardText) || !/不构成投资建议/.test(cardText)) throw new Error(`数据卡缺来源/免责声明：${cardText}`);
      await page.screenshot({ path: 'release/packaged-finance-card.png' });
      step(`round ${round + 1}: real model + UpUp quote rendered a finance card`, { ms: Date.now() - roundStarted, card: cardText.split('\n').slice(0, 6) });
    } else {
      step(`round ${round + 1}: turn finished`, { ms: Date.now() - roundStarted, cards });
    }
    await rss(`round ${round + 1}`);
  }
  await page.screenshot({ path: 'release/packaged-final.png' });

  // 6) 主进程日志里的错误。
  const logDir = join(userData, 'logs');
  const logLines = existsSync(logDir) ? readdirSync(logDir).flatMap((name) => readFileSync(join(logDir, name), 'utf8').split('\n')) : [];
  report.mainLogErrors = logLines.filter((line) => /"level":"error"|\[error\]/i.test(line)).slice(-10);
  step('finished', { pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length, mainLogErrors: report.mainLogErrors.length });
  report.ok = true;
} catch (error) {
  if (error?.done) {
    report.ok = true;
  } else {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.error('PACKAGED_FAIL', report.error);
  await page?.screenshot({ path: 'release/packaged-failed.png' }).catch(() => {});
  }
} finally {
  clearTimeout(watchdog);
  save();
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
  try { app?.process().kill('SIGKILL'); } catch { /* 已退出 */ }
  try { execFileSync('hdiutil', ['detach', mount, '-quiet', '-force'], { stdio: 'ignore' }); } catch { /* 已卸载 */ }
  if (report.ok) rmSync(work, { recursive: true, force: true });
  else console.log('PACKAGED_WORKDIR', work);
  console.log(report.ok ? 'PACKAGED_PASS' : 'PACKAGED_FAILED', JSON.stringify({ steps: report.steps.length, rss: report.rss }));
  process.exit(report.ok ? 0 : 1);
}
