import { describe, expect, it } from 'vitest'

import { canRevertTool, summarizeRevert } from '../revert'

describe('canRevertTool', () => {
  it('offers revert where files can change', () => {
    expect(canRevertTool('write_text_file')).toBe(true)
    expect(canRevertTool('edit_file')).toBe(true)
    expect(canRevertTool('apply_patch')).toBe(true)
    expect(canRevertTool('artifact_save')).toBe(true)
    expect(canRevertTool('bash')).toBe(true)
  })

  it('leaves read-only tools alone', () => {
    expect(canRevertTool('read_text_file')).toBe(false)
    expect(canRevertTool('list_dir')).toBe(false)
    expect(canRevertTool('grep')).toBe(false)
    expect(canRevertTool('web_search')).toBe(false)
  })
})

describe('summarizeRevert', () => {
  it('reports clean restores', () => {
    expect(summarizeRevert({ restored: ['/w/a.ts'], conflicts: [] })).toMatchObject({ ok: true, restored: 1, conflicts: 0 })
    expect(summarizeRevert({ restored: ['/w/a.ts'], conflicts: [] }).message).toBe('已恢复 1 个文件')
  })

  it('explains a no-op and conflicts', () => {
    expect(summarizeRevert({ restored: [], conflicts: [] }).message).toBe('这一步没有改动文件')
    expect(summarizeRevert({ restored: [], conflicts: [{ path: '/w/a', reason: 'changed_since' }] }))
      .toMatchObject({ ok: false, conflicts: 1 })
    expect(summarizeRevert({ restored: ['/w/a'], conflicts: [{ path: '/w/b', reason: 'missing_snapshot' }] }).message)
      .toBe('已恢复 1 个，1 个冲突')
  })

  it('survives junk payloads', () => {
    expect(summarizeRevert(null)).toMatchObject({ ok: true, restored: 0, conflicts: 0 })
    expect(summarizeRevert({ restored: 'nope', conflicts: 3 })).toMatchObject({ conflicts: 0 })
  })
})
