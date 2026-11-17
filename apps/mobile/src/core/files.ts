/**
 * Read-only file browsing (20261115-mobile.md §1.4 gap list).
 *
 * Qwen and Kimi both let the phone read what the computer has: a document, a
 * report, a long PDF. The desktop already exposes that as `list_dir` and
 * `read_text_file`, so the phone's job is to present it — browse, preview, and
 * hand the file back to the conversation as an attachment.
 *
 * The phone never writes. `write_text_file` and friends stay on the desktop.
 */

export type DirEntry = {
  name: string
  path: string
  kind: 'directory' | 'file' | 'other'
  size: number
}

/** Extensions the phone previews as text; everything else only shows its name. */
export const TEXT_PREVIEW = [
  'md', 'markdown', 'txt', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt',
  'c', 'h', 'cpp', 'hpp', 'sh', 'zsh', 'sql', 'html', 'css', 'scss', 'vue',
  'xml', 'csv', 'log', 'env', 'gitignore', 'dockerfile', 'makefile',
]

export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return name.toLowerCase() === 'dockerfile' || name.toLowerCase() === 'makefile'
    ? name.toLowerCase()
    : ''
  return name.slice(dot + 1).toLowerCase()
}

/** True when the file can be shown as text in the phone's viewer. */
export function isTextPreview(path: string): boolean {
  return TEXT_PREVIEW.includes(extensionOf(path))
}

/** Normalises `list_dir` into entries, dropping the shapes the phone cannot use. */
export function toDirEntries(raw: unknown): DirEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: DirEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : null
    const path = typeof record.path === 'string' ? record.path : null
    if (!name || !path) continue
    const kind = record.kind === 'directory' ? 'directory' : record.kind === 'file' ? 'file' : 'other'
    entries.push({
      name,
      path,
      kind,
      size: typeof record.size === 'number' ? record.size : 0,
    })
  }
  // Directories first, then files by name — the desktop's own ordering.
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** A readable size for the file list. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** The parent of a path, or null at the root. */
export function parentPath(path: string): string | null {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (slash <= 0) return null
  return trimmed.slice(0, slash)
}

/** The last segment of a path, for the header. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}

/**
 * Trims a file for the phone's preview pane.
 *
 * The desktop may hold a 5MB file; a phone renders a scroll view, so the
 * preview keeps the head and the tail and says what it dropped.
 */
export function previewContent(text: string, limit = 60_000): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  const head = text.slice(0, Math.floor(limit * 0.7))
  const tail = text.slice(-Math.floor(limit * 0.3))
  return { text: `${head}\n\n… 已省略 ${text.length - limit} 个字符 …\n\n${tail}`, truncated: true }
}
