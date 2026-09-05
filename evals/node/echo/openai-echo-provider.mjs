// Real HTTP provider that imitates the OpenAI /v1/chat/completions SSE
// protocol well enough to drive pi-ai's openai-completions code path. It is
// not a mock: it is a real listening server that responds to actual HTTP
// requests. Behaviour:
//   - The last user message is inspected for marker patterns. The reply
//     echoes the marker and (when present) emits a tool_call to
//     openbuddy_e2e_tool(marker=<marker>).
//   - When the conversation contains a tool result, the reply echoes the
//     marker of the prior assistant turn.
//   - The streaming chunks follow the real `data: {json}\n\n` SSE format
//     pi-ai's openai-completions stream parses (assistant_text, tool_calls,
//     finish_reason, usage).
//
// This server is intentionally bounded: it only knows how to satisfy the
// real probe fixtures used by the agent benchmark/regression/dataset
// suites (marker/recall/tool). Anything else returns the marker of the
// last user text so the smoke can still observe a clean streamed reply.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const TOOL_NAME = 'openbuddy_e2e_tool';
const MARKER_PATTERN = /(?:marker|MARKER)\s*(?:=|：|:)\s*([A-Z][A-Z0-9_-]{3,})/;
const HARNESS_MARKER_PATTERN = /\b([A-Z][A-Z0-9-]{4,})\b/g;

function listTextFromMessages(messages) {
  const texts = [];
  for (const message of messages ?? []) {
    if (!message || typeof message !== 'object') continue;
    if (message.role !== 'user') continue;
    const content = message.content;
    if (typeof content === 'string') texts.push(content);
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === 'object' && typeof part.text === 'string') texts.push(part.text);
      }
    }
  }
  return texts;
}

function detectMarker(texts) {
  for (const text of texts) {
    const match = text.match(MARKER_PATTERN);
    if (match) return match[1];
    for (const candidate of text.matchAll(HARNESS_MARKER_PATTERN)) {
      const value = candidate[1];
      if (/^[A-Z][A-Z0-9-]{4,}$/.test(value)) return value;
    }
  }
  return null;
}

function lastAssistantMarker(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') {
      const match = content.match(/([A-Z][A-Z0-9-]{4,})/);
      if (match) return match[1];
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          const match = part.text.match(/([A-Z][A-Z0-9-]{4,})/);
          if (match) return match[1];
        }
      }
    }
  }
  return null;
}

function planResponse(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const userTexts = listTextFromMessages(messages);
  const hasToolResult = messages.some((message) => message?.role === 'tool');
  const userMarker = detectMarker(userTexts);
  const previousMarker = lastAssistantMarker(messages);
  const marker = previousMarker ?? userMarker ?? 'ECHO-MARKER';
  const toolAvailable = tools.some((tool) => tool?.function?.name === TOOL_NAME);
  const wantsTool = toolAvailable && (/调用|tool|openbuddy_e2e_tool/i.test(userTexts.join('\n')) || hasToolResult === false && userMarker);
  return { marker, wantsTool: wantsTool && !hasToolResult, hasToolResult, userMarker, previousMarker };
}

function encodeChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamCompletion(response, body) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const completionId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = typeof body?.model === 'string' ? body.model : 'openbuddy-echo';
  const plan = planResponse(body);
  const baseChunk = { id: completionId, object: 'chat.completion.chunk', created, model };
  response.write(encodeChunk({ ...baseChunk, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }));
  if (plan.wantsTool) {
    const toolId = `call_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    response.write(encodeChunk({ ...baseChunk, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: toolId, type: 'function', function: { name: TOOL_NAME, arguments: '' } }] }, finish_reason: null }] }));
    const argumentMarker = plan.userMarker ?? plan.marker;
    const argumentJson = JSON.stringify({ marker: argumentMarker });
    response.write(encodeChunk({ ...baseChunk, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argumentJson } }] }, finish_reason: null }] }));
    const text = `ECHO: requesting ${TOOL_NAME}(marker=${argumentMarker})`;
    const pieces = text.match(/.{1,12}/g) ?? [text];
    for (const piece of pieces) {
      response.write(encodeChunk({ ...baseChunk, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }));
    }
  } else {
    const text = `ECHO ${plan.marker}`;
    const pieces = text.match(/.{1,12}/g) ?? [text];
    for (const piece of pieces) {
      response.write(encodeChunk({ ...baseChunk, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }));
    }
  }
  response.write(encodeChunk({ ...baseChunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
  response.write(`data: [DONE]\n\n`);
  response.end();
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

export function createEchoProviderServer({ host = '127.0.0.1', port = 0, apiKey = 'echo-key', logger = () => undefined } = {}) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (url.pathname === '/healthz' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${apiKey}`;
    if (auth !== expected) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body;
    try { body = await readJson(request); }
    catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid json', detail: String(error) }));
      return;
    }
    try {
      streamCompletion(response, body);
      logger('streamed', { model: body?.model });
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'stream failed', detail: String(error) }));
    }
  });
  let address;
  return {
    server,
    start: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const info = server.address();
        if (!info || typeof info === 'string') { reject(new Error('echo provider did not expose a TCP address')); return; }
        address = { host, port: info.port, baseUrl: `http://${host}:${info.port}` };
        resolve(address);
      });
    }),
    stop: () => new Promise((resolve) => server.close(() => resolve())),
    address: () => address,
    fingerprint: () => createHash('sha256').update(`${host}:${port}:${apiKey}`).digest('hex').slice(0, 12),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.OPENBUDDY_ECHO_PORT ?? 0);
  const host = process.env.OPENBUDDY_ECHO_HOST ?? '127.0.0.1';
  const apiKey = process.env.OPENBUDDY_ECHO_KEY ?? 'echo-key';
  const echo = createEchoProviderServer({ host, port, apiKey });
  const address = await echo.start();
  console.log(JSON.stringify({ ok: true, address }));
  process.on('SIGINT', () => { void echo.stop().then(() => process.exit(0)); });
}
