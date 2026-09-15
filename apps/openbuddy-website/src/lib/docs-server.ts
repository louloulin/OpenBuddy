import fs from 'fs';
import path from 'path';
import { marked, type Tokens } from 'marked';
import type { Locale } from './i18n';
import { DOC_INDEX, type DocMeta } from './docs-meta';

/**
 * docs-server.ts —— 仅服务端读 + 渲染 docs/*.md。
 * 客户端组件请勿引用(避免 webpack 把 node:fs 打入 client bundle)。
 */

const DOCS_ROOT = path.join(process.cwd(), '..', '..', 'docs');
const RAW_GH = 'https://github.com/louloulin/OpenBuddy/edit/main/docs';

const LOCALE_LABEL: Record<Locale, { native: string; english: string }> = {
  en: { native: 'English', english: 'English' },
  'zh-CN': { native: '简体中文', english: 'Chinese' }
};

export interface DocTocItem {
  level: number;
  id: string;
  text: string;
}

export interface DocLocaleStatus {
  locale: Locale;
  /** Resolved filename used for this locale (after fallback) */
  file: string;
  /** True iff the preferred file existed; false means it fell back to the other locale */
  isNative: boolean;
}

export interface DocContent {
  meta: DocMeta;
  /** Pre-rendered HTML for the current locale */
  html: string;
  toc: DocTocItem[];
  /** Filename that was actually used (handles zh-CN fallback) */
  sourceFile: string;
  /** Raw markdown for editing in GitHub link */
  rawMarkdown: string;
  githubEditUrl: string;
  /** ISO date of the source file's last mtime */
  lastUpdated: string;
  /** Estimated reading time in minutes (200 wpm, 1.5 wpm per CJK glyph) */
  readingMinutes: number;
  /** Per-locale resolution status — used by the LanguageSwitcher pill */
  available: DocLocaleStatus[];
  /** Native label of the current locale (e.g. "简体中文") */
  currentLocaleNative: string;
  /** The "other" locale's native label if available, else null */
  otherLocaleNative: string | null;
  /** Whether the current page is the user's preferred locale or fell back */
  isNative: boolean;
}

/** Strip any manual "**English** · [简体中文](...)" link line that sits before the first H1,
 * and strip the now-obsolete inline "Language / 语言" callout blockquote that
 * several docs still embed mid-document. The header-level LanguageSwitcher
 * replaces both.
 */
function normalizeMarkdown(md: string): string {
  const lines = md.split('\n');
  let startIdx = 0;
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const line = lines[i].trim();
    if (line.startsWith('# ')) {
      startIdx = i;
      break;
    }
  }
  let body = lines.slice(startIdx).join('\n');
  // Drop the Language / 语言 blockquote (single line or wrapped).
  body = body.replace(/^>\s*🌐\s*\*\*Language\s*\/\s*语言:\*\*[^\n]*\n\n?/m, '');
  // Drop the English / 简体中文 anchor h2 jumps when both sections live in one file.
  body = body.replace(/<a id="(english|简体中文)"><\/a>\n##\s+(🇬🇧\s+English|🇨🇳\s+简体中文|简体中文|English)\n/g, '');
  return body.trim();
}

/** Tiny slugger — avoids adding github-slugger dep. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Title comes from the first H1 in the markdown. */
function extractTitle(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function tryRead(file: string): string | null {
  try {
    return fs.readFileSync(path.join(DOCS_ROOT, file), 'utf-8');
  } catch {
    return null;
  }
}

function computeReadingMinutes(md: string): number {
  const stripped = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  const cjk = (stripped.match(/[一-鿿]/g) || []).length;
  const latin = (stripped.match(/[A-Za-z]+/g) || []).length;
  const words = cjk * 1.5 + latin;
  return Math.max(1, Math.round(words / 200));
}

export function getDocBySlug(slug: string, locale: Locale): DocContent | null {
  const meta = DOC_INDEX.find((d) => d.slug === slug);
  if (!meta) return null;

  const preferredFile = locale === 'zh-CN' && meta.files.zh ? meta.files.zh : meta.files.en;
  const fallbackFile = locale === 'zh-CN' ? meta.files.en : meta.files.zh ?? meta.files.en;
  // Resolve to the preferred file when it actually exists on disk; otherwise fall back.
  const preferredExists = preferredFile !== fallbackFile && tryRead(preferredFile) !== null;
  const usedFile = preferredExists ? preferredFile : fallbackFile;
  const rawMarkdown = tryRead(usedFile);
  if (rawMarkdown === null) return null;
  // isNative means we served the user's preferred locale (not a fallback).
  const isNative = usedFile === preferredFile && usedFile !== fallbackFile;


  const cleaned = normalizeMarkdown(rawMarkdown);
  const title = extractTitle(cleaned, meta.title);

  const toc: DocTocItem[] = [];
  const seenSlugs = new Map<string, number>();

  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }: Tokens.Heading) {
    const text = this.parser.parseInline(tokens);
    const plain = String(text).replace(/<[^>]+>/g, '');
    let id = slugify(plain);
    const dupCount = seenSlugs.get(id) ?? 0;
    if (dupCount > 0) id = `${id}-${dupCount}`;
    seenSlugs.set(slugify(plain), dupCount + 1);
    toc.push({ level: depth, id, text: plain });
    return `<h${depth} id="${id}" data-toc-id="${id}" class="md-h md-h${depth}">${text}</h${depth}>\n`;
  };

  renderer.code = function ({ text, lang }: Tokens.Code) {
    const safeLang = ((lang ?? '').trim() || 'text').toLowerCase();
    // Mermaid blocks are emitted as <pre class="mermaid"> by the markdown renderer
    // and then hydrated on the client via MermaidEnhancer.
    if (safeLang === 'mermaid') {
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<div class="mermaid-block" data-mermaid="1"><pre class="mermaid">${escaped}</pre></div>\n`;
    }
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return (
      `<div class="code-block" data-lang="${safeLang}" data-copy-target="1">` +
      `<div class="code-block-meta"><span class="code-block-lang">${safeLang}</span></div>` +
      `<pre class="code-block-pre"><code class="language-${safeLang}">${escaped}</code></pre>` +
      `</div>\n`
    );
  };

  // 宽表格在窄屏会把整页撑出横向滚动(表格自身不会滚动)。
  // 包一层可横向滚动的容器,同时保留 table 的 width:100% 桌面布局。
  const defaultTable = renderer.table;
  renderer.table = function (token: Tokens.Table) {
    return `<div class="md-table-wrap">${ defaultTable.call(this, token) }</div>\n`;
  };

  marked.use({ renderer, gfm: true, breaks: false, pedantic: false });
  const html = marked.parse(cleaned) as string;

  let lastUpdated = '';
  try {
    const stat = fs.statSync(path.join(DOCS_ROOT, usedFile));
    lastUpdated = stat.mtime.toISOString().slice(0, 10);
  } catch {
    lastUpdated = '';
  }
  const readingMinutes = computeReadingMinutes(cleaned);

  // Build locale availability list for the LanguageSwitcher.
  // isNative = true only when the locale has its own dedicated source file
  // (otherwise it would just be a fallback to the other locale's file).
  const available: DocLocaleStatus[] = [];
  for (const loc of ['en', 'zh-CN'] as const) {
    const ownFile = loc === 'zh-CN' ? meta.files.zh : meta.files.en;
    if (ownFile && tryRead(ownFile) !== null) {
      available.push({ locale: loc, file: ownFile, isNative: true });
    } else if (meta.files.en && tryRead(meta.files.en) !== null && loc !== 'en') {
      // Locale is reachable only via fallback to the EN file.
      available.push({ locale: loc, file: meta.files.en, isNative: false });
    }
  }

  const otherLoc: Locale = locale === 'zh-CN' ? 'en' : 'zh-CN';
  const otherAvailable = available.find((a) => a.locale === otherLoc);
  const otherLocaleNative = otherAvailable ? LOCALE_LABEL[otherLoc].native : null;

  return {
    meta: { ...meta, title },
    html,
    toc,
    sourceFile: usedFile,
    rawMarkdown,
    githubEditUrl: `${RAW_GH}/${usedFile}`,
    lastUpdated,
    readingMinutes,
    available,
    currentLocaleNative: LOCALE_LABEL[locale].native,
    otherLocaleNative,
    isNative
  };
}
