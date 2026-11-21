import { chromium } from 'playwright-core'
const BASE = 'http://127.0.0.1:8078'
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
for (const scheme of ['light','dark']) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:scheme })
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0,200)))
  const shots = [['sessions','/'],['chat','/chat/sess-refactor'],['panel','/session/sess-refactor'],['files','/files'],['automations','/automations'],['notifications','/notifications'],['me','/me'],['pair','/pair'],['search','/search']]
  for (const [name, path] of shots) {
    await p.goto(`${BASE}${path}`, { waitUntil:'networkidle' })
    await p.waitForTimeout(1200)
    await p.screenshot({ path: `docs/plan/assets/mobile-${name}${scheme==='dark'?'-dark':''}.png` })
  }
  await p.goto(`${BASE}/chat/sess-refactor`, { waitUntil:'networkidle' })
  await p.waitForTimeout(1200)
  await p.evaluate(() => { const n=[...document.querySelectorAll('div')].find(x=>x.scrollHeight>x.clientHeight+40&&x.clientHeight>300); if(n) n.scrollTop=n.scrollHeight })
  await p.waitForTimeout(600)
  await p.screenshot({ path: `docs/plan/assets/mobile-chat-top${scheme==='dark'?'-dark':''}.png` })
  await ctx.close()
}
await b.close()
console.log('ok')
