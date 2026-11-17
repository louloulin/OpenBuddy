/**
 * 资料库 knowledge sources (20261117-mobile.md D1).
 *
 * The desktop owns `library.json`: folders the user registered as knowledge
 * sources. The phone lists them and opens one read-only in the file browser;
 * adding and removing a source stays on the desktop.
 */

export type LibrarySource = {
  id: string
  label: string
  path: string
  addedAt?: string
}

export function toLibrarySources(raw: unknown): LibrarySource[] {
  if (!Array.isArray(raw)) return []
  const rows: LibrarySource[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path : ''
    if (!path) continue
    rows.push({
      id: typeof record.id === 'string' && record.id ? record.id : path,
      label: typeof record.label === 'string' && record.label.trim()
        ? record.label.trim()
        : path.split('/').filter(Boolean).pop() ?? path,
      path,
      addedAt: typeof record.addedAt === 'string' ? record.addedAt : undefined,
    })
  }
  return rows
}
