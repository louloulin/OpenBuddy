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

export interface DocTocItem {
  level: number;
  id: string;
  text: string;
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
}

const RAW_GH = 'https://github.com/louloulin/OpenBuddy/edit/main/docs';

/** Strip "English / 简体中文" header before the first H1. */
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
  return lines.slice(startIdx).join('\n').trim();
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

export function getDocBySlug(slug: string, locale: Locale): DocContent | null {
  const meta = DOC_INDEX.find((d) => d.slug === slug);
  if (!meta) return null;

  const preferredFile = locale === 'zh-CN' && meta.files.zh ? meta.files.zh : meta.files.en;
  const filePath = path.join(DOCS_ROOT, preferredFile);

  let rawMarkdown: string;
  try {
    rawMarkdown = fs.readFileSync(filePath, 'utf-8');
  } catch {
    if (preferredFile !== meta.files.en) {
      try {
        rawMarkdown = fs.readFileSync(path.join(DOCS_ROOT, meta.files.en), 'utf-8');
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  const cleaned = normalizeMarkdown(rawMarkdown);
  const title = extractTitle(cleaned, meta.title);

  // Render with marked; collect TOC by intercepting heading tokens.
  const toc: DocTocItem[] = [];
  const seenSlugs = new Map<string, number>();

  const renderer = new marked.Renderer();
  // Use function form so `this.parser` (the active Parser instance) is available.
  renderer.heading = function ({ tokens, depth }: Tokens.Heading) {
    const text = this.parser.parseInline(tokens);
    const plain = String(text).replace(/<[^>]+>/g, '');
    let id = slugify(plain);
    const dupCount = seenSlugs.get(id) ?? 0;
    if (dupCount > 0) id = `${id}-${dupCount}`;
    seenSlugs.set(slugify(plain), dupCount + 1);
    toc.push({ level: depth, id, text: plain });
    return `<h${depth} id="${id}" class="md-h md-h${depth}">${text}</h${depth}>\n`;
  };

  marked.use({ renderer, gfm: true, breaks: false });
  const html = marked.parse(cleaned) as string;

  return {
    meta: { ...meta, title },
    html,
    toc,
    sourceFile: preferredFile,
    rawMarkdown,
    githubEditUrl: `${RAW_GH}/${preferredFile}`
  };
}