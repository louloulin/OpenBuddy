import { describe, expect, it } from 'vitest'

import { projectLabelFor, toProjects } from '../projects'
import { groupSessions } from '../session-actions'
import type { CachedSession } from '../../db/cache'

function session(overrides: Partial<CachedSession> & { id: string }): CachedSession {
  return {
    title: overrides.id,
    updatedAt: 0,
    pinned: false,
    archived: false,
    preview: '',
    unread: 0,
    ...overrides,
  }
}

const projects = toProjects({
  projects: [
    { id: 'p1', name: 'OpenBuddy', cwd: '/w/openbuddy/' },
    { id: 'p2', name: '临时试验', cwd: '/tmp/scratch' },
    { id: 'p3' },
  ],
})

describe('projects', () => {
  it('normalises the snapshot and drops nameless rows', () => {
    expect(projects).toEqual([
      { id: 'p1', name: 'OpenBuddy', cwd: '/w/openbuddy' },
      { id: 'p2', name: '临时试验', cwd: '/tmp/scratch' },
    ])
    expect(toProjects([null, {}, { name: '  ' }, { id: 'p3' }])).toEqual([])
  })

  it('labels a cwd by project name, folder name, or 其他会话', () => {
    expect(projectLabelFor('/w/openbuddy', projects)).toBe('OpenBuddy')
    expect(projectLabelFor('/w/other/', projects)).toBe('other')
    expect(projectLabelFor(undefined, projects)).toBe('其他会话')
  })

  it('groups non-pinned sessions by project and honours folding', () => {
    const sessions = [
      session({ id: 'pin', pinned: true }),
      session({ id: 'a', cwd: '/w/openbuddy' }),
      session({ id: 'b', cwd: '/w/openbuddy' }),
      session({ id: 'c', cwd: '/tmp/scratch' }),
      session({ id: 'd' }),
    ]
    const rows = groupSessions(sessions, false, { projects })
    expect(rows.map(row => row.id)).toEqual([
      'label:pinned', 'pin',
      'label:project:OpenBuddy', 'a', 'b',
      'label:project:临时试验', 'c',
      'label:project:其他会话', 'd',
    ])
    const folded = groupSessions(sessions, false, { projects, collapsed: ['label:project:OpenBuddy'] })
    expect(folded.map(row => row.id)).toEqual([
      'label:pinned', 'pin',
      'label:project:OpenBuddy',
      'label:project:临时试验', 'c',
      'label:project:其他会话', 'd',
    ])
    expect(folded[2]).toMatchObject({ kind: 'label', count: 2, collapsed: true, collapsible: true })
  })
})
