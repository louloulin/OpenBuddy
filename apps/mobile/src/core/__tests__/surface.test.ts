import { describe, expect, it } from 'vitest'

import { canRun, isMobileHost, unavailableReason, visibleTabs, type Capabilities } from '../surface'

const caps: Capabilities = {
  platform: 'mobile-host',
  commands: ['agent_list_sessions', 'agent_send', 'session_search', 'notification_list'],
  events: ['agent://event'],
}

describe('capabilities gating', () => {
  it('recognises the mobile host platform', () => {
    expect(isMobileHost(caps)).toBe(true)
    expect(isMobileHost({ ...caps, platform: 'desktop' })).toBe(false)
    expect(isMobileHost(null)).toBe(false)
  })

  it('only allows commands the host advertised', () => {
    expect(canRun(caps, 'agent_send')).toBe(true)
    expect(canRun(caps, 'write_text_file')).toBe(false)
    expect(canRun(null, 'agent_send')).toBe(false)
  })

  it('shows a tab only when its backing command is served', () => {
    expect(visibleTabs(caps)).toEqual({ sessions: true, search: true, notifications: true, automations: false })
    expect(visibleTabs({ ...caps, commands: ['agent_list_sessions'] }))
      .toEqual({ sessions: true, search: false, notifications: false, automations: false })
    expect(visibleTabs(null))
      .toEqual({ sessions: false, search: false, notifications: false, automations: false })
  })

  it('shows the automations tab when the desktop serves scheduled tasks', () => {
    expect(visibleTabs({ ...caps, commands: [...caps.commands, 'automations_snapshot'] }).automations).toBe(true)
  })
})

describe('unavailableReason', () => {
  it('frames desktop-only surfaces as a product boundary', () => {
    expect(unavailableReason('window_minimize')).toContain('桌面专属')
    expect(unavailableReason('dialog_open')).toContain('桌面专属')
    expect(unavailableReason('write_text_file')).toContain('不写入电脑文件')
    expect(unavailableReason('mcp_upsert')).toContain('桌面端完成')
    expect(unavailableReason('some_future_command')).toContain('升级桌面端')
  })
})
