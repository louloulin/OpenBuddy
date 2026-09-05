/**
 * 本地文件夹知识源 —— 让 KnowledgeBasePanel 运行时真正可搜索。
 *
 * 对齐 WorkBuddy `knowledge-base-panel` 的「本地知识源」概念,但用本地文件夹扫描
 * 替代腾讯 Drive。扫描指定目录下的文本文件(.md/.txt/.markdown/.mdx/.rst/.log)
 * 以及 OOXML 文档(.docx/.pptx/.xlsx,经 zip-reader + doc-preview 提取文本),
 * 构建可搜索的知识条目。
 *
 * 纯函数核心(可测):文件筛选 / 文本预处理 / 片段提取 / 查询过滤 / 目录递归收集 /
 * OOXML 文本提取(docx/pptx/xlsx)。运行时:注入 DirectoryReader(Electron-compatible 封装)。
 */
import type { KbEntry, KbProvider } from "./knowledge-base";
import { readZip } from "./zip-reader";
import {
  extractDocxFromZip,
  extractPptxFromZip,
  extractSheetFromZip,
} from "./doc-preview";

/** 受支持的纯文本扩展名(大小写不敏感)。 */
export const KB_TEXT_EXTS = [".md", ".markdown", ".mdx", ".txt", ".rst", ".log"];

/** 受支持的 OOXML 文档扩展名(需 zip 解压提取文本)。 */
export const KB_DOCX_EXTS = [".docx"];
export const KB_PPTX_EXTS = [".pptx"];
export const KB_SHEET_EXTS = [".xlsx"];
/** 全部 OOXML 扩展(docx/pptx/xlsx)。 */
export const KB_OFFICE_EXTS = [...KB_DOCX_EXTS, ...KB_PPTX_EXTS, ...KB_SHEET_EXTS];

/** 目录读取注入接口(运行时用 Electron-compatible browse_directory 实现;测试用内存 mock)。 */
export interface DirectoryReader {
  /** 列出某目录的直接子项(文件 + 子目录);不存在/失败返回空数组。 */
  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>>;
  /** 读取一个文本文件的字符串内容;失败返回 null。 */
  readText(path: string): Promise<string | null>;
  /** 读取文件的原始字节(docx/pptx/xlsx 等二进制文档需要);失败/不支持返回 null。 */
  readBytes?(path: string): Promise<Uint8Array | null>;
}

/** 取扩展名(小写,含点)。 */
function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** 是否为受支持的文本知识文件。 */
export function isKnowledgeFile(name: string): boolean {
  return KB_TEXT_EXTS.includes(extOf(name));
}

/** 是否为受支持的 docx 知识文件。 */
export function isDocxFile(name: string): boolean {
  return KB_DOCX_EXTS.includes(extOf(name));
}

/** 是否为受支持的 pptx 知识文件。 */
export function isPptxFile(name: string): boolean {
  return KB_PPTX_EXTS.includes(extOf(name));
}

/** 是否为受支持的表格(xlsx)知识文件。 */
export function isSheetFile(name: string): boolean {
  return KB_SHEET_EXTS.includes(extOf(name));
}

/** 是否为受支持的任意 OOXML 文档(docx/pptx/xlsx)。 */
export function isOfficeFile(name: string): boolean {
  return KB_OFFICE_EXTS.includes(extOf(name));
}

/** 是否为受支持的任意知识文件(文本或 OOXML)。 */
export function isAnyKnowledgeFile(name: string): boolean {
  return isKnowledgeFile(name) || isOfficeFile(name);
}

/**
 * 从 OOXML 字节提取纯文本(复用 zip-reader + doc-preview),按扩展名分发:
 *  - .docx → extractDocxFromZip
 *  - .pptx → extractPptxFromZip(幻灯片文本,按数字序)
 *  - .xlsx → extractSheetFromZip(单元格 + 共享字符串)
 * 无对应内容/解压失败/未知类型返回 null。纯函数,可测。
 *
 * `nameOrExt` 可以是文件名或扩展名(含点,如 ".pptx")。
 */
export function extractOfficeText(bytes: Uint8Array, nameOrExt: string): string | null {
  const ext = extOf(nameOrExt);
  try {
    const files = readZip(bytes);
    const reader = {
      readText: (p: string) => (p in files ? new TextDecoder("utf-8").decode(files[p]) : null),
      listEntries: () => Object.keys(files),
    };
    if (ext === ".docx") {
      if (!files["word/document.xml"]) return null;
      return extractDocxFromZip(reader)?.text ?? null;
    }
    if (ext === ".pptx") {
      const extract = extractPptxFromZip(reader);
      return extract?.text ?? null;
    }
    if (ext === ".xlsx") {
      const extract = extractSheetFromZip(reader);
      return extract?.text ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 从 docx 字节提取纯文本(复用 zip-reader + doc-preview)。
 * 非 docx / 解压失败 / 无 word/document.xml 返回 null。纯函数,可测。
 * 保留为独立导出(向后兼容已有调用/测试)。
 */
export function extractDocxText(bytes: Uint8Array): string | null {
  return extractOfficeText(bytes, ".docx");
}

/** 从 pptx 字节提取幻灯片文本。 */
export function extractPptxText(bytes: Uint8Array): string | null {
  return extractOfficeText(bytes, ".pptx");
}

/** 从 xlsx 字节提取表格文本。 */
export function extractSheetText(bytes: Uint8Array): string | null {
  return extractOfficeText(bytes, ".xlsx");
}

/**
 * 从一篇文章/笔记文本生成搜索片段:返回包含 query(大小写不敏感)的首个段落/行,
 * 截断到 maxLen。无命中返回开头摘要。
 */
export function makeSnippet(text: string, query = "", maxLen = 120): string {
  const clean = (text || "").replace(/\r/g, "").trim();
  if (!clean) return "";
  if (query) {
    const idx = clean.toLowerCase().indexOf(query.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - Math.floor(maxLen / 3));
      const snippet = clean.slice(start, start + maxLen);
      return (start > 0 ? "…" : "") + snippet + (start + maxLen < clean.length ? "…" : "");
    }
  }
  // 取第一段非空行(去掉 markdown 标题井号)。
  const firstLine = clean.split("\n").find((l) => l.replace(/^#+\s*/, "").trim().length > 0) ?? clean;
  const norm = firstLine.replace(/^#+\s*/, "").trim();
  return norm.length > maxLen ? norm.slice(0, maxLen) + "…" : norm;
}

/**
 * 从一个文件构造一条 KbEntry(标题取文件名去扩展名;snippet 由内容生成)。
 * 无 query 时不做命中过滤(列出全部)。
 */
export function fileToEntry(
  file: { name: string; path: string },
  content: string | null,
  query?: string,
): KbEntry | null {
  const title = file.name.replace(/\.[^.]+$/, "");
  const snippet = content ? makeSnippet(content, query ?? "") : undefined;
  // 有 query 时:标题或片段命中才算命中(避免列出不相关文件)。
  if (query) {
    const q = query.toLowerCase();
    const hit =
      title.toLowerCase().includes(q) ||
      (content?.toLowerCase().includes(q) ?? false);
    if (!hit) return null;
  }
  return { id: file.path, title, snippet, source: "local", url: file.path };
}

/**
 * 递归收集目录下所有受支持的知识文件(广度优先,限制深度与总数以防过大目录)。
 * 纯逻辑 + 注入 DirectoryReader,可测。
 */
export async function collectKnowledgeFiles(
  root: string,
  reader: DirectoryReader,
  opts: { maxDepth?: number; maxFiles?: number } = {},
): Promise<Array<{ name: string; path: string }>> {
  const maxDepth = opts.maxDepth ?? 5;
  const maxFiles = opts.maxFiles ?? 500;
  const out: Array<{ name: string; path: string }> = [];
  const seen = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (queue.length > 0 && out.length < maxFiles) {
    const { path, depth } = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    let entries: Array<{ name: string; path: string; isDir: boolean }>;
    try {
      entries = await reader.listDir(path);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDir) {
        if (depth + 1 <= maxDepth) queue.push({ path: e.path, depth: depth + 1 });
      } else if (isAnyKnowledgeFile(e.name)) {
        if (out.length >= maxFiles) break;
        out.push({ name: e.name, path: e.path });
      }
    }
  }
  return out;
}

/**
 * 构造一个本地文件夹 KbProvider。
 *  - root:要扫描的根目录
 *  - reader:目录读取注入(运行时 = Electron-compatible;测试 = mock)
 *  - 缓存首次扫描结果,后续 list() 在内存过滤(读文本按需)。
 *
 * 未配置 root(空串)时 isEnabled() 返回 false。
 */
export function createLocalKbProvider(
  root: string,
  reader: DirectoryReader,
  options: { maxDepth?: number; maxFiles?: number; providerId?: string; label?: string } = {},
): KbProvider {
  let cache: Array<{ name: string; path: string }> | null = null;
  let lastScannedAt: number | undefined;
  const scanOnce = async () => {
    cache = await collectKnowledgeFiles(root, reader, options);
    lastScannedAt = Date.now();
    return cache;
  };
  const ensureCache = async () => {
    if (cache) return cache;
    return scanOnce();
  };
  return {
    id: options.providerId ?? "local",
    label: options.label ?? "本地文件夹",
    isEnabled: () => !!root,
    async list(query) {
      if (!root) return [];
      const files = await ensureCache();
      const out: KbEntry[] = [];
      for (const f of files) {
        // 有 query 时读内容做命中 + 片段;无 query 时只列标题(避免全量读文件)。
        let content: string | null = null;
        if (query) {
          if (isOfficeFile(f.name)) {
            // OOXML(docx/pptx/xlsx):读字节 → zip-reader + doc-preview 提取文本。
            const bytes = reader.readBytes ? await reader.readBytes(f.path).catch(() => null) : null;
            content = bytes ? extractOfficeText(bytes, f.name) : null;
          } else {
            content = await reader.readText(f.path).catch(() => null);
          }
        }
        const entry = fileToEntry(f, content, query);
        if (entry) out.push(entry);
      }
      return out;
    },
    /** 重建索引:清缓存并重新扫描目录(本地文件夹内容变化后手动刷新)。返回新条目数。 */
    async rebuild() {
      await scanOnce();
      return cache!.length;
    },
    /** 查询索引覆盖范围:已索引文件数 + 最近扫描时间。 */
    getStats() {
      return {
        fileCount: cache?.length,
        lastRebuiltAt: lastScannedAt,
      };
    },
  };
}
