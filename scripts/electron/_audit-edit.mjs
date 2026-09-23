import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT as ROOT, resolveE2ECredentials, scrubProviderCredentials } from "../lib/e2e-credentials.mjs";
const out="/tmp/ob-audit"; mkdirSync(out,{recursive:true});
const creds = resolveE2ECredentials({ provider: "minimax" });
const userData = mkdtempSync(join(tmpdir(),"ob-edit-"));
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
await invoke("agent:providers-save-provider",{provider:{id:"custom_anthropic",label:"probe",providerKind:"custom_anthropic",apiKey:creds.apiKey,baseUrl:creds.baseUrl,apiBackend:"messages",authScheme:"x_api_key"}});
await invoke("agent:providers-save-model",{model:{providerId:"custom_anthropic",modelId:creds.modelId,name:creds.modelId,contextWindow:128000,reasoning:false}});
await invoke("agent:new-session",{cwd:workspace,modelId:`custom_anthropic/${creds.modelId}`});
const win=await app.browserWindow(page); await win.evaluate(w=>{w.setContentSize(1512,982);});
await page.waitForTimeout(1500);
await page.waitForFunction(()=>{const t=document.querySelector("textarea");return t&&!t.disabled;},undefined,{timeout:60000});
const ta=page.locator("textarea").first(); await ta.click(); await ta.fill("第一轮测试消息"); await page.keyboard.press("Enter");
await page.waitForTimeout(9000);
// Double click user bubble text to trigger inline edit
const ub = page.locator(".msg--user .msg__bubble").first();
await ub.dblclick().catch(e=>console.log("dblclick failed", e.message));
await page.waitForTimeout(900);
const probe = await page.evaluate(()=>{
  const pick=(el,props)=>{ if(!el) return null; const cs=getComputedStyle(el); const o={}; for(const p of props) o[p]=cs.getPropertyValue(p); return o; };
  const edit=document.querySelector(".msg__edit");
  const input=document.querySelector(".msg__edit-input");
  const actions=document.querySelector(".msg__edit-actions");
  const primary=document.querySelector(".msg__action-btn--primary");
  const ed=document.querySelector(".msg__bubble--editable");
  return {
    editExists: !!edit,
    edit: pick(edit,["background-color","border-top-width","border-radius","padding-top","box-shadow","display"]),
    input: pick(input,["background-color","font-size","min-height","border-top-width"]),
    actions: pick(actions,["display","border-top-style","padding-top"]),
    primary: pick(primary,["background-color","color"]),
    editable: pick(ed,["cursor"]),
    editHTML: edit ? edit.outerHTML.slice(0,300) : null,
  };
});
console.log(JSON.stringify(probe,null,2));
await page.screenshot({path:`${out}/40-user-inline-edit.png`});
await app.close();
