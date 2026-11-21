/**
 * Verifies every Expo screen against a running preview build
 * (20261115-mobile.md §9.1 "UI 全量验证").
 *
 *   cd apps/mobile && EXPO_PUBLIC_UI_PREVIEW=1 CI=1 \
 *     npx expo export --platform web --output-dir /tmp/expo-preview
 *   bun run scripts/preview-mobile-web.ts /tmp/expo-preview   # or any static host
 *   node scripts/verify-mobile-ui.mjs http://127.0.0.1:8080 --out /tmp/ui-verify
 *
 * Each screen is loaded in a fresh page at 390×844, waited for its key text,
 * screenshotted, and checked for page errors. A few screens are exercised
 * (long-press menu, search submit, tab navigation) because "it rendered" is
 * not the same as "it works".
 *
 * Exit code: 0 when every screen and interaction passed.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import playwright from 'playwright-core'

const { chromium } = playwright

const baseUrl = process.argv[2]
if (!baseUrl) {
  console.error('usage: node scripts/verify-mobile-ui.mjs <webUrl> [--out dir] [--scheme light|dark|both]')
  process.exit(2)
}
const arg = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const outDir = arg('--out') ?? '/tmp/ui-verify'
const lockUrl = arg('--lock-url')
const schemes = (arg('--scheme') ?? 'both') === 'both' ? ['light', 'dark'] : [arg('--scheme')]
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome'

/** expected: every string must be present; alternatives: any one of them. */
const screens = [
  { name: 'sessions', path: '/', expected: ['会话', '新建任务', '重构网关隧道', '置顶会话', 'OpenBuddy', '临时试验', '待审批'] },
  { name: 'chat', path: '/chat/sess-refactor', expected: ['重构网关隧道', '没有缓冲', 'OpenBuddy', '允许修改这 3 个文件', 'grep'] },
  { name: 'pending', path: '/chat/sess-pending', alternatives: [['准备中', '等待模型响应']], expected: ['跑一遍 100 并发的 SSE 压测'] },
  { name: 'empty', path: '/chat/sess-empty', expected: ['OpenBuddy', '把任务发过来', '总结一下今天的改动'] },
  { name: 'me', path: '/me', expected: ['OpenBuddy', '专家 · 人格', '回复自动播报', '语速', '应用锁', '断开这台电脑'] },
  { name: 'notifications', path: '/notifications', expected: ['通知', '需要你批准', '在等你回答一个问题', '全部标为已读', '系统通知'] },
  { name: 'search', path: '/search', expected: ['搜索', '索引在电脑上'] },
  { name: 'files', path: '/files', expected: ['OpenBuddy', 'apps', 'docs', 'packages', 'README.md'] },
  { name: 'library', path: '/library', expected: ['资料库', '只读浏览', 'docs', 'packages', 'notes'] },
  { name: 'skills', path: '/skills', expected: ['技能与指令', '技能 · 3', '我的指令 · 2', 'PDF 助手', 'repo-review', '/summary'] },
  { name: 'memory', path: '/memory', expected: ['记忆', '全局记忆', 'MEMORY', 'team', 'openbuddy', '项目记忆'] },
  { name: 'memory-note', path: '/memory/MEMORY.md', expected: ['MEMORY', '内容（Markdown）', '保存', '删除'] },
  { name: 'branches', path: '/branches/sess-refactor', expected: ['分支与检查点', '2/3', '回到某条提问', '文件检查点', 'proxy.ts'] },
  { name: 'automations', path: '/automations', expected: ['每日晨报', '每周代码巡检'] },
  { name: 'panel', path: '/session/sess-refactor', expected: ['会话设置', '人格', '思考深度', '当前模型', '本轮产物', '用量', '权限', '允许 bash', '拒绝 any'] },
  { name: 'pair', path: '/pair', expected: ['连接你的电脑', '扫描二维码', '8 位配对码'] },
  { name: 'approval', path: '/approval/req-preview', expected: ['允许修改这 3 个文件', '拒绝', '允许', '稍后处理', 'proxy.ts', 'sse.test.ts'] },
  // A push that outlives its request: shows the "already handled" state.
  { name: 'approval-stale', path: '/approval/req-missing', expected: ['这次请求已经处理过了', '返回'] },
]

const failures = []
const report = { baseUrl, startedAt: new Date().toISOString(), runs: [] }

async function check(page, screen) {
  const body = await page.evaluate(() => document.body.innerText)
  const missing = (screen.expected ?? []).filter(text => !body.includes(text))
  for (const group of screen.alternatives ?? []) {
    if (!group.some(text => body.includes(text))) missing.push(`one of ${group.join(' / ')}`)
  }
  return missing
}

const browser = await chromium.launch({ channel })
try {
  for (const scheme of schemes) {
    await mkdir(join(outDir, scheme), { recursive: true })
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: scheme,
      locale: 'zh-CN',
    })

    for (const screen of screens) {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text())
      })
      try {
        await page.goto(baseUrl + screen.path, { waitUntil: 'load', timeout: 60_000 })
        // Wait for the screen's first expected string instead of a fixed delay:
        // the first page in a fresh context boots SQLite WASM and is slower.
        const first = screen.expected?.[0]
        const alternative = screen.alternatives?.[0]?.[0]
        await page.waitForFunction(
          texts => texts.some(text => document.body.innerText.includes(text)),
          [first, alternative].filter(Boolean),
          { timeout: 30_000 },
        ).catch(() => {})
        await page.waitForTimeout(350)
        const missing = await check(page, screen)
        await page.screenshot({ path: join(outDir, scheme, `${screen.name}.png`) })
        const ok = missing.length === 0 && errors.length === 0
        if (!ok) failures.push({ scheme, screen: screen.name, missing, errors })
        report.runs.push({ scheme, screen: screen.name, ok, missing, errors })
        console.log(`[${ok ? 'PASS' : 'FAIL'}] ${scheme} ${screen.name}${missing.length ? ` missing=${missing.join('|')}` : ''}${errors.length ? ` errors=${errors.slice(0, 2).join('|')}` : ''}`)
      } catch (error) {
        failures.push({ scheme, screen: screen.name, errors: [String(error)] })
        report.runs.push({ scheme, screen: screen.name, ok: false, errors: [String(error)] })
        console.log(`[FAIL] ${scheme} ${screen.name} — ${String(error).slice(0, 120)}`)
      } finally {
        await page.close()
      }
    }

    // ── Interactions ────────────────────────────────────────────────────────
    const page = await context.newPage()
    try {
      // Session long-press menu contains every management action.
      await page.goto(baseUrl + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => document.body.innerText.includes('重构网关隧道'), null, { timeout: 30_000 })
      const row = page.getByText('重构网关隧道', { exact: true }).first()
      await row.hover()
      await page.mouse.down()
      await page.waitForTimeout(600)
      await page.mouse.up()
      await page.waitForTimeout(400)
      const menu = await page.evaluate(() => document.body.innerText)
      const menuOk = ['取消置顶', '重命名', '归档', '删除', '取消'].every(text => menu.includes(text))
      await page.screenshot({ path: join(outDir, scheme, 'interaction-session-menu.png') })
      if (!menuOk) failures.push({ scheme, screen: 'interaction:session-menu', missing: ['取消置顶/重命名/归档/删除'] })
      console.log(`[${menuOk ? 'PASS' : 'FAIL'}] ${scheme} interaction:session-menu`)

      // Search submits and shows a result row.
      await page.goto(baseUrl + '/search', { waitUntil: 'load' })
      const input = page.getByPlaceholder('搜索会话内容')
      await input.click()
      await input.fill('配对')
      await input.press('Enter')
      await page.waitForTimeout(700)
      const results = await page.evaluate(() => document.body.innerText)
      const placeholderOk = await page.getByPlaceholder('搜索会话内容').count() > 0
      const countOk = results.includes('找到 1 条结果')
      const searchOk = placeholderOk && results.includes('手机端配对流程') && countOk
      await page.screenshot({ path: join(outDir, scheme, 'interaction-search.png') })
      if (!searchOk) failures.push({ scheme, screen: 'interaction:search', missing: ['手机端配对流程/找到 1 条结果'] })
      console.log(`[${searchOk ? 'PASS' : 'FAIL'}] ${scheme} interaction:search`)

      // The clear button empties the query and restores the empty state.
      let clearOk = true
      const clearButton = page.getByLabel('清空搜索')
      if (await clearButton.count() > 0) {
        await clearButton.first().click()
        await page.waitForTimeout(300)
        const cleared = await page.evaluate(() => document.body.innerText)
        clearOk = cleared.includes('搜索所有会话的正文') && !cleared.includes('手机端配对流程')
      } else {
        clearOk = false
      }
      await page.screenshot({ path: join(outDir, scheme, 'interaction-search-clear.png') })
      if (!clearOk) failures.push({ scheme, screen: 'interaction:search-clear', missing: ['清空恢复空态'] })
      console.log(`[${clearOk ? 'PASS' : 'FAIL'}] ${scheme} interaction:search-clear`)

      // Speech rate is a one-tap cycle on the Me screen (§5 Tab 5).
      await page.goto(baseUrl + '/me', { waitUntil: 'load' })
      await page.waitForFunction(() => document.body.innerText.includes('语速'), null, { timeout: 30_000 })
      await page.getByText('语速', { exact: true }).click()
      await page.waitForTimeout(350)
      const meBody = await page.evaluate(() => document.body.innerText)
      const rateOk = meBody.includes('语速') && meBody.includes('快')
      await page.screenshot({ path: join(outDir, scheme, 'interaction-speech-rate.png') })
      if (!rateOk) failures.push({ scheme, screen: 'interaction:speech-rate', missing: ['快'] })
      console.log(`[${rateOk ? 'PASS' : 'FAIL'}] ${scheme} interaction:speech-rate`)

      // A push can cold-start into an approval; "稍后处理" must reach the home
      // screen even when there is no history to go back to.
      await page.goto(baseUrl + '/approval/req-preview', { waitUntil: 'load' })
      await page.waitForFunction(() => document.body.innerText.includes('稍后处理'), null, { timeout: 30_000 })
      await page.getByText('稍后处理', { exact: true }).click()
      await page.waitForTimeout(600)
      const afterDismiss = await page.evaluate(() => document.body.innerText)
      const dismissOk = afterDismiss.includes('新建任务') || afterDismiss.includes('置顶会话')
      await page.screenshot({ path: join(outDir, scheme, 'interaction-approval-dismiss.png') })
      if (!dismissOk) failures.push({ scheme, screen: 'interaction:approval-dismiss', missing: ['会话首页'] })
      console.log(`[${dismissOk ? 'PASS' : 'FAIL'}] ${scheme} interaction:approval-dismiss`)
    } finally {
      await page.close()
    }
    // The lock screen is a separate review build (it would hide every other
    // screen), so it gets its own URL and the same treatment.
    if (lockUrl) {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await page.goto(lockUrl, { waitUntil: 'load', timeout: 60_000 })
        await page.waitForTimeout(900)
        const body = await page.evaluate(() => document.body.innerText)
        const missing = ['OpenBuddy 已锁定', '解锁', '面容或指纹'].filter(text => !body.includes(text))
        await page.screenshot({ path: join(outDir, scheme, 'lock.png') })
        const ok = missing.length === 0 && errors.length === 0
        if (!ok) failures.push({ scheme, screen: 'lock', missing, errors })
        report.runs.push({ scheme, screen: 'lock', ok, missing, errors })
        console.log(`[${ok ? 'PASS' : 'FAIL'}] ${scheme} lock${missing.length ? ` missing=${missing.join('|')}` : ''}`)
      } finally {
        await page.close()
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
}

report.failures = failures
report.finishedAt = new Date().toISOString()
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))

console.log(`\nUI VERIFY: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`} (${report.runs.length} runs, screenshots in ${outDir})`)
process.exit(failures.length === 0 ? 0 : 1)
