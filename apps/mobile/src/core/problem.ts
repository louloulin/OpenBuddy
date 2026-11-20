/**
 * Turning transport failures into something a person can act on.
 *
 * Everything below the phone speaks English: the gateway answers
 * `desktop offline`, `upstream unavailable`, `unauthorized`; the bridge answers
 * `agent_busy` and `unknown command`. Those strings used to be assigned straight
 * to `state.error`, which the banner then rendered verbatim — so a Chinese user
 * saw 「desktop offline」 in the middle of 「会话」.
 *
 * This module is the single place that decides what a failure *means*: a short
 * Chinese sentence, plus a stable kind so the UI can offer the right action
 * (reconnect vs. retry vs. nothing).
 *
 * Pure on purpose: the mapping table is testable without a network.
 */

export type ProblemKind =
  /** The desktop is not connected to the gateway. Retrying later helps. */
  | 'offline'
  /** The gateway could not reach the bridge in time. */
  | 'upstream'
  /** The device token is gone or revoked: pairing again is the only fix. */
  | 'auth'
  /** The turn is already running, so `agent_send` was refused. */
  | 'busy'
  /** No network at all on the phone, or the request never got out. */
  | 'network'
  /** Reached the network but the gateway refused this origin (CORS/mixed content). */
  | 'blocked'
  /** The desktop does not serve this command (older build). */
  | 'unsupported'
  | 'unknown'

export type Problem = {
  kind: ProblemKind
  /** One sentence, ready to render. */
  message: string
}

/** Gateway + bridge strings, matched case-insensitively as substrings. */
const RULES: Array<{ match: string[]; kind: ProblemKind; message: string }> = [
  { match: ['desktop offline', 'no desktop', 'desktop not connected'], kind: 'offline', message: '电脑不在线，检查桌面端是否开着。' },
  { match: ['upstream unavailable', 'upstream timeout', 'timed out', 'timeout'], kind: 'upstream', message: '电脑没有及时回应，稍后重试。' },
  { match: ['unauthorized', 'invalid token', 'token expired', 'forbidden'], kind: 'auth', message: '设备凭证已失效，请重新配对这台电脑。' },
  { match: ['agent_busy', 'session busy', '会话忙碌', 'busy'], kind: 'busy', message: '这一轮还在跑，消息已排队。' },
  // Chromium reports a CORS/preflight refusal as plain `Failed to fetch`, the
  // same text as a dead radio. Telling a user to check Wi-Fi when the real
  // problem is the gateway's origin allowlist sends them down the wrong path.
  { match: ['cors', 'access-control-allow-origin', 'preflight', 'mixed content', 'blocked by cors policy'], kind: 'blocked', message: '网关不允许这个来源，请用桌面端显示的地址打开，或让网关放行。' },
  { match: ['failed to fetch', 'network request failed', 'networkerror', 'load failed', 'econnrefused', 'enotfound'], kind: 'network', message: '手机连不上网络，检查 Wi-Fi 或蜂窝数据。' },
  { match: ['unknown command', 'not_supported', 'no such command', 'unsupported'], kind: 'unsupported', message: '这台电脑的版本还不支持这个操作。' },
]

/** `http_502` / `http 502` → a status the caller may want to show. */
function statusIn(text: string): number | undefined {
  const match = /http[_\s](\d{3})/i.exec(text)
  return match ? Number(match[1]) : undefined
}

export function problemFor(raw: unknown): Problem {
  const text = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : String(raw ?? '')
  const lower = text.toLowerCase()

  for (const rule of RULES) {
    if (rule.match.some(needle => lower.includes(needle))) {
      return { kind: rule.kind, message: rule.message }
    }
  }

  const status = statusIn(lower)
  if (status !== undefined) {
    if (status === 401 || status === 403) return { kind: 'auth', message: '设备凭证已失效，请重新配对这台电脑。' }
    if (status === 429) return { kind: 'upstream', message: '请求太频繁，等一会儿再试。' }
    if (status >= 500) return { kind: 'upstream', message: '电脑那边出错了，稍后重试。' }
    if (status >= 400) return { kind: 'unknown', message: `请求被拒绝（HTTP ${status}）。` }
  }

  // Already Chinese (a desktop-side message, or one of ours): keep it as-is.
  if (/[\u4e00-\u9fa5]/.test(text)) return { kind: 'unknown', message: text }

  // An English sentence with no rule: never show it raw. The kind stays
  // `unknown` so the caller can decide whether to surface anything at all.
  return { kind: 'unknown', message: '操作没有完成，稍后再试。' }
}

/** Convenience for call sites that only want the sentence. */
export function problemText(raw: unknown): string {
  return problemFor(raw).message
}
