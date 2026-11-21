/**
 * OpenAI-compatible translations for third-party clients.
 *
 * The desktop server only speaks the Anthropic Messages protocol, so the
 * gateway speaks both: it accepts OpenAI requests, forwards them as Anthropic
 * `/v1/messages`, and translates the answer back. Everything here is pure —
 * no network, no clock, no globals — so the wire format can be tested without
 * a gateway.
 */

const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_OWNER = 'lumos'

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// ── Request: OpenAI → Anthropic ───────────────────────────────

export type AnthropicTranslation = {
  /** The Anthropic Messages request body. */
  body: Json
  /** The model name, echoed back in the OpenAI response. */
  model: string
  stream: boolean
}

/** OpenAI content parts → Anthropic content blocks (text and base64 images). */
function openaiContentToAnthropic(content: unknown): Json[] | null {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return null

  const blocks: Json[] = []
  for (const part of content) {
    if (!isObject(part)) continue
    if (part.type === 'text' && typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'image_url') {
      const url = isObject(part.image_url) ? asString(part.image_url.url) : undefined
      // Anthropic only accepts inline base64 media; a remote URL cannot be
      // translated, so the image is dropped rather than failing the request.
      const inline = url?.match(/^data:([^;,]+);base64,(.+)$/s)
      if (inline) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: inline[1]!, data: inline[2]! },
        })
      }
    }
  }
  return blocks
}

function openaiToolsToAnthropic(tools: unknown): Json[] | undefined {
  if (!Array.isArray(tools)) return undefined
  const translated: Json[] = []
  for (const tool of tools) {
    if (!isObject(tool)) continue
    // OpenAI wraps the callable in `function`; Anthropic puts it inline.
    const fn = isObject(tool.function) ? tool.function : isObject(tool) ? tool : null
    if (!fn) continue
    const name = asString(fn.name)
    if (!name) continue
    translated.push({
      name,
      ...(asString(fn.description) ? { description: fn.description } : {}),
      input_schema: isObject(fn.parameters) ? fn.parameters : { type: 'object', properties: {} },
    })
  }
  return translated.length > 0 ? translated : undefined
}

function openaiToolChoiceToAnthropic(choice: unknown): Json | undefined {
  if (typeof choice === 'string') {
    if (choice === 'auto') return { type: 'auto' }
    if (choice === 'none') return { type: 'none' }
    if (choice === 'required') return { type: 'any' }
    return undefined
  }
  if (!isObject(choice)) return undefined
  const fn = isObject(choice.function) ? choice.function : null
  const name = fn ? asString(fn.name) : undefined
  if (choice.type === 'function' && name) return { type: 'tool', name }
  if (choice.type === 'auto') return { type: 'auto' }
  if (choice.type === 'none') return { type: 'none' }
  if (choice.type === 'required') return { type: 'any' }
  return undefined
}

function stopToAnthropic(stop: unknown): string[] | undefined {
  if (typeof stop === 'string') return stop ? [stop] : undefined
  if (!Array.isArray(stop)) return undefined
  const values = stop.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  return values.length > 0 ? values : undefined
}

/**
 * Translate an OpenAI chat-completions request into an Anthropic Messages
 * request. Unsupported roles are dropped rather than rejected: a third-party
 * client sending one unknown role should still get an answer.
 */
export function toAnthropicRequest(payload: unknown): AnthropicTranslation {
  if (!isObject(payload)) throw new Error('request body must be a JSON object')
  const model = asString(payload.model)
  if (!model) throw new Error('"model" is required')

  const rawMessages = Array.isArray(payload.messages) ? payload.messages : []
  const systemParts: string[] = []
  const messages: Json[] = []
  // Consecutive tool results belong to one Anthropic user turn.
  let toolResults: Json[] = []

  const flushToolResults = (): void => {
    if (toolResults.length === 0) return
    messages.push({ role: 'user', content: toolResults })
    toolResults = []
  }

  for (const raw of rawMessages) {
    if (!isObject(raw)) continue
    const role = asString(raw.role)
    if (!role) continue

    if (role === 'system' || role === 'developer') {
      const blocks = openaiContentToAnthropic(raw.content)
      const text = blocks?.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (text) systemParts.push(text)
      continue
    }

    if (role === 'tool') {
      const toolUseId = asString(raw.tool_call_id)
      if (!toolUseId) continue
      const blocks = openaiContentToAnthropic(raw.content)
      const text = blocks?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
      toolResults.push({ type: 'tool_result', tool_use_id: toolUseId, content: text })
      continue
    }

    if (role !== 'user' && role !== 'assistant') continue
    flushToolResults()

    const blocks = openaiContentToAnthropic(raw.content) ?? []
    if (role === 'assistant' && Array.isArray(raw.tool_calls)) {
      for (const call of raw.tool_calls) {
        if (!isObject(call)) continue
        const fn = isObject(call.function) ? call.function : null
        const name = fn ? asString(fn.name) : undefined
        if (!name) continue
        let input: unknown = {}
        const args = fn ? asString(fn.arguments) : undefined
        if (args) {
          try {
            input = JSON.parse(args)
          } catch {
            input = {}
          }
        }
        blocks.push({ type: 'tool_use', id: asString(call.id) ?? `toolu_${name}`, name, input })
      }
    }
    messages.push({ role, content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }] })
  }
  flushToolResults()

  const maxTokens = asNumber(payload.max_tokens) ?? asNumber(payload.max_completion_tokens)
  const stream = payload.stream === true

  const body: Json = {
    model,
    messages,
    max_tokens: maxTokens && maxTokens > 0 ? Math.floor(maxTokens) : DEFAULT_MAX_TOKENS,
    stream,
  }
  if (systemParts.length > 0) body.system = systemParts.join('\n\n')
  const temperature = asNumber(payload.temperature)
  if (temperature !== undefined) body.temperature = temperature
  const topP = asNumber(payload.top_p)
  if (topP !== undefined) body.top_p = topP
  const stopSequences = stopToAnthropic(payload.stop)
  if (stopSequences) body.stop_sequences = stopSequences
  const tools = openaiToolsToAnthropic(payload.tools)
  if (tools) body.tools = tools
  const toolChoice = openaiToolChoiceToAnthropic(payload.tool_choice)
  if (toolChoice) body.tool_choice = toolChoice

  return { body, model, stream }
}

// ── Response: Anthropic → OpenAI ──────────────────────────────

export function finishReasonFromAnthropic(stopReason: unknown, hasToolCalls = false): string {
  switch (stopReason) {
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    default:
      return hasToolCalls ? 'tool_calls' : 'stop'
  }
}

/** Anthropic stop reason → OpenAI finish_reason. */
export function toOpenAIFinishReason(stopReason: unknown, hasToolCalls = false): string {
  return finishReasonFromAnthropic(stopReason, hasToolCalls)
}

export type OpenAICompletion = Json

/** Translate an Anthropic Messages response into an OpenAI chat completion. */
export function anthropicResponseToOpenAI(payload: unknown, model: string, created: number): OpenAICompletion {
  const source = isObject(payload) ? payload : {}
  const blocks = Array.isArray(source.content) ? source.content : []

  const text = blocks
    .filter(block => isObject(block) && block.type === 'text')
    .map(block => String(block.text ?? ''))
    .join('')

  const toolCalls: Json[] = []
  for (const block of blocks) {
    if (!isObject(block) || block.type !== 'tool_use') continue
    toolCalls.push({
      id: asString(block.id) ?? 'call_0',
      type: 'function',
      function: {
        name: asString(block.name) ?? '',
        arguments: JSON.stringify(block.input ?? {}),
      },
    })
  }

  const usage = isObject(source.usage) ? source.usage : {}
  const promptTokens = asNumber(usage.input_tokens) ?? 0
  const completionTokens = asNumber(usage.output_tokens) ?? 0

  const message: Json = { role: 'assistant', content: text || null }
  if (toolCalls.length > 0) message.tool_calls = toolCalls

  return {
    id: `chatcmpl-${asString(source.id) ?? 'lumos'}`,
    object: 'chat.completion',
    created,
    model: asString(source.model) ?? model,
    choices: [{
      index: 0,
      message,
      finish_reason: toOpenAIFinishReason(source.stop_reason, toolCalls.length > 0),
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

// ── Model list ────────────────────────────────────────────────

/**
 * Normalize the desktop model list into the OpenAI list shape. The upstream
 * shape is not contractual, so every field is read defensively and the model
 * ids are kept verbatim — a client may pass one back as `model`.
 */
export function normalizeModelList(payload: unknown): Json {
  const entries = extractModelEntries(payload)
  const created = Math.floor(Date.now() / 1000)
  const data = entries.map(entry => ({
    id: entry.id,
    object: 'model',
    created: asNumber(entry.created) ?? created,
    owned_by: DEFAULT_OWNER,
  }))
  return { object: 'list', data }
}

function extractModelEntries(payload: unknown): Array<{ id: string; created?: number }> {
  const list = Array.isArray(payload)
    ? payload
    : isObject(payload) && Array.isArray(payload.models)
      ? payload.models
      : isObject(payload) && Array.isArray(payload.data)
        ? payload.data
        : []

  const result: Array<{ id: string; created?: number }> = []
  const seen = new Set<string>()
  for (const raw of list) {
    if (!isObject(raw)) continue
    const id = asString(raw.id) ?? asString(raw.model) ?? asString(raw.value) ?? asString(raw.name)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({ id, created: asNumber(raw.created) })
  }
  return result
}

// ── Streaming: Anthropic SSE → OpenAI SSE ─────────────────────

function sseFrame(chunk: Json): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

type StreamState = {
  id: string
  model: string
  created: number
  started: boolean
  finished: boolean
  blockIndex: number
  toolIndex: number
  usage: Json | null
}

function chunk(state: StreamState, delta: Json, finishReason: string | null, extra?: Json): string {
  const payload: Json = {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
  if (extra) Object.assign(payload, extra)
  return sseFrame(payload)
}

/** Parse one Anthropic SSE block into its event type and JSON payload. */
function parseSseBlock(block: string): { type: string; data: unknown } | null {
  let type = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      type = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim())
    }
  }
  if (dataLines.length === 0) return null
  const raw = dataLines.join('\n')
  try {
    return { type, data: JSON.parse(raw) }
  } catch {
    return { type, data: raw }
  }
}

/**
 * Translate an Anthropic SSE stream into OpenAI `chat.completion.chunk`
 * events. The upstream body is consumed incrementally — nothing is buffered
 * beyond the current SSE block — so the client sees tokens as they arrive.
 */
export function anthropicStreamToOpenAI(
  upstream: ReadableStream<Uint8Array>,
  model: string,
  created: number,
): ReadableStream<Uint8Array> {
  const state: StreamState = {
    id: `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
    model,
    created,
    started: false,
    finished: false,
    blockIndex: 0,
    toolIndex: -1,
    usage: null,
  }
  const encoder = new TextEncoder()
  let buffer = ''

  const start = (): string => {
    state.started = true
    return chunk(state, { role: 'assistant' }, null)
  }

  const handleEvent = (type: string, data: unknown): string[] => {
    const out: string[] = []
    const payload = isObject(data) ? data : {}
    if (!state.started) out.push(start())

    if (type === 'message_start') {
      const message = isObject(payload.message) ? payload.message : {}
      const upstreamId = asString(message.id)
      if (upstreamId) state.id = `chatcmpl-${upstreamId}`
      const upstreamModel = asString(message.model)
      if (upstreamModel) state.model = upstreamModel
      if (isObject(message.usage)) state.usage = message.usage
      return out
    }

    if (type === 'content_block_start') {
      const block = isObject(payload.content_block) ? payload.content_block : {}
      if (block.type === 'tool_use') {
        state.toolIndex += 1
        out.push(chunk(state, {
          tool_calls: [{
            index: state.toolIndex,
            id: asString(block.id) ?? `call_${state.toolIndex}`,
            type: 'function',
            function: { name: asString(block.name) ?? '', arguments: '' },
          }],
        }, null))
      }
      return out
    }

    if (type === 'content_block_delta') {
      const delta = isObject(payload.delta) ? payload.delta : {}
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        out.push(chunk(state, { content: delta.text }, null))
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        out.push(chunk(state, {
          tool_calls: [{
            index: Math.max(state.toolIndex, 0),
            function: { arguments: delta.partial_json },
          }],
        }, null))
      }
      return out
    }

    if (type === 'message_delta') {
      const delta = isObject(payload.delta) ? payload.delta : {}
      if (isObject(payload.usage)) state.usage = payload.usage
      const stopReason = delta.stop_reason
      const hasToolCalls = state.toolIndex >= 0
      out.push(chunk(state, {}, toOpenAIFinishReason(stopReason, hasToolCalls)))
      return out
    }

    if (type === 'message_stop') {
      state.finished = true
      out.push('data: [DONE]\n\n')
      return out
    }

    if (type === 'error') {
      const error = isObject(payload.error) ? payload.error : { message: 'upstream stream error' }
      out.push(sseFrame({
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [{ index: 0, delta: {}, finish_reason: null }],
        error,
      }))
      state.finished = true
      out.push('data: [DONE]\n\n')
      return out
    }

    return out
  }

  return upstream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunkBytes, controller) {
      buffer += new TextDecoder().decode(chunkBytes, { stream: true })
      let index = buffer.indexOf('\n\n')
      while (index !== -1) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const parsed = parseSseBlock(block)
        if (parsed) {
          for (const frame of handleEvent(parsed.type, parsed.data)) controller.enqueue(encoder.encode(frame))
        }
        index = buffer.indexOf('\n\n')
      }
    },
    flush(controller) {
      const remainder = buffer.trim()
      if (remainder) {
        const parsed = parseSseBlock(remainder)
        if (parsed) {
          for (const frame of handleEvent(parsed.type, parsed.data)) controller.enqueue(encoder.encode(frame))
        }
      }
      // A stream that ends without message_stop still owes the client a
      // terminating chunk, or the SDK waits forever.
      if (!state.started) controller.enqueue(encoder.encode(start()))
      if (!state.finished) controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    },
  }))
}
