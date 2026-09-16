import fs from 'fs';
import path from 'path';
import { Marked, Renderer, type Tokens } from 'marked';
import type { Locale } from './i18n';
import { DOC_INDEX, type DocMeta } from './docs-meta';

/**
 * docs-server.ts —— 仅服务端读 + 渲染 docs/*.md。
 * 客户端组件请勿引用(避免 webpack 把 node:fs 打入 client bundle)。
 */

const DOCS_ROOT = path.join(process.cwd(), '..', '..', 'docs');
const RAW_GH = 'https://github.com/louloulin/OpenBuddy/edit/main/docs';
const GH_BLOB = 'https://github.com/louloulin/OpenBuddy/blob/main';

/** 源文件名(小写)→ 文档条目,用于把正文里的 `.md` 相对链接翻成站内路由。 */
const FILE_TO_DOC = new Map<string, DocMeta>();
for (const doc of DOC_INDEX) {
  FILE_TO_DOC.set(doc.files.en.toLowerCase(), doc);
  if (doc.files.zh) FILE_TO_DOC.set(doc.files.zh.toLowerCase(), doc);
}

/**
 * 正文里的跨文档链接写的是文件名(`[Architecture](ARCHITECTURE.md)`),站内路由
 * 却是 slug(`/en/docs/architecture`),原样输出会 404 —— 而且几乎每篇文档都有。
 * 这里按文件名查回 slug;查不到的(如 `../CONTRIBUTING.md`)指到 GitHub 上的
 * 源文件,至少不是死链。
 */
function rewriteDocLinks(html: string, locale: Locale): string {
  return html.replace(
    /(<a\b[^>]*\bhref=")([^"#]+\.md)(#[^"]*)?(")/gi,
    (_match, pre: string, target: string, hash: string | undefined, post: string) => {
      // 只处理相对路径;`https://…/x.md` 这类绝对链接原样保留。
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) return _match;
      const file = target.replace(/^\.\//, '').split('/').pop()?.toLowerCase();
      const doc = file ? FILE_TO_DOC.get(file) : undefined;
      if (doc) return `${ pre }/${ locale }/docs/${ doc.slug }${ hash ?? '' }${ post }`;
      const repoPath = path.posix.normalize(path.posix.join('docs', target));
      return `${ pre }${ GH_BLOB }/${ repoPath }${ hash ?? '' }${ post }`;
    }
  );
}

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

/**
 * 手动语言切换行,两种写法:
 *   **English** · [简体中文](FAQ.zh-CN.md)
 *   [English](FAQ.md) · **简体中文**
 * 文档头已经有 LanguageSwitcher,这一行会渲染成一个指向 `/en/docs/X.zh-CN.md`
 * 的死链。只在正文第一个 `##` 之前剥离,避免误伤正文里的同类写法。
 */
const LANGUAGE_SWITCH_LINE =
  /^(?:\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\.md\))\s*·\s*(?:\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\.md\))[ \t]*$/gm;

/**
 * 文档正文归一化:
 * 1. 丢掉第一个 H1 之前的一切(面包屑、徽章、语言行)
 * 2. 丢掉正文的 H1 本身 —— `DocArticle` 已经用 `DocMeta.title` 渲染了标题,
 *    保留会让页面上出现两个 `<h1>`,并让 TOC 的第一项变成页面自己的标题
 * 3. 丢掉手动语言切换行,以及若干文档里内嵌的 "Language / 语言" 引用块
 */
function normalizeMarkdown(md: string): string {
  const lines = md.split('\n');
  let startIdx = 0;
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    if (lines[i].trim().startsWith('# ')) {
      startIdx = i + 1;
      break;
    }
  }
  let body = lines.slice(startIdx).join('\n');

  // 只在第一个 `##` 之前剥离语言切换行。
  const headEnd = body.search(/^##[ \t]/m);
  const head = headEnd === -1 ? body : body.slice(0, headEnd);
  const tail = headEnd === -1 ? '' : body.slice(headEnd);
  body = `${ head.replace(LANGUAGE_SWITCH_LINE, '').trim() }${ tail ? `\n\n${ tail }` : '' }`;

  // Drop the Language / 语言 blockquote (single line or wrapped).
  body = body.replace(/^>\s*🌐\s*\*\*Language\s*\/\s*语言:\*\*[^\n]*\n\n?/m, '');
  // Drop the English / 简体中文 anchor h2 jumps when both sections live in one file.
  body = body.replace(/<a id="(english|简体中文)"><\/a>\n##\s+(🇬🇧\s+English|🇨🇳\s+简体中文|简体中文|English)\n/g, '');
  return body.trim();
}

/**
 * 渲染结果的标签白名单。
 *
 * marked 默认把 Markdown 里的原始 HTML 原样透传,最终进 `DocArticle` 的
 * `dangerouslySetInnerHTML`。内容来自仓库、当前可信,但一次恶意 PR 就能塞进
 * `<script>` 或 `onerror=`。这里加一层白名单:单趟扫描、按完整标签整体裁决,
 * 不做字符串替换(替换法会被 `<scr<script>ipt>` 这类拆标记绕过)。
 *
 * 这是零依赖约束下的取舍 —— 比成熟的 sanitizer 弱,但覆盖了全部已知向量。
 */
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'input', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 's',
  'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
]);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'col', 'source', 'wbr']);

const ALLOWED_ATTRS = new Set([
  'align', 'alt', 'aria-hidden', 'aria-label', 'checked', 'class', 'colspan',
  'data-copy-target', 'data-lang', 'data-mermaid', 'data-toc-id', 'decoding',
  'disabled', 'height', 'href', 'id', 'loading', 'rel', 'role', 'rowspan',
  'scope', 'src', 'start', 'target', 'title', 'type', 'width'
]);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

const ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))|([a-zA-Z_:][-a-zA-Z0-9_:.]*)/g;

function safeUrl(value: string): boolean {
  return !/^\s*(?:javascript|vbscript|data:text\/html)/i.test(value);
}

function sanitizeAttrs(tag: string, rawAttrs: string): string {
  const out: string[] = [];
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(rawAttrs)) !== null) {
    const name = (match[1] ?? match[5] ?? '').toLowerCase();
    if (!name || !ALLOWED_ATTRS.has(name)) continue;
    const value = match[2] ?? match[3] ?? match[4];
    if (value === undefined) {
      // 裸属性(`disabled`);只有布尔语义的属性这么写才是合法的。
      if (name === 'disabled' || name === 'checked') out.push(` ${ name }`);
      continue;
    }
    if ((name === 'href' || name === 'src') && !safeUrl(value)) continue;
    if (name === 'type' && tag === 'input' && value !== 'checkbox') continue;
    out.push(` ${ name }="${ value.replace(/"/g, '&quot;') }"`);
  }
  return out.join('');
}

export function sanitizeHtml(html: string): string {
  return html.replace(TAG_RE, (match, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (match.startsWith('</')) return VOID_TAGS.has(name) ? '' : `</${ name }>`;
    if (name === 'input' && !/\btype\s*=\s*(?:"checkbox"|'checkbox'|checkbox)/.test(rawAttrs)) {
      return '';
    }
    return `<${ name }${ sanitizeAttrs(name, rawAttrs) }>`;
  });
}

/** Tiny slugger — avoids adding github-slugger dep. */
function slugify(text: string): string {
  const ascii = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (ascii) return ascii;
  // 纯 CJK 标题会被上面的正则清成空串,导致所有中文标题拿到同一个 `id=""`。
  // 退回一个基于码点的稳定短哈希,同一标题每次都得到同一个锚点。
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `section-${ hash.toString(36) }`;
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
  // 标题取自 H1,而 H1 在 `cleaned` 里已经被剥掉 —— 必须读原始 markdown。
  const title = extractTitle(rawMarkdown, meta.title);

  const toc: DocTocItem[] = [];
  const seenSlugs = new Map<string, number>();

  const renderer = new Renderer();
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

  // 每次渲染用独立实例。`marked.use()` 改的是模块级单例,自定义 renderer 会
  // 跨请求泄漏(并发渲染两篇文档时 heading 计数、toc 数组会互相污染)。
  const parser = new Marked({ renderer, gfm: true, breaks: false, pedantic: false });

  // 文档里的图写的是相对路径 `diagrams/x.svg`,浏览器会请求
  // `/en/docs/diagrams/x.svg` → 404。资源实际打在 `public/docs-assets/diagrams/`
  // (源文件仍是 `docs/diagrams/`,构建不读仓库外目录,所以是拷贝而非软链)。
  const withAssets = cleaned.replace(
    /(<img\b[^>]*\bsrc=")(?:\.\/)?diagrams\//gi,
    '$1/docs-assets/diagrams/'
  );

  const html = sanitizeHtml(rewriteDocLinks(parser.parse(withAssets) as string, locale));

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
