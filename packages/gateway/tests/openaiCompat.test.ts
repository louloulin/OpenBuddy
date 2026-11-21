import { afterEach, describe, expect, test } from 'bun:test'

import { authHeader, pairDevice, startGateway, type Harness, type UpstreamHandler } from './helpers.js'

let harness: Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

const encoder = new TextEncoder()

/** An Anthropic-style SSE stream, as the desktop proxy writes it. */
function anthropicSse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
}

describe('openai-compatible endpoints', () => {
  test('normalizes the upstream model list', async () => {
    const handlers: Record<string, UpstreamHandler> = {
      '/api/models': () => Response.json({
        models: [
          { id: 'claude-opus-5', name: 'Opus 5', description: 'x', context: '1m' },
          { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: 'y', context: '200k' },
        ],
        provider: { id: 'p', name: 'P' },
      }),
    }
    harness = startGateway({}, handlers)
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const res = await fetch(`${harness.url}/v1/models`, { headers: authHeader(device.deviceToken) })
    expect(res.status).toBe(200)
    const body = await res.json() as { object: string; data: Array<Record<string, unknown>> }
    expect(body.object).toBe('list')
    expect(body.data.map(entry => entry.id)).toEqual(['claude-opus-5', 'claude-haiku-4-5'])
    expect(body.data[0]!.object).toBe('model')
    expect(body.data[0]!.owned_by).toBe('lumos')
    expect(typeof body.data[0]!.created).toBe('number')
    expect(harness.upstream.seen.at(-1)?.path).toBe('/api/models')
  })

  test('keeps the model list behind the proxy scope', async () => {
    harness = startGateway({}, { '/api/models': () => Response.json({ models: [] }) })
    const reader = await pairDevice(harness, { scopes: ['sessions:read'] })
    const denied = await fetch(`${harness.url}/v1/models`, { headers: authHeader(reader.deviceToken) })
    expect(denied.status).toBe(403)

    const allowed = await pairDevice(harness, { scopes: ['proxy'] })
    const res = await fetch(`${harness.url}/v1/models`, { headers: authHeader(allowed.deviceToken) })
    expect(res.status).toBe(200)
  })

  test('translates an openai request into an anthropic one', async () => {
    harness = startGateway({}, {
      '/proxy/v1/messages': () => Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
      }),
    })
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const res = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'developer', content: 'and kind' },
          { role: 'user', content: 'hi' },
          { role: 'weird-role', content: 'dropped' },
        ],
        max_tokens: 128,
        temperature: 0.5,
        top_p: 0.9,
        stop: 'END',
        stream: false,
      }),
    })
    expect(res.status).toBe(200)

    const forwarded = harness.upstream.seen.at(-1)!
    expect(forwarded.path).toBe('/proxy/v1/messages')
    const sent = JSON.parse(forwarded.body) as Record<string, unknown>
    expect(sent.model).toBe('claude-opus-5')
    expect(sent.system).toBe('be brief\n\nand kind')
    expect(sent.max_tokens).toBe(128)
    expect(sent.temperature).toBe(0.5)
    expect(sent.top_p).toBe(0.9)
    expect(sent.stop_sequences).toEqual(['END'])
    expect(sent.stream).toBe(false)
    const messages = sent.messages as Array<{ role: string }>
    expect(messages.map(message => message.role)).toEqual(['user'])
  })

  test('defaults max_tokens and translates the anthropic answer back', async () => {
    harness = startGateway({}, {
      '/proxy/v1/messages': () => Response.json({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'hi there' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 11, output_tokens: 5 },
      }),
    })
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const res = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-5', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)

    const forwarded = harness.upstream.seen.at(-1)!
    expect((JSON.parse(forwarded.body) as { max_tokens: number }).max_tokens).toBe(4096)

    const body = await res.json() as {
      id: string
      object: string
      model: string
      choices: Array<{ index: number; message: { role: string; content: string }; finish_reason: string }>
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }
    expect(body.object).toBe('chat.completion')
    expect(body.model).toBe('claude-opus-5')
    expect(body.choices[0]!.index).toBe(0)
    expect(body.choices[0]!.message.role).toBe('assistant')
    expect(body.choices[0]!.message.content).toBe('hi there')
    expect(body.choices[0]!.finish_reason).toBe('length')
    expect(body.usage).toEqual({ prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 })
  })

  test('streams anthropic events as openai chunks', async () => {
    harness = startGateway({}, {
      '/proxy/v1/messages': () => anthropicSse([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_3","model":"claude-opus-5","usage":{"input_tokens":3,"output_tokens":0}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"he"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"llo"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    })
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const res = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    const frames = text.split('\n\n').filter(frame => frame.startsWith('data: '))
    expect(frames.at(-1)).toBe('data: [DONE]')

    const chunks = frames.slice(0, -1).map(frame => JSON.parse(frame.slice('data: '.length)) as {
      object: string
      choices: Array<{ delta: Record<string, unknown>; finish_reason: string | null }>
    })
    expect(chunks.every(entry => entry.object === 'chat.completion.chunk')).toBe(true)
    expect(chunks[0]!.choices[0]!.delta.role).toBe('assistant')
    expect(chunks[1]!.choices[0]!.delta.content).toBe('he')
    expect(chunks[2]!.choices[0]!.delta.content).toBe('llo')
    expect(chunks.at(-1)!.choices[0]!.finish_reason).toBe('stop')
    expect(chunks.at(-1)!.choices[0]!.delta).toEqual({})
  })

  test('keeps chat completions behind the proxy scope', async () => {
    harness = startGateway({}, {
      '/proxy/v1/messages': () => Response.json({
        id: 'msg_4',
        type: 'message',
        role: 'assistant',
        model: 'x',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    })
    const reader = await pairDevice(harness, { scopes: ['sessions:read'] })
    const denied = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(reader.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'x', messages: [] }),
    })
    expect(denied.status).toBe(403)

    const allowed = await pairDevice(harness, { scopes: ['proxy'] })
    const res = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(allowed.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'x', messages: [] }),
    })
    expect(res.status).toBe(200)
  })

  test('passes an upstream error through instead of swallowing it', async () => {
    harness = startGateway({}, {
      '/proxy/v1/messages': () => Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'bad model' } },
        { status: 400 },
      ),
    })
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const res = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message).toBe('bad model')
  })

  test('rejects a request without a model', async () => {
    harness = startGateway()
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const res = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(400)
  })

  test('every error on this surface has the shape the SDKs parse', async () => {
    harness = startGateway({}, {
      '/proxy/v1/messages': () => new Response('not json at all', { status: 200 }),
    })
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const malformed = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: '{ this is not json',
    })
    expect(malformed.status).toBe(400)
    const malformedBody = await malformed.json() as {
      error: { message: string; type: string; code: string | null }
    }
    expect(malformedBody.error.message).toBe('invalid JSON body')
    expect(malformedBody.error.type).toBe('invalid_request_error')
    expect(malformedBody.error.code).toBeNull()

    const unreadable = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(unreadable.status).toBe(502)
    const unreadableBody = await unreadable.json() as {
      error: { message: string; type: string; code: string | null }
    }
    expect(unreadableBody.error.message).toBe('invalid upstream response')
    expect(unreadableBody.error.type).toBe('api_error')
    expect(unreadableBody.error.code).toBeNull()
  })

  test('an upstream error is re-shaped for the openai surface', async () => {
    harness = startGateway({}, {
      // The desktop answers in the Anthropic shape, whatever the surface the
      // caller used.
      '/proxy/v1/messages': () => Response.json(
        { type: 'error', error: { type: 'overloaded_error', message: 'upstream is busy' } },
        { status: 529 },
      ),
    })
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const res = await fetch(`${harness.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'x', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    // The status stays the upstream's, so retry logic is unchanged...
    expect(res.status).toBe(529)
    // ...but the body is the shape an OpenAI SDK parses.
    const body = await res.json() as { error: { message: string; type: string; code: string | null } }
    expect(body.error.message).toBe('upstream is busy')
    expect(body.error.type).toBe('api_error')
    expect(body.error.code).toBeNull()
  })
})
