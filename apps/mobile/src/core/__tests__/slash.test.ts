import { describe, expect, it } from 'vitest'

import { matchCommands, slashQuery, toSlashCommands } from '../slash'

const commands = [
  { name: 'compact', description: '压缩上下文', source: 'builtin' },
  { name: 'skill:review', description: '代码评审', source: 'skill' },
  { name: 'skill:weekly', description: '周报', source: 'skill' },
  { name: 'gh:pr', description: '开 PR', source: 'extension' },
]

describe('slash commands', () => {
  it('only opens for a bare invocation', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/com')).toBe('com')
    expect(slashQuery('/skill:review 试一下')).toBeNull()
    expect(slashQuery('/a\nb')).toBeNull()
    expect(slashQuery('hello /com')).toBeNull()
  })

  it('ranks prefix matches before segments and substrings', () => {
    expect(matchCommands(commands, 'com').map(c => c.name)).toEqual(['compact'])
    expect(matchCommands(commands, 'review').map(c => c.name)).toEqual(['skill:review'])
    expect(matchCommands(commands, 'pr').map(c => c.name)).toEqual(['gh:pr'])
    expect(matchCommands(commands, '').length).toBe(4)
  })

  it('caps the menu', () => {
    expect(matchCommands(commands, '', 2).length).toBe(2)
  })

  it('parses the host rows and drops nameless entries', () => {
    expect(toSlashCommands([
      { name: 'compact', description: 'x', source: 'builtin' },
      { description: 'no name' },
      null,
      'nope',
      { name: '' },
    ])).toEqual([{ name: 'compact', description: 'x', source: 'builtin' }])
    expect(toSlashCommands({})).toEqual([])
  })
})
