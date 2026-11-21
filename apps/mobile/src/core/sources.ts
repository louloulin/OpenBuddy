/**
 * Sources behind a web tool (20261117-mobile.md F4).
 *
 * The protocol carries no structured citation list yet, so the phone reads
 * what the desktop's `web_search` / `web_fetch` actually returned: Markdown
 * links first, then bare URLs. Nothing is invented — a turn without web tools
 * shows no source section at all.
 */

export type SourceRef = {
  url: string
  title: string
}

const MARKDOWN_LINK = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g
const BARE_URL = /https?:\/\/[^\s<>"'）)]+/g

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** Markdown links win over bare URLs; both are deduped by URL. */
export function extractSources(text: string, limit = 6): SourceRef[] {
  if (!text) return []
  const found: SourceRef[] = []
  const seen = new Set<string>()

  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const url = match[2]
    if (!url || seen.has(url)) continue
    seen.add(url)
    found.push({ url, title: cleanTitle(match[1] ?? '') || hostname(url) })
  }

  for (const match of text.matchAll(BARE_URL)) {
    // Trim trailing punctuation the regex cannot know about (ASCII and CJK,
    // because a sentence often ends right after a URL).
    const url = match[0].replace(/[.,;:!?。，、；：！？）】》」』"'”’]+$/, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    found.push({ url, title: hostname(url) })
  }

  return found.slice(0, Math.max(0, limit))
}

/** True for the tools whose output can carry sources. */
export function isSourceTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'web_search' || lower === 'web_fetch' || lower === 'fetch' || lower === 'search'
}
