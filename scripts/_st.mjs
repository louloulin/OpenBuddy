import playwright from 'playwright-core'
const [webUrl, gw] = process.argv.slice(2)
const b = await playwright.chromium.launch({ channel:'chrome' })
const p = await (await b.newContext({ viewport:{width:390,height:844}, locale:'zh-CN' })).newPage()
await p.addInitScript(() => {
  // Expose the zustand store for the probe (dev-only hook).
  const orig = window.__OPENBUDDY_STORE__
  window.__OPENBUDDY_STORE__ = orig
})
const code = (await (await fetch(gw+'/pair/start',{method:'POST',headers:{authorization:'Bearer preview-admin','content-type':'application/json'},body:JSON.stringify({scopes:['sessions:read','sessions:write','approve']})})).json()).code
await p.goto(webUrl+'/pair',{waitUntil:'load'}); await p.waitForTimeout(1000)
await p.locator('input').nth(0).fill(gw); await p.locator('input').nth(1).fill(code)
await p.getByText('连接',{exact:true}).click()
await p.waitForFunction(()=>location.pathname==='/', null, {timeout:20000})
await p.waitForTimeout(1500)
await p.getByText('审批失败验证').first().click(); await p.waitForTimeout(1800)
const box = p.getByPlaceholder('给 OpenBuddy 发消息…')
await box.click(); await box.fill('触发审批')
await p.getByLabel('发送').click()
await p.waitForFunction(()=>document.body.innerText.includes('允许写入'), null, {timeout:20000})
// Watch what the card area shows over time, plus any dialogs.
for (const ms of [0, 100, 200, 400, 800]) {
  await p.waitForTimeout(ms)
  const t = await p.evaluate(()=>document.body.innerText)
  console.log(ms, 'card:', t.includes('允许写入'), '| 等待模型响应:', t.includes('等待模型响应'))
}
await p.getByLabel('允许一次').first().click()
for (const ms of [50, 150, 300, 600, 1200]) {
  await p.waitForTimeout(ms)
  const t = await p.evaluate(()=>document.body.innerText)
  console.log('after', ms, 'card:', t.includes('允许写入'), '| err-lines:', JSON.stringify(t.split('\n').filter(l=>/失败|过期|错误/.test(l))))
}
process.exit(0)
