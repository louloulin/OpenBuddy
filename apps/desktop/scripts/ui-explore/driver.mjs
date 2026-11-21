// OpenBuddy UI exploration driver (adapted from apps/desktop/scripts/electron-ui-check.mjs).
// - launches real Electron 45 + dist-electron/main.js via a temp bootstrap with an isolated userData profile
// - runs a local OpenAI-compatible SSE fixture (no real keys)
// - exposes an HTTP control endpoint: POST /eval with JS body executed as async fn(ctx)
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Paths: repo is four levels up (apps/desktop/scripts/ui-explore); screenshots go to $SHOTS_DIR; the throwaway profile lives in $RUN_DIR (or the OS temp dir).
const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
const require = createRequire(join(REPO, 'package.json'));
const { _electron: electron } = require('playwright-core');
const OUT = resolve(process.env.SHOTS_DIR || join(REPO, 'docs/plan/shots-20261115/after'));
const RUN = join(resolve(process.env.RUN_DIR || join(tmpdir(), 'openbuddy-ui-explore')), 'run');
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 47123);
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT || 47124);
const main = join(REPO, 'dist-electron/main.js');

const fresh = process.env.FRESH !== '0';
if (fresh) await rm(RUN, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const profile = join(RUN, 'profile'), harness = join(RUN, 'bootstrap'), home = join(RUN, 'home');
await mkdir(profile, { recursive: true }); await mkdir(harness, { recursive: true }); await mkdir(home, { recursive: true });
// B1a: preconfigure a JS extension through the real settings file (no native dialog in E2E).
if (process.env.OPENBUDDY_E2E_EXTENSION) {
  await mkdir(join(profile, 'pi'), { recursive: true });
  await writeFile(join(profile, 'pi', 'openbuddy.json'), JSON.stringify({
    permissionMode: 'ask', rules: [], defaults: { defaultModel: '', defaultPermission: 'ask', rememberToolApprovals: false },
    skillPaths: [], disabledSkills: [], trustedFolders: [], sessions: {}, notifications: [],
    extensionPaths: [process.env.OPENBUDDY_E2E_EXTENSION], extensionsEnabled: true,
  }, null, 2));
}
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'openbuddy-ui-explore', version: '1.0.0', main: 'bootstrap.cjs' }));
// Session preload: wraps the bridge's invoke so renderer-side (preload) not_implemented rejections are logged too.
await writeFile(join(harness, 'audit-preload.cjs'), `
try {
  const electron = require('electron');
  const cb = electron.contextBridge;
  const orig = cb.exposeInMainWorld.bind(cb);
  cb.exposeInMainWorld = (key, api) => {
    if (key === 'openbuddy' && api && typeof api.invoke === 'function') {
      const inner = api.invoke;
      api = Object.freeze({ ...api, invoke: async (command, payload) => {
        try { return await inner(command, payload); }
        catch (error) { console.warn('[IPC_REJECT] ' + command + ' :: ' + String(error && error.message || error)); electron.ipcRenderer.send('audit:reject', String(command), String(error && error.message || error)); throw error; }
      } });
    }
    return orig(key, api);
  };
  console.log('[AUDIT_PRELOAD] installed');
} catch (e) { console.warn('[AUDIT_PRELOAD] failed ' + e.message); }
`);
await writeFile(join(harness, 'bootstrap.cjs'), `
const {app,ipcMain,session,safeStorage}=require('electron');
// No keyring in this headless container: Electron falls back to basic_text, which OpenBuddy (correctly) refuses.
// Test-only shim so API-key providers can be saved; set SAFESTORAGE_SHIM=0 to observe the real behaviour.
if (${JSON.stringify(process.env.SAFESTORAGE_SHIM !== '0')}) { try { safeStorage.getSelectedStorageBackend=()=>'gnome_libsecret'; safeStorage.isEncryptionAvailable=()=>true; safeStorage.encryptString=v=>Buffer.from('shim:'+v,'utf8'); safeStorage.decryptString=b=>Buffer.from(b).toString('utf8').replace(/^shim:/,''); } catch(e) { console.error('SHIM_FAIL', e.message); } }
app.setPath('userData',${JSON.stringify(profile)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
globalThis.__ipcAudit=[];
globalThis.__rendererRejects=[];
ipcMain.on('audit:reject',(_e,command,message)=>globalThis.__rendererRejects.push({command,message,at:Date.now()}));
const realHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>realHandle(channel,async(event,...args)=>{
  if(channel!=='openbuddy:invoke')return listener(event,...args);
  const record={command:String(args[0]),status:'pending',at:Date.now()};globalThis.__ipcAudit.push(record);
  try{const result=await listener(event,...args);record.status='resolved';return result;}
  catch(error){record.status='rejected';record.error=String(error&&error.message||error).slice(0,300);throw error;}
});
app.whenReady().then(()=>{ try { session.defaultSession.registerPreloadScript({type:'frame',id:'ob-audit',filePath:${JSON.stringify(join(harness, 'audit-preload.cjs'))}}); } catch(e){ console.error('AUDIT_PRELOAD_REG_FAIL', e.message); } });
import(${JSON.stringify(pathToFileURL(main).href)}).catch(e=>{console.error(e);app.exit(1)});
`);

// ---------------- fixture model provider ----------------
const fixture = { requests: [], held: [], nextStatus: [], delayMs: 60, webhooks: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ANSWER = `## 修复建议

这是一个**本地 fixture** 返回的 Markdown 答案，用于检查渲染效果。

1. 打开 \`src/App.tsx\`
2. 检查 \`useEffect\` 的依赖
3. 运行测试

\`\`\`ts
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

| 项目 | 状态 |
| --- | --- |
| 构建 | 通过 |
| 测试 | 待运行 |

> 提示：以上内容由本地测试服务器生成。`;
const APPLY_ANSWER = [
  '按你的要求整理好了会议纪要模板，点代码块右上角的「应用」即可写入文件（写入前会先给你看改动）：',
  '',
  '```md title="notes/meeting.md"',
  '# 周会纪要',
  '',
  '- 日期：2026-11-14',
  '- 参会：产品、设计、研发',
  '',
  '## 结论',
  '1. 工作台改为标签页',
  '2. 长会话首屏只渲染最近 30 段',
  '```',
  '',
  '另外，`src/app.ts` 第 3–5 行是这样调用的（只是摘录，不能直接覆盖整个文件）：',
  '',
  '```ts:3:5:src/app.ts',
  'const bench = createWorkbench();',
  'bench.open("notes/meeting.md");',
  'bench.focus();',
  '```',
].join('\n');
const LONG_CODE = Array.from({ length: 30 }, (_, i) => i === 0 ? 'export function plan(steps: string[]) {' : i === 29 ? '}' : `  console.log("step ${i}", steps[${i - 1}] ?? "-");`).join('\n');
const LONG_ANSWER = `## 重构方案

下面按 **影响面** 从小到大排列，参考 [Pi 文档](https://example.com/pi) 的约定：

- 先抽出 \`useSmoothText\`，让流式输出匀速
- 再统一卡片的圆角与按钮
- 最后补齐键盘操作

\`\`\`ts
${LONG_CODE}
\`\`\`

| 模块 | 负责人 | 状态 | 备注 |
| --- | --- | --- | --- |
| 对话流 | Buddy | 进行中 | 平滑输出已完成 |
| 卡片 | Buddy | 待开始 | 审批、错误、工具 |
| 输入框 | Buddy | 已完成 | 胶囊按钮 |

---

完成后再运行一次 \`pnpm test\`。`;
// __FILES__: an agent turn that writes several artifacts (streamed slowly so the
// "生成中 · KB" progress is visible), then edits one, then answers.
const REPORT_MD = ['# 季度销售分析报告（初稿）', '', '> 数据来源：data/sales.csv，统计口径为含税金额。', '',
  '## 一、总体结论', '', '- 本季度销售额 **1,284 万元**，环比增长 12.4%', '- 华东区贡献 41%，仍是最大市场', '- 新品线占比首次超过 20%', '',
  '## 二、分区表现', '', '| 区域 | 销售额（万元） | 环比 | 备注 |', '| --- | ---: | ---: | --- |', '| 华东 | 526 | +9.8% | 稳定 |', '| 华南 | 301 | +18.2% | 新品拉动 |', '| 华北 | 254 | +7.1% | — |', '| 西部 | 203 | +15.6% | 渠道扩张 |', '',
  '## 三、下一步', '', '1. 加大华南新品投放', '2. 西部渠道复制华南经验', '3. 每周跟踪库存周转', '',
  ...Array.from({ length: 60 }, (_, i) => `附注 ${i + 1}：本段为明细说明，用于演示较长文件写入时的进度显示与预览分块渲染，内容不影响结论。`)].join('\n') + '\n';
const INDEX_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>销售看板</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px;background:#f7f6f3;color:#1d1c1a}h1{margin:0 0 4px;font-size:26px}p{color:#6b6862}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin:24px 0}.card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.card b{display:block;font-size:24px;margin-top:6px}button{border:0;border-radius:999px;background:#1d1c1a;color:#fff;padding:9px 16px;font-size:14px;cursor:pointer}</style></head>
<body><h1>季度销售看板</h1><p>由 Buddy 生成 · 数据截至本季度末</p>
<div class="grid"><div class="card">总销售额<b>1,284 万</b></div><div class="card">环比<b>+12.4%</b></div><div class="card">新品占比<b>21%</b></div><div class="card">客单价<b>¥ 3,420</b></div></div>
<button id="b">点我计数：0</button><script>let n=0;const b=document.getElementById('b');b.onclick=()=>{b.textContent='点我计数：'+(++n)};</script></body></html>
`;
const SALES_CSV = 'month,region,amount,growth\n' + Array.from({ length: 24 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, '0')},${['华东', '华南', '华北', '西部'][i % 4]},${(100 + i * 7.5).toFixed(1)},${(i % 5) * 2.4}%`).join('\n') + '\n';
const SUMMARY_JSON = JSON.stringify({ quarter: '2026Q3', total: 12840000, currency: 'CNY', regions: [{ name: '华东', share: 0.41 }, { name: '华南', share: 0.23 }, { name: '华北', share: 0.2 }, { name: '西部', share: 0.16 }], notes: ['含税金额', '不含退款'] });
// __STRESS__ (20261115-ui U0.1): 30 tool calls, a 1MB write streamed in 400 pieces, then a ~20k-char answer with code and tables.
const STRESS_ANSWER = Array.from({ length: 12 }, (_, i) => [
  `## 第 ${i + 1} 部分：模块拆分与验证`, '',
  ...Array.from({ length: 6 }, (_, j) => `${j + 1}. 第 ${i + 1}.${j + 1} 步：读取现有实现，列出依赖关系，确认可以单独验证后再提交，避免一次改动过大导致回滚困难。`), '',
  '```ts', ...Array.from({ length: 18 }, (_, k) => `export function step${i}_${k}(input: number[]): number { return input.reduce((a, b) => a + b * ${k + 1}, ${i}); }`), '```', '',
  '| 模块 | 负责人 | 状态 | 备注 |', '| --- | --- | --- | --- |', ...Array.from({ length: 6 }, (_, r) => `| 模块 ${i}-${r} | Buddy | ${['进行中', '已完成', '待开始'][r % 3]} | 第 ${r + 1} 行说明文字 |`), '',
  '这一部分完成后再运行一次全部测试，并记录耗时，方便和基线对比。', '',
].join('\n')).join('\n');
const STRESS_BIG = 'x'.repeat(1024 * 1024);
const PLAN_STEPS = ['读取 data/sales.csv 并核对字段', '按区域汇总季度销售额', '撰写分析报告 docs/report.md', '生成看板并自查'];
async function streamToolArgs(chunk, index, id, name, args, pieces, delay) {
  chunk({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] });
  const json = JSON.stringify(args);
  const size = Math.ceil(json.length / pieces);
  for (let i = 0; i < json.length; i += size) { chunk({ tool_calls: [{ index, function: { arguments: json.slice(i, i + size) } }] }); if (delay) await sleep(delay); }
}
function chunker(res, model) {
  return (delta, finish_reason = null, extra = {}) => res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`);
}
async function streamText(chunk, text, delay) {
  const parts = text.match(/[\s\S]{1,6}/g) ?? [];
  for (const p of parts) { chunk({ content: p }); if (delay) await sleep(delay); }
}
const fixtureServer = createServer(async (req, res) => {
  // 20261116-pii W4.6: a webhook sink, so 通知渠道 测试发送 is a real POST from the host.
  if (req.method === 'POST' && req.url.startsWith('/webhook')) {
    let body = ''; for await (const part of req) body += part;
    let parsed = {}; try { parsed = JSON.parse(body || '{}'); } catch { /* keep {} */ }
    fixture.webhooks.push({ body: parsed, raw: body, at: Date.now() });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
  }
  // 20261116-pii W2.4: a minimal MCP-over-HTTP endpoint, so 测试连接 exercises a real handshake.
  if (req.method === 'POST' && req.url.startsWith('/mcp')) {
    let body = ''; for await (const part of req) body += part;
    let message; try { message = JSON.parse(body || '{}'); } catch { res.writeHead(400); res.end(); return; }
    const single = Array.isArray(message) ? message[0] : message;
    if (single.id === undefined) { res.writeHead(202); res.end(); return; }
    let result;
    if (single.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'demo-mcp', version: '1.0.0' } };
    else if (single.method === 'tools/list') result = { tools: [{ name: 'query_sales', description: '查询销售数据', inputSchema: { type: 'object', properties: {} } }, { name: 'inventory_check', description: '检查库存', inputSchema: { type: 'object', properties: {} } }] };
    else result = {};
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'demo-session' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: single.id, result }));
    return;
  }

  if (req.method === 'GET' && /\/models\/?$/.test(req.url)) { fixture.requests.push({ url: req.url, method: 'GET', auth: req.headers.authorization ? 'present' : 'none', at: Date.now() }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }, { id: 'fixture-reasoner', object: 'model' }] })); return; }
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let body = ''; for await (const b of req) body += b;
  let input; try { input = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
  const messages = input.messages ?? [];
  const last = messages.at(-1);
  const lastUser = messages.findLast(m => m.role === 'user')?.content;
  const lastUserText = typeof lastUser === 'string' ? lastUser : Array.isArray(lastUser) ? lastUser.filter(p => p.type === 'text').map(p => p.text).join('\n') : '';
  // 专家人设 (20261116-pii W2.2): the persona built-in appends "## 专家人设：<name>" to the system prompt.
  const systemContent = messages.find(m => m.role === 'system' || m.role === 'developer')?.content;
  const systemText = typeof systemContent === 'string' ? systemContent : Array.isArray(systemContent) ? systemContent.map(p => p.text ?? '').join('') : '';
  const persona = systemText.match(/## 专家人设：([^\n]+)/)?.[1]?.trim();
  // 项目说明 (20261116-pii W5.4): the engine appends "## 项目说明 · <name>\n<instructions>".
  const project = systemText.match(/## 项目说明 · ([^\n]+)/)?.[1]?.trim();
  fixture.requests.push({ url: req.url, model: input.model, lastRole: last?.role, lastUserText: lastUserText.slice(0, 200), tools: (input.tools ?? []).map(t => t.function?.name), reasoning_effort: input.reasoning_effort, persona, project, at: Date.now() });
  const forced = fixture.nextStatus.shift();
  if (forced || lastUserText.includes('__ERR429__') || lastUserText.includes('__ERR500__')) {
    const status = forced ?? (lastUserText.includes('__ERR429__') ? 429 : 500);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: status === 429 ? 'Rate limit reached for fixture model (local test server)' : 'Internal server error (local test server)', type: status === 429 ? 'rate_limit_error' : 'server_error', code: String(status) } }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = chunker(res, input.model);
  chunk({ role: 'assistant' });
  const finish = (reason = 'stop') => { chunk({}, reason, {}); res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [], usage: { prompt_tokens: 1200, completion_tokens: 180, total_tokens: 1380 } })}\n\n`); res.end('data: [DONE]\n\n'); };
  const toolsSinceUser = messages.slice(messages.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'tool').length;
  if (lastUserText.includes('__STRESS__')) {
    if (toolsSinceUser === 0) {
      await streamText(chunk, '先把目录结构看一遍。', fixture.delayMs);
      for (let i = 0; i < 30; i++) chunk({ tool_calls: [{ index: i, id: `call_ls_${i}`, type: 'function', function: { name: 'ls', arguments: JSON.stringify({ path: '.' }) } }] });
      finish('tool_calls'); return;
    }
    if (toolsSinceUser === 30) {
      await streamText(chunk, '写入一个 1MB 的数据文件。', fixture.delayMs);
      await streamToolArgs(chunk, 0, 'call_big_1', 'write', { path: 'stress/big.txt', content: STRESS_BIG }, 400, fixture.stressDelay ?? 8);
      finish('tool_calls'); return;
    }
    await streamText(chunk, STRESS_ANSWER, fixture.stressAnswerDelay ?? 4);
    finish(); return;
  }
  // __DEMO__ (marketing demo): the 首页「销售数据看板」模板 prompt routes here. It is keyed on the
  // natural Chinese prompt (not a marker), so the demo GIF shows a real task, never a test token.
  // Sequence: read the user's data (approval #1) → write the dashboard (approval #2, 「本任务允许」
  // grants write for the session) → the remaining writes flow without further prompts.
  if (lastUserText.includes('数据看板方案')) {
    if (toolsSinceUser === 0) {
      for (const t of ['用户要一个销售数据看板。', '先确认数据字段和统计口径，再决定看板结构。', '看板需要核心指标卡、趋势和区域排行。']) {
        chunk({ reasoning_content: t });
        await sleep(260);
      }
      await streamText(chunk, '我先读一下你提供的销售数据，确认字段和口径，再动手做看板。', fixture.delayMs);
      await streamToolArgs(chunk, 0, 'call_demo_read', 'read', { path: 'data/sales-raw.csv' }, 3, 60);
      finish('tool_calls'); return;
    }
    if (toolsSinceUser === 1) {
      await streamText(chunk, '数据没问题，字段齐全。我来生成看板页面和配套的分析报告。', fixture.delayMs);
      await streamToolArgs(chunk, 0, 'call_demo_w1', 'write', { path: 'site/index.html', content: INDEX_HTML }, 6, 80);
      finish('tool_calls'); return;
    }
    if (toolsSinceUser === 2) {
      await streamToolArgs(chunk, 0, 'call_demo_w2', 'write', { path: 'docs/report.md', content: REPORT_MD }, 30, 100);
      await streamToolArgs(chunk, 1, 'call_demo_w3', 'write', { path: 'data/sales.csv', content: SALES_CSV }, 3, 60);
      finish('tool_calls'); return;
    }
    await streamText(chunk, '看板和分析报告都做好了：\n\n- `site/index.html` 销售数据看板（核心指标卡 + 区域排行）\n- `docs/report.md` 季度分析报告\n- `data/sales.csv` 整理后的销售数据\n\n右侧工作台可以预览、编辑或还原这些文件。', fixture.delayMs / 3);
    finish(); return;
  }
  if (lastUserText.includes('__FILES__')) {
    if (toolsSinceUser === 0) {
      for (const t of ['用户要一份分析报告和看板。', '先写报告，再生成网页和数据文件。']) { chunk({ reasoning_content: t }); await sleep(150); }
      await streamText(chunk, '好的，我先生成报告、网页看板和整理后的数据。', fixture.delayMs);
      await streamToolArgs(chunk, 0, 'call_w_1', 'write', { path: 'docs/report.md', content: REPORT_MD }, 40, fixture.filesDelay ?? 120);
      await streamToolArgs(chunk, 1, 'call_w_2', 'write', { path: 'site/index.html', content: INDEX_HTML }, 6, 60);
      await streamToolArgs(chunk, 2, 'call_w_3', 'write', { path: 'data/sales.csv', content: SALES_CSV }, 3, 40);
      await streamToolArgs(chunk, 3, 'call_w_4', 'write', { path: 'data/summary.json', content: SUMMARY_JSON }, 2, 40);
      finish('tool_calls'); return;
    }
    if (toolsSinceUser === 4) {
      await streamText(chunk, '把报告标题从初稿改成终稿。', fixture.delayMs);
      await streamToolArgs(chunk, 0, 'call_e_1', 'edit', { path: 'docs/report.md', edits: [{ oldText: '季度销售分析报告（初稿）', newText: '季度销售分析报告（终稿）' }, { oldText: '3. 每周跟踪库存周转', newText: '3. 每周跟踪库存周转\n4. 月底复盘新品毛利' }] }, 2, 40);
      finish('tool_calls'); return;
    }
    await streamText(chunk, '已完成：\n\n- `docs/report.md` 季度分析报告（已定稿）\n- `site/index.html` 可交互的销售看板\n- `data/sales.csv`、`data/summary.json` 整理后的数据\n\n可以在右侧工作台预览、编辑或还原这些文件。', fixture.delayMs / 3);
    finish(); return;
  }
  // __EXT_DEMO__ (B1a JS 扩展试点): the model calls the example extension's demo_echo tool.
  if (lastUserText.includes('__EXT_DEMO__')) {
    if (toolsSinceUser === 0) {
      await streamText(chunk, '调用示例扩展回显。', fixture.delayMs);
      await streamToolArgs(chunk, 0, 'call_ext_1', 'demo_echo', { text: 'pi-extension-ok' }, 4, 20);
      finish('tool_calls'); return;
    }
    await streamText(chunk, '扩展回声：demo:pi-extension-ok', fixture.delayMs);
    finish(); return;
  }
  // __PLAN__ (20261116-pii W3): 想一想 records the steps with the built-in ob_todo tool; 按此计划执行
  // then works through them across tool rounds (several ob_todo calls per message) and pauses on step 3.
  const userTexts = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : '');
  if (lastUserText.includes('__PLAN__') || (lastUserText.includes('按上面的计划执行') && userTexts.some(t => t.includes('__PLAN__')))) {
    const todo = (index, id, args) => ({ index, id, type: 'function', function: { name: 'ob_todo', arguments: JSON.stringify(args) } });
    const rounds = lastUserText.includes('__PLAN__')
      ? [[todo(0, 'call_plan_add', { action: 'add', items: PLAN_STEPS })]]
      : [
        [todo(0, 'call_plan_s1', { action: 'update', id: 1, status: 'in_progress' })],
        [todo(0, 'call_plan_c1', { action: 'complete', id: 1, note: '24 行，字段齐全' }), todo(1, 'call_plan_s2', { action: 'update', id: 2, status: 'in_progress' })],
        [todo(0, 'call_plan_c2', { action: 'complete', id: 2 }), todo(1, 'call_plan_s3', { action: 'update', id: 3, status: 'in_progress', note: '待确认统计口径' })],
      ];
    const done = [0, 1, 3, 5];
    const round = done.indexOf(toolsSinceUser);
    if (round >= 0 && round < rounds.length) {
      await streamText(chunk, ['先把要做的事拆成步骤。', '开始第 1 步：读取数据。', '数据没问题，接着汇总。', '汇总完成，开始写报告。'][lastUserText.includes('__PLAN__') ? 0 : round + 1], fixture.delayMs);
      await sleep(fixture.planDelay ?? 400);
      chunk({ tool_calls: rounds[round] });
      finish('tool_calls'); return;
    }
    await streamText(chunk, lastUserText.includes('__PLAN__')
      ? '计划已记录在「任务计划」里，共 4 步：先核对数据，再按区域汇总，然后写报告，最后生成看板并自查。确认后我就开始执行。'
      : '前两步已完成：数据 24 行、字段齐全，四个区域的季度汇总也算好了。第 3 步「撰写分析报告」需要你确认统计口径（含税还是不含税）后再继续。', fixture.delayMs / 3);
    finish(); return;
  }
  // __SUBAGENT__ (20261116-pii W3.4): the parent calls ob_subagent (parallel), each child answers,
  // then the parent summarises — the transcript shows the sub-agent cards.
  if (lastUserText.includes('子任务')) {
    await streamText(chunk, `子任务完成：${lastUserText.slice(0, 24)} 已核对，结果见附件。`, fixture.delayMs / 2);
    finish(); return;
  }
  if (lastUserText.includes('__SUBAGENT__')) {
    if (toolsSinceUser === 0) {
      await streamText(chunk, '这件事可以拆成两半并行做，我派两个子代理。', fixture.delayMs);
      chunk({ tool_calls: [{ index: 0, id: 'call_sub_1', type: 'function', function: { name: 'ob_subagent', arguments: JSON.stringify({ mode: 'parallel', tasks: ['子任务 A：统计本季度各区域销售额', '子任务 B：核对库存周转是否有异常'] }) } }] });
      finish('tool_calls'); return;
    }
    await streamText(chunk, '两个子代理都回来了：A 给出四个区域的季度汇总，B 发现西部库存周转偏低。下面是它们的结论。', fixture.delayMs / 3);
    finish(); return;
  }
  // __TEAM__ (B2a): a team pipeline with per-step experts; children answer like any sub-agent.
  if (lastUserText.includes('__TEAM__')) {
    if (toolsSinceUser === 0) {
      await streamText(chunk, '按投研流程分工：先调研，再审阅。', fixture.delayMs);
      chunk({ tool_calls: [{ index: 0, id: 'call_team_1', type: 'function', function: { name: 'ob_subagent', arguments: JSON.stringify({ mode: 'chain', team: 'E2E 投研团队', steps: [{ task: '子任务 A：调研市场与竞争格局', agent: 'deep-researcher', role: '调研' }, { task: '子任务 B：审阅调研结论的风险', agent: 'code-reviewer', role: '审阅' }] }) } }] });
      finish('tool_calls'); return;
    }
    await streamText(chunk, '团队已完成：调研给出市场结论，审阅指出两项风险。', fixture.delayMs / 3);
    finish(); return;
  }
  // __OFFICE__ (B2b): ob_xlsx writes a real OOXML workbook; the tool goes through the approval gate.
  if (lastUserText.includes('__OFFICE__')) {
    if (toolsSinceUser === 0) {
      await streamText(chunk, '好的，我生成一张季度销售表。', fixture.delayMs);
      chunk({ tool_calls: [{ index: 0, id: 'call_office_1', type: 'function', function: { name: 'ob_xlsx', arguments: JSON.stringify({ path: 'reports/q3.xlsx', sheets: [{ name: '销售', columns: ['月份', '销量'], rows: [['1月', 10], ['2月', 20], ['3月', 35]] }] }) } }] });
      finish('tool_calls'); return;
    }
    await streamText(chunk, '表格已生成：`reports/q3.xlsx`，已放进右侧工作台。', fixture.delayMs / 3);
    finish(); return;
  }
  if (lastUserText.includes('__RM__')) {
    if (toolsSinceUser === 0) {
      await streamText(chunk, '清理旧的构建产物。', fixture.delayMs);
      chunk({ tool_calls: [{ index: 0, id: 'call_rm_1', type: 'function', function: { name: 'bash', arguments: '' } }] });
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"rm -rf build dist/old"}' } }] });
      finish('tool_calls'); return;
    }
    const denied = typeof last?.content === 'string' && last.content.includes('用户拒绝');
    await streamText(chunk, denied ? `收到，你拒绝了删除（${String(last.content).slice(0, 60)}）。我改为先把 build 目录移到 build.bak 备份。` : '已清理完成。', fixture.delayMs);
    finish(); return;
  }
  if (last?.role === 'tool') {
    await streamText(chunk, '命令已执行，输出为 `hi`。工具调用正常完成。', fixture.delayMs);
    finish(); return;
  }
  if (lastUserText.includes('__TOOL__')) {
    await streamText(chunk, '我先运行一个命令看看环境。', fixture.delayMs);
    chunk({ tool_calls: [{ index: 0, id: 'call_fx_1', type: 'function', function: { name: 'bash', arguments: '' } }] });
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"echo hi"}' } }] });
    finish('tool_calls'); return;
  }
  if (lastUserText.includes('__HOLD__')) {
    for (const t of ['先分析一下需求。', '用户想看流式输出。', '我会给出一个 Markdown 回答。']) { chunk({ reasoning_content: t }); await sleep(120); }
    await streamText(chunk, ANSWER.slice(0, 160), fixture.delayMs);
    await new Promise(r => fixture.held.push(r));
    await streamText(chunk, ANSWER.slice(160), 20);
    finish(); return;
  }
  if (lastUserText.includes('__BRANCH__')) {
    // 20261116-pii W1.1: every (re)generation answers differently, so ‹1/2› visibly switches the transcript.
    fixture.branchCount = (fixture.branchCount ?? 0) + 1;
    const slogans = ['让每一次对话都算数', '把想法变成可交付的成果', '少一点等待，多一点完成'];
    await streamText(chunk, `口号版本 ${fixture.branchCount}：${slogans[(fixture.branchCount - 1) % slogans.length]}`, fixture.delayMs / 3);
    finish(); return;
  }
  if (lastUserText.includes('__APPLY__')) {
    // 20261115-ui U1.7: 「应用」 only on a block that names a whole file; an excerpt keeps its line range.
    await streamText(chunk, APPLY_ANSWER, fixture.delayMs / 6);
    finish(); return;
  }
  if (lastUserText.includes('__LONG__')) {
    for (const t of ['先读一下现有结构。', '列出可以拆分的部分。', '按影响面排序。', '确认每一步都能单独验证。', '写成表格方便跟踪。']) { chunk({ reasoning_content: t }); await sleep(350); }
    await streamText(chunk, LONG_ANSWER, fixture.delayMs / 6);
    finish(); return;
  }
  if (persona) {
    await streamText(chunk, `人设已生效：${persona}\n\n我会以「${persona}」的身份处理这个任务（本地 fixture 根据系统提示词里的专家人设作答）。`, fixture.delayMs / 3);
    finish(); return;
  }
  if (lastUserText.includes('__THINK__')) {
    for (const t of ['思考第一步：理解问题。', '思考第二步：组织答案。']) { chunk({ reasoning_content: t }); await sleep(100); }
  }
  await streamText(chunk, ANSWER, fixture.delayMs / 3);
  finish();
});
await new Promise(r => fixtureServer.listen(FIXTURE_PORT, '127.0.0.1', r));
fixture.release = () => { const r = fixture.held.shift(); if (r) r(); return !!r; };

// ---------------- electron ----------------
let app, page;
const consoleLog = [], pageErrors = [];
let launchStartedAt = 0;
async function launch() {
  launchStartedAt = Date.now();
  app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', harness], env: { ...process.env, HOME: home, OPENBUDDY_SMOKE_TEST: '0', LANG: 'zh_CN.UTF-8' }, timeout: 60000 });
  app.process().stdout.on('data', d => { for (const line of String(d).split('\n')) if (line.trim()) consoleLog.push({ src: 'main-stdout', line: line.slice(0, 1000), at: Date.now() }); });
  app.process().stderr.on('data', d => { for (const line of String(d).split('\n')) if (line.trim()) consoleLog.push({ src: 'main-stderr', line: line.slice(0, 1000), at: Date.now() }); });
  page = await app.firstWindow();
  page.on('pageerror', e => pageErrors.push({ message: e.message, stack: String(e.stack).slice(0, 800), at: Date.now() }));
  page.on('console', m => consoleLog.push({ src: 'renderer', type: m.type(), line: m.text().slice(0, 1000), at: Date.now() }));
  await page.waitForLoadState('domcontentloaded');
  return { url: page.url(), profile: await app.evaluate(({ app }) => app.getPath('userData')) };
}
async function shot(name, opts = {}) {
  const f = join(OUT, name.endsWith('.png') ? name : name + '.png');
  await page.screenshot({ path: f, ...opts });
  return f;
}
async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(w, h); }, [w, h]);
  await sleep(400);
  return page.evaluate(() => [innerWidth, innerHeight]);
}
const ctx = {
  get page() { return page; }, get app() { return app; }, fixture, FIXTURE_PORT, profile, home, sleep, shot, setSize, launch,
  get launchedAt() { return launchStartedAt; },
  get repo() { return REPO; },
  consoleLog, pageErrors,
  // 20261116-pii W4.7: 文件触发 — the e2e writes the watched file to trigger the task.
  writeFile: (path, content) => writeFile(path, content, 'utf-8'),
  /** Save a base64 PNG returned by a secondary window's capturePage (pii W7). */
  savePng: async (name, base64) => { const path = join(OUT, `${name}.png`); await writeFile(path, Buffer.from(base64, 'base64')); return path; },
  mkdir: (path) => mkdir(path, { recursive: true }),
  rm: (path) => rm(path, { force: true }),
  tmpPath: (name) => join(RUN, name),
  /** O1: the structured logs the main process wrote under <userData>/logs (already redacted). */
  readLogs: async () => {
    const dir = join(profile, 'logs');
    const names = await readdir(dir).catch(() => []);
    const files = [];
    for (const name of names.filter((n) => n.endsWith('.log'))) files.push({ name, content: await readFile(join(dir, name), 'utf8').catch(() => '') });
    return files;
  },
  /** A2: read one user-data file from <userData>/pi for on-disk assertions. */
  readDataFile: (name) => readFile(join(profile, 'pi', name), 'utf8').catch(() => undefined),
  /** A3: hash an arbitrary file the host reported (installer download). */
  fileDigest: async (path) => {
    const buffer = await readFile(path).catch(() => undefined);
    return buffer ? { exists: true, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') } : { exists: false };
  },
  call: (command, payload = {}) => page.evaluate(({ command, payload }) => window.openbuddy.invoke(command, payload), { command, payload }),
  audit: () => app.evaluate(() => ({ main: globalThis.__ipcAudit, renderer: globalThis.__rendererRejects })),
};
globalThis.ctx = ctx;

const control = createServer(async (req, res) => {
  let body = ''; for await (const b of req) body += b;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('ctx', 'page', 'app', body);
    const result = await fn(ctx, page, app);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result, errors: pageErrors.map((e) => ({ message: e.message, at: e.at })) }, null, 1));
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e && e.stack || e).slice(0, 3000) }));
  }
});
await new Promise(r => control.listen(CONTROL_PORT, '127.0.0.1', r));
console.log('DRIVER_READY', JSON.stringify({ CONTROL_PORT, FIXTURE_PORT, profile }));
if (process.env.AUTOLAUNCH !== '0') console.log('LAUNCHED', JSON.stringify(await launch()));
process.on('SIGTERM', async () => { await app?.close().catch(() => {}); process.exit(0); });
