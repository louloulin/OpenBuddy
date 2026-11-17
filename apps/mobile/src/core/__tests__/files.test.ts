import { describe, expect, it } from 'vitest'

import {
  basename,
  extensionOf,
  formatSize,
  isTextPreview,
  parentPath,
  previewContent,
  toDirEntries,
} from '../files'

describe('toDirEntries', () => {
  it('keeps directories before files and sorts by name', () => {
    expect(toDirEntries([
      { name: 'b.ts', path: '/w/b.ts', kind: 'file', size: 10 },
      { name: 'a.ts', path: '/w/a.ts', kind: 'file', size: 20 },
      { name: 'src', path: '/w/src', kind: 'directory', size: 0 },
    ]).map(entry => entry.name)).toEqual(['src', 'a.ts', 'b.ts'])
  })

  it('drops entries without a name or a path', () => {
    expect(toDirEntries([{ name: 'x' }, { path: '/y' }, null, 7])).toEqual([])
    expect(toDirEntries(undefined)).toEqual([])
  })

  it('normalises an unknown kind to "other"', () => {
    expect(toDirEntries([{ name: 'sock', path: '/w/sock', kind: 'symlink' }])[0]).toMatchObject({ kind: 'other' })
  })
})

describe('extensionOf / isTextPreview', () => {
  it('reads the extension', () => {
    expect(extensionOf('/w/README.md')).toBe('md')
    expect(extensionOf('/w/main.tsx')).toBe('tsx')
    expect(extensionOf('/w/Makefile')).toBe('makefile')
    expect(extensionOf('/w/.gitignore')).toBe('')
  })

  it('knows which files the phone can show as text', () => {
    expect(isTextPreview('/w/a.ts')).toBe(true)
    expect(isTextPreview('/w/notes.md')).toBe(true)
    expect(isTextPreview('/w/image.png')).toBe(false)
    expect(isTextPreview('/w/app.bin')).toBe(false)
  })
})

describe('paths', () => {
  it('finds the parent and the name', () => {
    expect(parentPath('/a/b/c.txt')).toBe('/a/b')
    expect(parentPath('/a')).toBeNull()
    expect(parentPath('/')).toBeNull()
    expect(basename('/a/b/c.txt')).toBe('c.txt')
    expect(basename('/a/b/')).toBe('b')
  })
})

describe('formatSize', () => {
  it('scales the unit', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatSize(0)).toBe('')
  })
})

describe('previewContent', () => {
  it('keeps a short file whole', () => {
    expect(previewContent('hello')).toEqual({ text: 'hello', truncated: false })
  })

  it('keeps the head and the tail of a long file and says so', () => {
    const long = 'x'.repeat(100_000)
    const result = previewContent(long, 1000)
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('已省略')
    expect(result.text.startsWith('x')).toBe(true)
    expect(result.text.endsWith('x')).toBe(true)
    expect(result.text.length).toBeLessThan(1400)
  })
})
