/**
 * Permission / question / folder-trust requests (20261117-mobile.md 阶段 B).
 *
 * The desktop has three distinct request families — a tool permission, an
 * extension UI question, and "do you trust this folder?" — and all three can
 * stop a turn. The phone folds them into one card type so a pending decision is
 * never invisible just because it is not the permission flavour.
 *
 * Payload shapes come from the engine:
 *   agent://permission      PermissionRequest (options with optionId/kind/title)
 *   agent://ui-request      QuestionRequest (kind select/confirm/input/editor)
 *   agent://folder-trust    { cwd }
 */

import type { Approval } from './models'

export type ApprovalAction =
  | { type: 'permission'; approved: boolean }
  | { type: 'question'; value?: string | boolean; cancelled?: boolean }
  | { type: 'trust'; trusted: boolean }

export type PermissionOption = { optionId: string; kind: string; title: string }

export type QuestionRequest = {
  requestId: string
  sessionId: string
  kind: 'select' | 'confirm' | 'input' | 'editor'
  title: string
  options?: string[]
  message?: string
  placeholder?: string
  initialValue?: string
  secret?: boolean
  expiresAt?: number
}

/** The option the desktop would send for allow/deny, falling back to the kind name. */
export function permissionOptionId(approval: Pick<Approval, 'permissionOptions'>, approved: boolean): string {
  const wanted = approved ? 'allow' : 'deny'
  return approval.permissionOptions?.find(option => option.kind === wanted)?.optionId ?? wanted
}

export function questionApproval(request: QuestionRequest, receivedAt = Date.now()): Approval {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    kind: 'question',
    title: request.title,
    detail: request.message,
    questionKind: request.kind,
    options: request.options,
    placeholder: request.placeholder,
    initialValue: request.initialValue,
    secret: request.secret,
    expiresAt: request.expiresAt,
    receivedAt,
  }
}

export const trustRequestId = (cwd: string): string => `trust:${cwd}`

/**
 * `sessionId` is optional at the protocol level (`agent://folder-trust` only
 * carries a cwd), but the card must be dismissible and must not follow the user
 * into unrelated conversations — so the caller attaches the session when it
 * knows one.
 */
export function trustApproval(cwd: string, receivedAt = Date.now(), sessionId?: string): Approval {
  return {
    requestId: trustRequestId(cwd),
    kind: 'trust',
    title: '信任这个文件夹？',
    detail: `${cwd}\n信任后，电脑会在这个目录里执行工具；可以随时在桌面撤回。`,
    cwd,
    ...(sessionId ? { sessionId } : {}),
    receivedAt,
  }
}

/**
 * Decisions that actually end a card. 「不信任」 answers the desktop but leaves
 * the card up forever, and every later turn carries it — so a value the desktop
 * has already recorded also dismisses it here.
 */
export function shouldDismissAfterAnswer(kind: Approval['kind'], action: { type: string; trusted?: boolean }): boolean {
  if (kind === 'trust') return true
  return action.type === 'permission' || action.type === 'question'
}

/** What the card shows under a permission title, from the tool's raw input. */
export function permissionDetail(rawInput: unknown): string | undefined {
  if (rawInput == null) return undefined
  if (typeof rawInput === 'string') {
    return rawInput.length > 300 ? `${rawInput.slice(0, 300)}…` : rawInput
  }
  if (typeof rawInput !== 'object') {
    const rendered = String(rawInput)
    return rendered.length > 300 ? `${rendered.slice(0, 300)}…` : rendered
  }
  const record = rawInput as Record<string, unknown>
  const pick = ['command', 'path', 'paths', 'url', 'query'].map(key => record[key]).find(value => value !== undefined)
  const text = pick !== undefined ? pick : record
  const rendered = typeof text === 'string'
    ? text
    : Array.isArray(text) ? text.filter(item => typeof item === 'string').join('\n') : JSON.stringify(text)
  return rendered.length > 300 ? `${rendered.slice(0, 300)}…` : rendered
}

export type PermissionMode = 'ask' | 'auto' | 'always-approve'

export function parsePermissionMode(raw: unknown): PermissionMode | null {
  return raw === 'ask' || raw === 'auto' || raw === 'always-approve' ? raw : null
}

export function permissionModeLabel(mode: PermissionMode | null): string {
  switch (mode) {
    case 'ask': return '每次询问'
    case 'auto': return '自动（受限）'
    case 'always-approve': return '完全访问'
    default: return '桌面未提供'
  }
}
