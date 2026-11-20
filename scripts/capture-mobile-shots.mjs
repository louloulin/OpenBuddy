/**
 * Full-page capture for UI review (20261117-mobile.md §9.26).
 *
 * `verify-mobile-ui.mjs` screenshots the viewport at 390×844. That is the size
 * the design is judged at, but it also hides whatever sits above or below the
 * fold — two of the defects found this pass (a scrolled-away code-block copy
 * button, a transcript that never scrolled) were only visible in a full-page
 * shot. This script renders the same app at 390 wide with an unbounded height,
 * so a reviewer can see the whole screen in one image.
 *
 *   node scripts/capture-mobile-shots.mjs <webUrl> [--out dir] [--only name,name]
 *
 * Screens are reached exactly as the verifier reaches them (URL per screen), so
 * the output is a faithful, ordered portrait of every surface.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import playwright from 'playwright-core'

const { chromium } = playwright

const baseUrl = process.argv[2]
if (!baseUrl) {
  console.error('usage: node scripts/capture-mobile-shots.mjs <webUrl> [--out dir] [--only a,b] [--scheme light|dark|both]')
  process.exit(2)
}
const arg = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const outDir = arg('--out') ?? '/tmp/mobile-shots'
const schemes = (arg('--scheme') ?? 'both') === 'both' ? ['light', 'dark'] : [arg('--scheme')]
const only = arg('--only')?.split(',').map(item => item.trim()).filter(Boolean)
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome'

/** name → path + the string that proves the screen rendered. */
const SCREENS = [
  { name: 'sessions', path: '/', ready: '新建任务' },
  { name: 'chat', path: '/chat/sess-refactor', ready: 'OpenBuddy' },
  { name: 'chat-empty', path: '/chat/sess-empty', ready: '把任务发过来' },
  { name: 'me', path: '/me', ready: '已配对的电脑' },
  { name: 'notifications', path: '/notifications', ready: '全部标为已读' },
  { name: 'search', path: '/search', ready: '搜索会话内容' },
  { name: 'automations', path: '/automations', ready: '定时' },
  { name: 'panel', path: '/session/sess-refactor', ready: '思考深度' },
  { name: 'approval', path: '/approval/req-preview', ready: '允许' },
  { name: 'memory', path: '/memory', ready: '全局记忆' },
  { name: 'branches', path: '/branches/sess-refactor', ready: '文件检查点' },
  { name: 'pair', path: '/pair', ready: '8 位配对码' },
]

const screens = only ? SCREENS.filter(screen => only.includes(screen.name)) : SCREENS
const errors = []
const browser = await chromium.launch({ channel })

for (const scheme of schemes) {
  await mkdir(join(outDir, scheme), { recursive: true })
  // Height is deliberately generous: `fullPage` then crops to the real content.
  const context = await browser.newContext({
    viewport: { width: 390, height: 1400 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    locale: 'zh-CN',
  })
  for (const screen of screens) {
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(`${scheme}/${screen.name}: ${error.message}`))
    page.on('console', message => {
      const line = message.text()
      // The preview host has no `permission_mode_get` (see verify-mobile-live).
      if (message.type() === 'error' && !line.includes('Failed to load resource')) {
        errors.push(`${scheme}/${screen.name}: ${line}`)
      }
    })
    try {
      await page.goto(baseUrl + screen.path, { waitUntil: 'load', timeout: 60_000 })
      await page.waitForFunction(
        needle => document.body.innerText.includes(needle),
        screen.ready,
        { timeout: 25_000 },
      ).catch(() => {})
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(outDir, scheme, `${screen.name}.png`), fullPage: true })
      console.log(`[shot] ${scheme} ${screen.name}`)
    } catch (error) {
      errors.push(`${scheme}/${screen.name}: ${String(error).slice(0, 200)}`)
    } finally {
      await page.close()
    }
  }
  await context.close()
}

await browser.close()
await writeFile(join(outDir, 'shots-report.json'), JSON.stringify({ baseUrl, schemes, screens: screens.map(s => s.name), errors }, null, 2))
console.log(errors.length ? `\nSHOT ERRORS (${errors.length}):\n${errors.slice(0, 6).join('\n')}` : '\nSHOTS: no page errors')
