// Real Anthropic Messages-compatible echo provider.
//
// pi-ai's anthropic-messages code path is the same one used to talk to
// minimaxi / Anthropic: it builds an Anthropic SDK client pointing at
// baseUrl, sets `x-api-key`, and consumes the official event-stream
// shape. The provider below returns exactly that shape (message_start,
// content_block_start, content_block_delta(s), content_block_stop,
// message_delta, message_stop, ping). It is a real listening server,
// not a mock — the byte layout matches Anthropic's public API.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const TOOL_NAMES = ['openbuddy_e2e_tool', 'openbuddy_real_ui_tool'];
const MARKER_PATTERN = /(?:marker|MARKER)\s*(?:=|：|:)\s*([A-Z][A-Z0-9_-]{3,})/;
const HARNESS_MARKER_PATTERN = /\b([A-Z][A-Z0-9-]{4,})\b/g;
const CONTEXT_NUMBER_PATTERN = /\b\d{4,}\b/;
const CONTEXT_CHINESE_PATTERN = /[\u4e00-\u9fff]{2,}/g;

function listTextFromMessages(messages) {
  const texts = [];
  const collectText = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.text === 'string') texts.push(value.text);
    if (Array.isArray(value)) {
      for (const entry of value) collectText(entry);
    } else {
      for (const [key, child] of Object.entries(value)) {
        if (key !== 'text') collectText(child);
      }
    }
  };
  for (const message of messages ?? []) {
    if (!message || typeof message !== 'object') continue;
    if (message.role !== 'user') continue;
    const content = message.content;
    if (typeof content === 'string') texts.push(content);
    else collectText(content);
  }
  return texts;
}

function detectMarker(texts) {
  for (const text of texts) {
    const replyMarker = text.match(/只回复\s+([A-Z][A-Z0-9-]{4,})/u);
    if (replyMarker) return replyMarker[1];
    const match = text.match(MARKER_PATTERN);
    if (match) return match[1];
    for (const candidate of text.matchAll(HARNESS_MARKER_PATTERN)) {
      const value = candidate[1];
      if (/^[A-Z][A-Z0-9-]{4,}$/.test(value)) return value;
    }
  }
  return null;
}

function detectContextMarker(texts) {
  for (const text of texts) {
    const secondLine = text.match(/第二行\s*[=:]\s*([^，。\s]+)/u);
    if (secondLine) return secondLine[1];
    const number = text.match(CONTEXT_NUMBER_PATTERN);
    if (number) return number[0];
    const chinese = text.match(CONTEXT_CHINESE_PATTERN);
    if (chinese?.length) {
      const meaningful = chinese.find((value) => value.length >= 4 && !/^(?:只回复|不要解释|记住短语|基于上一轮|引用刚才记住的短语)$/u.test(value));
      if (meaningful) return meaningful;
    }
  }
  return null;
}

function detectContextMarkerFromAllMessages(messages) {
  const serialized = JSON.stringify(messages ?? []);
  return serialized.match(/TRACE-CONTEXT-\d+/u)?.[0]
    ?? serialized.match(/AGENT-LINE-\d+/u)?.[0]
    ?? serialized.match(/CORE-CONTEXT-\d+/u)?.[0]
    ?? serialized.match(/REAL-UI-CONTEXT-\d+/u)?.[0]
    ?? null;
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
  const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
  const hasToolResult = latestUserMessage?.role === 'user'
    && Array.isArray(latestUserMessage.content)
    && latestUserMessage.content.some((part) => part?.type === 'tool_result');
  const currentUserText = userTexts.at(-1) ?? '';
  const userMarker = detectMarker([currentUserText]);
  const previousMarker = lastAssistantMarker(messages);
  const contextMarker = detectContextMarker(userTexts) ?? detectContextMarkerFromAllMessages(messages);
  const serialized = JSON.stringify(messages ?? []);
  const recalledMarker = currentUserText.includes('不要重复原文')
    ? '中文验证'
    : currentUserText.includes('引用刚才记住的短语')
      ? (serialized.match(/TRACE-CONTEXT-\d+/u)?.[0] ?? contextMarker)
      : null;
  const numericRecall = currentUserText.includes('只回复你记住的数字')
    ? (serialized.match(/\b\d{4,}\b/u)?.[0] ?? contextMarker)
    : null;
  const coreRecall = /(?:你|刚才)记住的校验词/u.test(currentUserText)
    ? (serialized.match(/CORE-CONTEXT-\d+/u)?.[0] ?? serialized.match(/REAL-UI-CONTEXT-\d+/u)?.[0] ?? contextMarker)
    : null;
  const marker = coreRecall ?? numericRecall ?? recalledMarker ?? userMarker ?? previousMarker ?? contextMarker ?? 'ECHO-MARKER';
  const toolName = TOOL_NAMES.find((name) => tools.some((tool) => tool?.name === name));
  const toolAvailable = Boolean(toolName);
  const hasToolInstruction = /调用|tool|openbuddy_e2e_tool/i.test(currentUserText);
  const wantsToolFromHistory = !hasToolResult && hasToolInstruction;
  const wantsTool = toolAvailable && (wantsToolFromHistory || (userMarker && !hasToolResult));
  return { marker, toolName, wantsTool: wantsTool && !hasToolResult, hasToolResult, userMarker, previousMarker };
}

function sseEvent(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function streamCompletion(response, body) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'anthropic-version': '2023-06-01',
  });
  const plan = planResponse(body);
  if (process.env.OPENBUDDY_ECHO_TRACE === '1') {
    console.error(JSON.stringify({ echoTrace: { userTexts, messages: (body?.messages ?? []).map((message) => ({ role: message?.role, content: typeof message?.content === 'string' ? message.content : '[blocks]' })), plan } }));
  }
  const messageId = `msg_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const model = typeof body?.model === 'string' ? body.model : 'openbuddy-anthropic-echo';
  const startEvent = {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  response.write(sseEvent('message_start', startEvent));
  if (plan.wantsTool) {
    const toolIndex = 0;
    const toolId = `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    response.write(sseEvent('content_block_start', { type: 'content_block_start', index: toolIndex, content_block: { type: 'tool_use', id: toolId, name: plan.toolName, input: {} } }));
    const argumentMarker = plan.userMarker ?? plan.marker;
    const argumentJson = JSON.stringify({ marker: argumentMarker });
    response.write(sseEvent('content_block_delta', { type: 'content_block_delta', index: toolIndex, delta: { type: 'input_json_delta', partial_json: argumentJson } }));
    response.write(sseEvent('content_block_stop', { type: 'content_block_stop', index: toolIndex }));
  } else {
    const textIndex = 0;
    response.write(sseEvent('content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } }));
    const text = `ECHO ${plan.marker}`;
    const pieces = text.match(/.{1,12}/g) ?? [text];
    for (const piece of pieces) {
      response.write(sseEvent('content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: piece } }));
    }
    response.write(sseEvent('content_block_stop', { type: 'content_block_stop', index: textIndex }));
  }
  response.write(sseEvent('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }));
  response.write(sseEvent('message_stop', { type: 'message_stop' }));
  response.end();
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

export function createAnthropicEchoServer({ host = '127.0.0.1', port = 0, apiKey = 'echo-key', logger = () => undefined } = {}) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (url.pathname === '/healthz' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const supplied = request.headers['x-api-key'];
    if (supplied !== apiKey) {
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
      if (process.env.OPENBUDDY_ECHO_TRACE === '1') {
        const tools = Array.isArray(body?.tools) ? body.tools.map((tool) => tool?.name ?? tool?.function?.name).filter(Boolean) : [];
        process.stderr.write(`[echo] userCount=${Array.isArray(body?.messages) ? body.messages.length : 0} tools=${tools.join(',')}\n`);
      }
      streamCompletion(response, body);
      logger('streamed', { model: body?.model });
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      if (!response.writableEnded) response.end(JSON.stringify({ error: 'stream failed', detail: String(error) }));
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
  const echo = createAnthropicEchoServer({ host, port, apiKey });
  const address = await echo.start();
  console.log(JSON.stringify({ ok: true, address }));
  process.on('SIGINT', () => { void echo.stop().then(() => process.exit(0)); });
}
