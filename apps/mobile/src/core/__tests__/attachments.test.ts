import { describe, expect, it } from 'vitest'

import {
  appendAttachments,
  checkUpload,
  compressOptions,
  isUploadMime,
  MAX_ATTACHMENTS,
  MAX_EDGE,
  MAX_UPLOAD_BYTES,
  uploadPath,
} from '../attachments'

describe('compressOptions', () => {
  it('leaves small images alone', () => {
    expect(compressOptions(800, 600)).toEqual({ resize: null, compress: 0.8, format: 'jpeg' })
  })

  it('scales the long edge down to the cap', () => {
    expect(compressOptions(4000, 3000)).toEqual({ resize: { width: MAX_EDGE }, compress: 0.8, format: 'jpeg' })
    expect(compressOptions(1200, 4000)).toEqual({ resize: { height: MAX_EDGE }, compress: 0.8, format: 'jpeg' })
  })
})

describe('checkUpload', () => {
  it('accepts allowed formats within limits', () => {
    expect(isUploadMime('image/jpeg')).toBe(true)
    expect(checkUpload('image/jpeg', 1024, 0)).toEqual({ ok: true })
    expect(checkUpload('image/webp', MAX_UPLOAD_BYTES, 3)).toEqual({ ok: true })
  })

  it('explains each refusal', () => {
    expect(checkUpload('image/gif', 1024, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('JPG') })
    expect(checkUpload('image/png', 0, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('读不出来') })
    expect(checkUpload('image/png', MAX_UPLOAD_BYTES + 1, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('8MB') })
    expect(checkUpload('image/png', 1024, MAX_ATTACHMENTS)).toMatchObject({ ok: false, reason: expect.stringContaining('最多附') })
  })
})

describe('appendAttachments', () => {
  const image = (uri: string) => ({ uri })

  it('keeps order and ignores duplicates', () => {
    const first = appendAttachments([image('a')], [image('b'), image('a')])
    expect(first.list.map(item => item.uri)).toEqual(['a', 'b'])
    expect(first.dropped).toBe(1)
  })

  it('enforces the cap and reports drops', () => {
    const current = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, i) => image(`i${i}`))
    const result = appendAttachments(current, [image('x'), image('y')], MAX_ATTACHMENTS)
    expect(result.list).toHaveLength(MAX_ATTACHMENTS)
    expect(result.dropped).toBe(1)
  })

  it('accepts nothing when the tray is full', () => {
    const full = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => image(`i${i}`))
    expect(appendAttachments(full, [image('x')]).dropped).toBe(1)
  })
})

describe('uploadPath', () => {
  it('joins onto the /api base without doubling slashes', () => {
    expect(uploadPath('https://gw.example.com/api')).toBe('https://gw.example.com/api/upload')
    expect(uploadPath('https://gw.example.com/api/')).toBe('https://gw.example.com/api/upload')
  })
})
