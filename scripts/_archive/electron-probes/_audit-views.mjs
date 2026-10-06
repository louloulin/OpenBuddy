import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT as ROOT, resolveE2ECredentials, scrubProviderCredentials } from "../lib/e2e-credentials.mjs";
const out="/tmp/ob-audit"; mkdirSync(out,{recursive:true});
const creds=resolveE2ECredentials({provider:"minimax"});
const userData=mkdtempSync(join(tmpdir(),"ob-v-"));
const piAgentDir=join(userData,"pi-agent"), workspace=join(userData,"workspace");
mkdirSync(piAgentDir,{recursive:true}); mkdirSync(workspace,{recursive:true});
writeFileSync(join(piAgentDir,"models.json"),JSON.stringify({providers:{}}));
writeFileSync(join(piAgentDir,"auth.json"),JSON.stringify({}));
const childEnv=scrubProviderCredentials(process.env);
Object.assign(childEnv,{ELECTRON_RENDERER_URL:"",PI_CODING_AGENT_DIR:piAgentDir,OPENBUDDY_DEBUG_UI:"0",OPENBUDDY_HARNESS_FILE:""});
const app=await electron.launch({args:[`--user-data-dir=${userData}`,ROOT],executablePath:join(ROOT,"node_modules",".bin","electron"),cwd:ROOT,timeout:60000,env:childEnv});
const page=await app.firstWindow();
await page.locator("#root").waitFor({state:"attached",timeout:60000});
await page.waitForFunction(()=>Boolean(window.api?.apiVersion===1),undefined,{timeout:30000});
await page.waitForTimeout(2500);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']",{timeout:3000}).catch(()=>{});
await page.waitForTimeout(500);
const invoke=(c,a)=>page.evaluate(({c,a})=>window.api.invoke(c,a),{c,a});
await invoke("agent:providers-save-provider",{provider:{id:"cust_anthropic",label:"p",providerKind:"custom_anthropic",apiKey:creds.apiKey,baseUrl:creds.baseUrl,apiBackend:"messages",authScheme:"x_api_key"}});
await invoke("agent:providers-save-model",{model:{providerId:"cust_anthropic",modelId:creds.modelId,name:creds.modelId,contextWindow:128000,reasoning:false}});
await invoke("agent:new-session",{cwd:workspace,modelId:`cust_anthropic/${creds.modelId}`});
const win=await app.browserWindow(page); await win.evaluate(w=>{w.setContentSize(1512,982);});
await page.waitForTimeout(1500);
await page.waitForFunction(()=>{const t=document.querySelector("textarea");return t&&!t.disabled;},undefined,{timeout:60000});
const ta=page.locator("textarea").first(); await ta.click(); await ta.fill("简短回答一下：OK"); await page.keyboard.press("Enter");
await page.waitForTimeout(10000);
const info = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const tabs = Array.from(document.querySelectorAll('[role="tab"][data-view-tab]')).map(e=>({tab:e.getAttribute('data-view-tab'),active:e.getAttribute('aria-selected')==='true',text:e.textContent?.trim()}));
  const metaChip = document.querySelector('.msg__meta-chip--model');
  const divider = document.querySelector('.timeline-divider--model');
  return {
    tabs, metaChip: metaChip?.textContent, metaTitle: metaChip?.getAttribute('title'), dividerText: divider?.textContent?.trim(),
    tabsPresent: document.querySelectorAll('.conversation-view-tabs__tab').length,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({path:`${out}/50-tabs-and-model.png`});
await app.close();
