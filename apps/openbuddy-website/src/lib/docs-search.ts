import fs from 'fs';
import path from 'path';
import { DOC_INDEX, type SearchEntry } from './docs-meta';

/**
 * docs-search.ts —— 仅服务端。把 docs/*.md 压成一份可序列化的检索索引,
 * 由 layout.tsx 传给客户端 Cmd-K 搜索弹窗。
 *
 * 只索引标题/描述/小节标题/首段,不索引正文全文:22 篇文档全量正文会让
 * 客户端 bundle 膨胀,而标题+小节已能覆盖绝大多数"我要找那篇讲 X 的文档"。
 */

const DOCS_ROOT = path.join(process.cwd(), '..', '..', 'docs');
const EXCERPT_LEN = 180;

let cache: SearchEntry[] | null = null;

function readDoc(file: string): string | null {
  try {
    return fs.readFileSync(path.join(DOCS_ROOT, file), 'utf-8');
  } catch {
    return null;
  }
}

/** Strip code fences, images, links and heading markers down to plain prose. */
function toPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeadings(md: string): string[] {
  const out: string[] = [];
  const re = /^(#{1,3})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const text = m[2].replace(/[*_`]/g, '').trim();
    if (text) out.push(text);
  }
  return out;
}

function extractExcerpt(md: string): string {
  // Drop the leading H1 and everything before it, then take the first prose paragraph.
  const lines = md.split('\n');
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  const body = lines.slice(h1 + 1).join('\n');
  const firstPara = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && !p.startsWith('#') && !p.startsWith('>') && !p.startsWith('|') && !p.startsWith('-'));
  const plain = toPlainText(firstPara ?? '');
  return plain.length > EXCERPT_LEN ? `${plain.slice(0, EXCERPT_LEN).trimEnd()}…` : plain;
}

function buildEntry(slug: string, title: string, description: string, category: SearchEntry['category'], files: string[]): SearchEntry {
  const headings: string[] = [];
  let excerpt = '';
  for (const file of files) {
    const md = readDoc(file);
    if (!md) continue;
    headings.push(...extractHeadings(md));
    if (!excerpt) excerpt = extractExcerpt(md);
  }
  // Dedupe headings (en/zh files often share the same English section names).
  const unique = Array.from(new Set(headings));
  return { slug, title, description, category, headings: unique, excerpt };
}

export function getSearchIndex(): SearchEntry[] {
  if (cache) return cache;
  cache = DOC_INDEX.map((doc) => {
    const files = [doc.files.en, doc.files.zh].filter((f): f is string => Boolean(f));
    return buildEntry(doc.slug, doc.title, doc.description, doc.category, files);
  });
  return cache;
}
