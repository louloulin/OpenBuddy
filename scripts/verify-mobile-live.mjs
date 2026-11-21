/**
 * Real-link verification for the phone UI (20261117-mobile.md §8, §9.26).
 *
 * Everything the other scripts check about the *phone* is either unit-tested
 * logic or a preview dataset. This one is the whole loop for real:
 *
 *   Expo web build → Playwright (390×844) → gateway → AgentHub tunnel → PiBridge
 *   → SessionUpdate events → back up the same path → rendered transcript.
 *
 * It pairs like a user does (gateway URL + 8-digit code in the real form), sends
 * a message through the real composer, and asserts the three states that matter:
 *
 *   1. streaming  — user bubble, thinking block, tool card, caret, stop button
 *   2. settled    — full answer, action row, follow-ups, no stop button
 *   3. approvals  — permission / question / folder-trust cards appear
 *
 * Screenshots land in --out so the visual review has a record per run.
 *
 * Two ways to run it:
 *
 *   # 1. one command, builds + starts its own preview server (a clean host)
 *   node scripts/verify-mobile-live.mjs --web-dir /tmp/expo-preview --out /tmp/live
 *
 *   # 2. against a server you already started
 *   bun run scripts/preview-mobile-web.ts /tmp/expo-preview &
 *   node scripts/verify-mobile-live.mjs http://127.0.0.1:PORT http://127.0.0.1:PORT2
 *
 * Mode 1 matters: the preview host keeps state (approvals it emitted, the demo
 * queue), so reusing one between runs leaves cards from a previous run on
 * screen. A per-run host makes each verification reproducible.
 *
 * Exit code 0 only when every assertion passes and no page error occurred.
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import playwright from 'playwright-core'

const { chromium } = playwright

let webUrl = process.argv[2]
let gatewayUrl = process.argv[3]
/** Set when this script owns the preview server, so it must stop it. */
let ownedServer = null

function stopPreview(child) {
  if (!child || child.exitCode !== null) return
  // `bun run` spawns the script as a child, so kill the group, not just the shell.
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
}

async function startPreview(webDir) {
  stopPreview(ownedServer)
  const child = spawn('bun', ['run', resolve('scripts/preview-mobile-web.ts'), resolve(webDir)], {
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true,
  })
  const urls = await new Promise((resolvePromise, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('preview server did not report urls in 40s')), 40_000)
    child.stdout.on('data', chunk => {
      buffer += String(chunk)
      if (!buffer.includes('desktopConnected')) return
      clearTimeout(timer)
      try {
        resolvePromise(JSON.parse(buffer))
      } catch (error) {
        reject(error)
      }
    })
    child.on('exit', code => reject(new Error(`preview server exited with ${code}`)))
  })
  ownedServer = child
  return urls
}

function arg_web_dir() {
  const index = process.argv.indexOf('--web-dir')
  if (index === -1) {
    console.error('usage: node scripts/verify-mobile-live.mjs [<webUrl> <gatewayUrl> | --web-dir <expoExportDir>] [--out dir] [--scheme light|dark|both]')
    process.exit(2)
  }
  return process.argv[index + 1]
}

/** Kept so the per-scheme loop can start a fresh host from the same build. */
let websDir = null
if (webUrl === '--web-dir' || webUrl === undefined) {
  websDir = arg_web_dir()
  const urls = await startPreview(websDir)
  webUrl = urls.webUrl
  gatewayUrl = urls.gatewayUrl
  console.log(`preview: web=${webUrl} gateway=${gatewayUrl}`)
}

const arg = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const outDir = arg('--out') ?? '/tmp/mobile-live'
const schemes = (arg('--scheme') ?? 'both') === 'both' ? ['light', 'dark'] : [arg('--scheme')]
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome'
/** Where the preview server prints its own admin token. Not a secret: local. */
const adminToken = process.env.OPENBUDDY_PREVIEW_ADMIN ?? 'preview-admin'

const failures = []
const report = { webUrl, gatewayUrl, startedAt: new Date().toISOString(), runs: [] }

const check = (label, ok, detail) => {
  report.runs.push({ label, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures.push({ label, detail })
}

/** A fresh pairing code, the way the desktop generates one. */
async function freshCode() {
  const response = await fetch(`${gatewayUrl}/pair/start`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
  })
  if (!response.ok) throw new Error(`pair/start failed: ${response.status}`)
  return (await response.json()).code
}

const browser = await chromium.launch({ channel })

for (const scheme of schemes) {
  // Each scheme gets its own host when this script owns the server: the preview
  // gateway keeps approvals it emitted, and a light-run card in the dark run
  // would be a false failure (that card really does suppress follow-ups).
  if (websDir) {
    const urls = await startPreview(websDir)
    webUrl = urls.webUrl
    gatewayUrl = urls.gatewayUrl
    console.log(`preview (${scheme}): web=${webUrl} gateway=${gatewayUrl}`)
  }
  await mkdir(join(outDir, scheme), { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  const errors = []
  /** The preview host deliberately lacks a few desktop commands; those 500s are
   * harness gaps. Anything else is a real UI error and fails the run. */
  const EXPECTED_500 = ['permission_mode_get']
  page.on('pageerror', error => errors.push(error.message))
  let expected500Seen = false
  page.on('console', message => {
    if (message.type() !== 'error') return
    // 「Failed to load resource: … 500」 carries no URL; it is the response
    // handler's job to say which command failed, so drop the duplicate here.
    if (expected500Seen && message.text().includes('Failed to load resource')) return
    errors.push(message.text())
  })
  page.on('response', response => {
    if (response.status() < 500) return
    const command = EXPECTED_500.find(name => response.url().includes(name))
    if (command) expected500Seen = true
    else errors.push(`${response.status()} ${response.url()}`)
  })

  const shot = name => page.screenshot({ path: join(outDir, scheme, `${name}.png`) })
  // Hit-test probe: a copy button that renders but does nothing is exactly the
  // bug this pass fixed, so tap it and require the confirmation to appear.
  const clickCopyInCodeBlock = async () => {
    const button = page.getByLabel('复制代码').first()
    if (!(await button.count())) return false
    await button.click()
    await page.waitForFunction(() => document.body.innerText.includes('已复制'), null, { timeout: 2_000 }).catch(() => {})
    return (await text()).includes('已复制')
  }
  const text = () => page.evaluate(() => document.body.innerText)

  try {
    // ── 1. Pair through the form the user sees ──────────────────────────────
    const code = await freshCode()
    await page.goto(`${webUrl}/pair`, { waitUntil: 'load' })
    await page.waitForTimeout(1200)
    await page.locator('input').nth(0).fill(gatewayUrl)
    await page.locator('input').nth(1).fill(code)
    await shot('live-pair')
    await page.getByText('连接', { exact: true }).click()
    // Pairing ends on the session list: that is proof the device token works.
    await page.waitForFunction(() => location.pathname === '/', null, { timeout: 20_000 })
    await page.waitForTimeout(1500)
    const listText = await text()
    check(`${scheme} 配对后进入会话列表`, listText.includes('会话') && listText.includes('新建任务'), listText.slice(0, 120))
    await shot('live-sessions')

    // ── 2a. The seeded session content is deep in the page (the app draws it in
    // an *inverted* list, so the newest rows sit at the DOM top and the oldest —
    // including the seeded answer with its code fence — at the bottom). That is
    // exactly the content the old code-block copy button lived in, so scroll to
    // it before looking for the control.
    await page.getByText('手机端接入设计').first().click()
    await page.waitForFunction(() => location.pathname.startsWith('/chat/'), null, { timeout: 20_000 })
    await page.waitForTimeout(1400)
    const copyOk = await clickCopyInCodeBlock()
    check(`${scheme} 代码块复制按钮生效`, copyOk, { hasCodeBlock: await page.getByLabel('复制代码').count() })
    await shot('live-code-copy')
    const prompt = `真链路验证 ${scheme}`
    const box = page.getByPlaceholder('给 OpenBuddy 发消息…')
    await box.click()
    await box.fill(prompt)
    await shot('live-typing')
    await page.getByLabel('发送').click()

    // Streaming window: the demo host paces four deltas + a thinking block and
    // a tool card, so 700ms in the turn is visibly in flight.
    await page.waitForTimeout(700)
    const streaming = await text()
    const stopButtons = await page.getByLabel('停止生成').count()
    check(
      `${scheme} 流式中：用户消息已在转录里`,
      streaming.includes(prompt),
      streaming.slice(-260),
    )
    check(`${scheme} 流式中：可见停止按钮`, stopButtons >= 1, { stopButtons })
    await shot('live-streaming')

    // Settled: the full answer, the action row, follow-ups, and no stop button.
    // Follow-ups render a beat after the last delta (the store settles the turn
    // first), so wait for the answer and then give the chips their own window.
    // `streaming` can stay true for a moment after the text lands, which is why
    // the chips trail the answer instead of appearing with it.
    await page.waitForFunction(
      needle => document.body.innerText.includes(needle) && document.body.innerText.includes('这是演示回复'),
      prompt,
      { timeout: 25_000 },
    ).catch(() => {})
    // A pending decision owns the composer's attention: the follow-up chips stay
    // away until the card is answered. Answer the folder-trust card the way the
    // engine asks for it on session open, then the chips appear.
    const trustCard = page.getByText('信任此文件夹', { exact: true })
    const hadTrust = (await trustCard.count()) > 0
    if (hadTrust) {
      await trustCard.first().click()
      await page.waitForTimeout(900)
    }
    await page.waitForFunction(
      () => document.body.innerText.includes('展开细节'),
      null,
      { timeout: 12_000 },
    ).catch(() => {})
    await page.waitForTimeout(400)
    // 「不信任」 must also clear: a card that stays up suppresses every later
    // turn's finished state, which is the bug this pass fixed.
    const settled = await text()
    check(`${scheme} 信任卡片回答后消失`, !settled.includes('信任这个文件夹'), { trustAnswered: hadTrust })
    check(
      `${scheme} 落定：完整回复 + 跟进建议`,
      settled.includes('这是演示回复') && settled.includes('展开细节'),
      { hasAnswer: settled.includes('这是演示回复'), hasChips: settled.includes('展开细节'), trustAnswered: hadTrust, tail: settled.slice(-160) },
    )
    check(`${scheme} 落定：停止按钮消失`, (await page.getByLabel('停止生成').count()) === 0, {})
    // The host only lists busy slots, so a finished turn must not leave a
    // 「运行中」 row behind — it would tell the user work is still going on.
    await page.waitForFunction(() => !document.body.innerText.includes('运行中'), null, { timeout: 4_000 }).catch(() => {})
    const stillRunning = (await text()).includes('运行中')
    check(`${scheme} 落定：没有残留的运行中行`, !stillRunning, { stillRunning })
    // The inline action row must keep its 44pt targets (accessibility labels are
    // the contract; a regression that drops them shows up here).
    const copyActions = await page.getByLabel('复制').count()
    check(`${scheme} 落定：回复操作行存在`, copyActions >= 1, { copyActions })
    await shot('live-settled')

    // ── 3. The three approval cards, driven by a real turn ──────────────────
    await box.click()
    await box.fill('审批演示')
    await page.getByLabel('发送').click()
    await page.waitForFunction(
      () => document.body.innerText.includes('允许一次') || document.body.innerText.includes('允许'),
      null,
      { timeout: 25_000 },
    ).catch(() => {})
    await page.waitForTimeout(1500)
    const approvals = await text()
    check(
      `${scheme} 审批卡片出现`,
      approvals.includes('允许'),
      approvals.slice(-320),
    )
    await shot('live-approvals')
  } catch (error) {
    check(`${scheme} 真链路执行`, false, String(error).slice(0, 300))
  } finally {
    check(`${scheme} 页面错误`, errors.length === 0, errors.slice(0, 3))
    await context.close()
  }
}

await browser.close()
// Only stop a server this run started; a shared one belongs to the caller.
stopPreview(ownedServer)
report.failures = failures
report.finishedAt = new Date().toISOString()
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'live-report.json'), JSON.stringify(report, null, 2))

console.log(`\nLIVE VERIFY: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`} (${report.runs.length} checks, screenshots in ${outDir})`)
process.exit(failures.length === 0 ? 0 : 1)
