import { mkdtemp, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 应用平台真机流程 (20261126-upup UP-7.1 / 20261127-upup)：
 * 安装（本地 fixture 包，不联网）→ 应用卡 → 场景填入输入框 → 一轮对话出数据卡与推荐卡 →
 * 「不用了」收起 → 治理提醒「保留」。
 *
 * fixture 包与 UpUp 同形：`pi.app`（category=finance）+ scenes.json + 返回 UpUp 来源信封的
 * `market_data_quote`。模型由走查的本地 fixture 服务扮演（收到 `__APP_FLOW__` 时依次调
 * `ob_app_recommend` → `market_data_quote` → 回答）。
 */
export const APP_FLOW_MARKER = '__APP_FLOW__';

/** 本地 fixture 服务用：根据对话进度决定下一步工具调用；返回 null 表示按普通文本回答。 */
export function appFlowReply(input) {
  const users = input.messages.filter((message) => message.role === 'user');
  const text = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : '');
  if (!users.some((message) => text(message.content).includes(APP_FLOW_MARKER))) return null;
  const last = input.messages.at(-1);
  const names = (input.tools ?? []).map((tool) => tool.function?.name);
  if (last?.role === 'user' && names.includes('ob_app_recommend')) return { tool: 'ob_app_recommend', args: { query: '茅台股价和北向资金' } };
  if (last?.role === 'tool' && /推荐给用户|没有更合适/.test(text(last.content)) && names.includes('market_data_quote')) return { tool: 'market_data_quote', args: { symbol: '600519.SH' } };
  return { text: 'fixture app flow answered' };
}

async function financePackage() {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'openbuddy-ui-finapp-')));
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'finapp',
    version: '1.0.0',
    pi: { extensions: ['./ext.js'], app: { kind: 'app', tagline: '证券投研 fixture', category: 'finance', scenes: './scenes.json' } },
  }));
  await writeFile(join(dir, 'scenes.json'), JSON.stringify([{ id: 'quote', name: '个股速览', prompt: '看一下 600519 的行情' }]));
  await writeFile(join(dir, 'ext.js'), `export default function (pi) {
  pi.registerTool({
    name: "market_data_quote", label: "Market data quote", description: "Read a market quote.",
    parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
    async execute(toolCallId, params) {
      const value = { symbol: params.symbol, market: "CN", price: 1520.5, currency: "CNY", changePct: 1.8, peTTM: 22.35 };
      return { content: [{ type: "text", text: JSON.stringify(value) }], details: { evidence: [{ asOf: "2026-11-27", source: "eastmoney", dataFreshness: "live" }], dataFreshness: "live", asOf: "2026-11-27", provider: "eastmoney", auditId: toolCallId, source: "native-provider" } };
    },
  });
}
`);
  return dir;
}

export async function runAppFlows({ page, call, checkpoint, assert, profile }) {
  const dir = await financePackage();
  await call('agent_extensions_install_package', { source: dir });
  await call('agent_extensions_set_enabled', { enabled: true });
  const mode = await call('permission_mode_get').catch(() => null);
  await call('permission_mode_set', { mode: 'always-approve' });
  try {
    // 应用页：fixture 应用卡 + 场景 → 首页输入框。
    await page.getByRole('button', { name: /更多.*文件/ }).hover();
    await page.getByRole('menuitem', { name: '应用', exact: true }).click();
    await page.getByText('证券投研 fixture', { exact: true }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: '场景 个股速览' }).click();
    await page.locator('.wb-composer__input').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('.wb-composer__input')?.value?.includes('600519'), undefined, { timeout: 10000 });
    checkpoint('apps page lists the installed fixture app and its scene fills the home composer (UP-4.3)', {});

    // 一轮对话：推荐卡 + 数据卡。
    await page.locator('.wb-composer__input').fill(`${APP_FLOW_MARKER} 茅台股价和北向资金`);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const trust = page.getByRole('button', { name: '信任', exact: true });
    if (await trust.isVisible({ timeout: 3000 }).catch(() => false)) await trust.click();
    const card = page.getByRole('article', { name: '行情 600519.SH' });
    await card.waitFor({ timeout: 45000 });
    const rec = page.getByRole('complementary', { name: '推荐应用 finapp' });
    await rec.waitFor({ timeout: 10000 });
    const cardText = await card.innerText();
    assert.match(cardText, /eastmoney/);
    assert.match(cardText, /截至 2026-11-27/);
    assert.match(cardText, /不构成投资建议/);
    assert.equal(await card.getByText('1.80%').getAttribute('class'), 'finance-card__value--up');
    await page.screenshot({ path: 'release/ui-app-flow-cards.png' });
    checkpoint('a real turn renders the finance data card and the app recommendation card (UP-5.2 / UP-6.2)', { recommend: (await rec.innerText()).split('\n') });

    // 「不用了」：卡片收起，宿主记下。
    await rec.getByRole('button', { name: '不用了' }).click();
    await rec.waitFor({ state: 'detached', timeout: 10000 });
    const dismissed = (await call('apps_recommend_dismiss', { appId: 'finapp' })).dismissed;
    assert.ok(dismissed.includes('finapp'));
    checkpoint('dismissing the recommendation hides the card and is remembered by the host (UP-6.2)', { dismissed });

    // 治理：把最近使用日改到 30 天前 → 应用页提醒 →「保留」后消失。
    const apps = await call('apps_list', {});
    const finapp = apps.find((app) => app.id === 'finapp');
    await writeFile(join(profile, 'pi', 'app-usage.json'), JSON.stringify({ lastUsed: { [finapp.installedPath]: '2026-10-28' }, kept: {} }));
    await page.getByRole('button', { name: /更多.*文件/ }).hover();
    await page.getByRole('menuitem', { name: '应用', exact: true }).click();
    const hygiene = page.getByRole('region', { name: '长期未使用的应用' });
    await hygiene.waitFor({ timeout: 20000 });
    assert.match(await hygiene.innerText(), /finapp/);
    await page.screenshot({ path: 'release/ui-app-flow-hygiene.png' });
    await hygiene.getByRole('button', { name: '保留' }).click();
    await hygiene.waitFor({ state: 'detached', timeout: 10000 });
    checkpoint('an app idle for 14+ days shows the hygiene reminder and 保留 dismisses it (UP-6.4)', {});
  } finally {
    if (typeof mode === 'string') await call('permission_mode_set', { mode }).catch(() => {});
    await call('agent_extensions_remove_package', { source: dir }).catch(() => {});
  }
}
