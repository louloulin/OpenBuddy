/**
 * What this phone may do (20261115-mobile.md §4.4).
 *
 * The host is the authority: `/capabilities` names the commands it serves on
 * the mobile surface. The phone never keeps its own copy of the deny list —
 * that would drift from `packages/pi-bridge/src/scopes.ts`. It does keep the
 * wording for "this needs the desktop", so a refusal reads like a product
 * decision instead of an error.
 */

export type Capabilities = {
  platform: string
  commands: readonly string[]
  events: readonly string[]
}

export function isMobileHost(capabilities: Capabilities | null | undefined): boolean {
  return capabilities?.platform === 'mobile-host'
}

/** A command is usable only when the host advertised it. Unknown → no. */
export function canRun(capabilities: Capabilities | null | undefined, command: string): boolean {
  if (!capabilities) return false
  return capabilities.commands.includes(command)
}

/**
 * User-facing explanation for a refused command.
 *
 * Desktop-native surfaces read as a product boundary; everything else is an
 * ordinary "this desktop did not offer it", which is what an older build would
 * legitimately report.
 */
export function unavailableReason(command: string): string {
  if (/^(window_|dialog_|clipboard_|open_path|open_url|reveal_in_folder)/.test(command)) {
    return '这是桌面专属操作，请在电脑上完成。'
  }
  if (/^(write_text_file|export_text_file|artifact_save|agents_save|agents_delete)/.test(command)) {
    return '手机端不写入电脑文件，请在桌面端操作。'
  }
  if (/^mcp_/.test(command)) {
    return 'MCP 的安装与配置在桌面端完成。'
  }
  return '当前电脑没有开放这个功能，升级桌面端后再试。'
}

/** The tab bar only shows a surface whose backing command the host serves. */
export function visibleTabs(capabilities: Capabilities | null | undefined): {
  sessions: boolean
  search: boolean
  notifications: boolean
} {
  return {
    sessions: canRun(capabilities, 'agent_list_sessions'),
    search: canRun(capabilities, 'session_search'),
    notifications: canRun(capabilities, 'notification_list'),
  }
}
