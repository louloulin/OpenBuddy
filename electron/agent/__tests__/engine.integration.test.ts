// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createEngineHandlers } from '../../ipc/handlers/agent';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const secureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'keychain',
  encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
  decryptString: (value: Buffer) => value.toString().split('').reverse().join(''),
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'openbuddy-sdk-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const data = JSON.parse(body); requests.push(data);
    const messages = data.messages as Array<{role: string; content?: string}>;
    const prompt = messages.findLast(m => m.role === 'user')?.content ?? '';
    const toolDone = messages.some(m => m.role === 'tool');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})}\n\n`);
    chunk({role:'assistant'});
    if (String(prompt).includes('cancel')) {
      chunk({content:'Waiting'});
      return; // client abort must close this response
    }
    if (String(prompt).includes('tool') && !toolDone) {
      chunk({tool_calls:[{index:0,id:'fixture-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:join(root,'hello.txt')})}}]});
      chunk({}, 'tool_calls');
    } else {
      chunk({content:'Hello '}); chunk({content: toolDone ? 'tool complete' : 'world'}); chunk({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address() as {port:number};
  const events: Array<{name:string;payload:any}> = [];
  const engine = await createEngineHandlers({ userDataDir:root, safeStorage:secureStorage, emit:(name,payload) => events.push({name,payload}), shell:{openPath:async()=>'',openExternal:async()=>{},showItemInFolder:()=>{}} });
  cleanups.push(engine.dispose);
  const call = async (name:string, payload:Record<string,unknown>={}) => engine.handlers[name]!(payload);
  await call('providers_save_provider',{provider:{id:'fixture',providerKind:'custom',baseUrl:`http://127.0.0.1:${address.port}/v1`,apiBackend:'chat_completions',authScheme:'bearer',apiKey:'private-test-key'}});
  await call('providers_save_model',{model:{modelId:'fixture',providerId:'fixture',contextWindow:32000}});
  await call('agent_init',{cwd:root});
  const sid = await call('agent_new_session',{cwd:root,modelId:'fixture'}) as string;
  await writeFile(join(root,'hello.txt'),'real tool result');
  return {root,engine,call,sid,events,requests};
}
async function until(predicate:()=>boolean) { const end=Date.now()+10000; while (!predicate()) { if(Date.now()>end) throw Error('Timed out'); await new Promise(resolve=>setTimeout(resolve,10)); } }

describe('real Pi SDK with local OpenAI protocol fixture',()=>{
  it('streams real SDK text, restores persisted session, and never stores or returns plaintext keys',async()=>{
    const f=await fixture();
    await f.call('agent_send',{sessionId:f.sid,text:'hello'});
    const deltas=f.events.filter(e=>e.name==='agent://event'&&e.payload.event.type==='message_update');
    expect(deltas.some(e=>e.payload.event.assistantMessageEvent.type==='text_delta')).toBe(true);
    expect(f.events.some(e=>e.payload.event?.type==='agent_settled')).toBe(true);
    expect((await f.call('providers_list') as any).providers[0].apiKey).toBe('••••');
    await f.call('agent_shutdown');
    f.events.length=0;
    await f.call('agent_load_session',{sessionId:f.sid,cwd:f.root});
    expect(f.events.some(e=>e.payload.event?.message?.role==='assistant')).toBe(true);
    const files=await readdir(join(f.root,'pi'));
    expect(files).not.toContain('auth.json');
    for(const name of files.filter(n=>n.endsWith('.json'))) expect(await readFile(join(f.root,'pi',name),'utf8')).not.toContain('private-test-key');
    await expect(f.call('agent_load_session',{sessionId:'/tmp/foreign.jsonl',cwd:f.root})).rejects.toThrow();
  });
  it('executes the real read tool only after an explicit matching permission',async()=>{
    const f=await fixture(); const turn=f.call('agent_send',{sessionId:f.sid,text:'tool please'});
    await until(()=>f.events.some(e=>e.name==='agent://permission'));
    const request=f.events.find(e=>e.name==='agent://permission')!.payload;
    await f.call('agent_resolve_permission',{requestId:request.requestId,optionId:'allow'}); await turn;
    const tool=f.events.find(e=>e.payload.event?.type==='tool_execution_end');
    expect(JSON.stringify(tool)).toContain('real tool result'); expect(f.requests.length).toBe(2);
  });
  it('denies tool calls and releases pending permission on cancellation',async()=>{
    const f=await fixture(); const turn=f.call('agent_send',{sessionId:f.sid,text:'tool deny'});
    await until(()=>f.events.some(e=>e.name==='agent://permission'));
    const request=f.events.find(e=>e.name==='agent://permission')!.payload;
    await f.call('agent_resolve_permission',{requestId:request.requestId,optionId:'deny'}); await turn;
    expect(JSON.stringify(f.events.find(e=>e.payload.event?.type==='tool_execution_end'))).not.toContain('real tool result');
    f.events.length=0; const pending=f.call('agent_send',{sessionId:f.sid,text:'tool cancel'});
    await until(()=>f.events.some(e=>e.name==='agent://permission'));
    await f.call('agent_cancel',{sessionId:f.sid}); await pending;
    await expect(f.call('agent_resolve_permission',{requestId:f.events.find(e=>e.name==='agent://permission')!.payload.requestId,optionId:'allow'})).rejects.toThrow();
  });
  it('aborts an active HTTP stream through the real SDK',async()=>{
    const f=await fixture(); const turn=f.call('agent_send',{sessionId:f.sid,text:'cancel stream'});
    await until(()=>f.events.some(e=>e.payload.event?.assistantMessageEvent?.type==='text_delta'));
    await f.call('agent_cancel',{sessionId:f.sid}); await turn;
    expect(f.events.some(e=>e.payload.event?.type==='agent_settled')).toBe(true);
  });
});
