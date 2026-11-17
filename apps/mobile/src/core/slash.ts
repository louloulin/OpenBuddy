/**
 * Slash commands (20261117-mobile.md D4).
 *
 * `commands_list` is desktop-owned: built-ins, enabled skills (`skill:<name>`)
 * and session extensions. The phone only filters and inserts — it never keeps
 * a copy of the list, because the desktop's skills change per workspace.
 */

export type SlashCommand = {
  name: string
  description?: string
  source?: string
}

/** The query when the draft is a bare slash invocation: "/" → "", "/com" → "com". */
export function slashQuery(text: string): string | null {
  if (!text.startsWith('/') || text.includes('\n')) return null
  const rest = text.slice(1)
  // Once the user types an argument the menu is out of the way.
  return /\s/.test(rest) ? null : rest
}

/** Prefix matches first, then name-segment matches, then substrings. */
export function matchCommands(
  commands: readonly SlashCommand[],
  query: string,
  limit = 6,
): SlashCommand[] {
  const q = query.trim().toLowerCase()
  const ranked: { command: SlashCommand; score: number }[] = []
  for (const command of commands) {
    const name = command.name.toLowerCase()
    let score: number
    if (!q || name === q) score = 0
    else if (name.startsWith(q)) score = 1
    else if (name.split(/[:_]/).some(part => part.startsWith(q))) score = 2
    else if (name.includes(q)) score = 3
    else continue
    ranked.push({ command, score })
  }
  ranked.sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name))
  return ranked.slice(0, Math.max(0, limit)).map(entry => entry.command)
}

/** Tolerates the host's `{name, description, source}` rows and drops nameless ones. */
export function toSlashCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    if (typeof row.name !== 'string' || !row.name) return []
    return [{
      name: row.name,
      ...(typeof row.description === 'string' ? { description: row.description } : {}),
      ...(typeof row.source === 'string' ? { source: row.source } : {}),
    }]
  })
}
