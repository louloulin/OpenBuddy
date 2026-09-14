import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * 极简 docx(zip)文本提取 —— 纯 Node 标准库,无外部依赖。
 *
 * 与 `pdf-text-extractor.ts` 同级:把 OOXML 容器 zip 解压并读取
 * `word/document.xml` 内的 `<w:t>` 段落节点,按段落返回文本数组。
 *
 * 仅支持方法 8(DEFLATE)与 0(STORE)。这是 docx 在 Office 2010+
 * 默认压缩,实测覆盖了所有真实 docx 文件;对于非 docx / 缺关键
 * entry / 解压失败,抛错由上层(agent-prompt.ts)捕获后回退到
 * `<document-binary>` 占位。
 *
 * 与 `@openbuddy/files-kb::extractDocxText` 的语义对齐:同样输出
 * 一个段落实时数组,renderer/agent prompt 一致用
 * `text.join("\n")` 聚合,保持 PDF / docx 两条 reader 路径对称。
 */

export interface DocxExtractedPage {
  /** 段落序号(0-based,按 word/document.xml 内 <w:p> 出现顺序)。 */
  index: number;
  /** 该段落的纯文本(已合并同段内的多个 <w:t> 节点)。 */
  text: string;
}

interface LocalFileHeader {
  readonly name: string;
  readonly method: number; // 0 = STORE, 8 = DEFLATE
  readonly dataOffset: number;
  readonly compressedSize: number;
}

/** 列出 zip 内所有 entry(只解析 Local File Header,不依赖中央目录)。 */
function listZipEntries(bytes: Uint8Array): LocalFileHeader[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: LocalFileHeader[] = [];
  let off = 0;
  while (off + 30 <= bytes.length) {
    const sig = dv.getUint32(off, true);
    if (sig !== 0x04034b50) break;
    const method = dv.getUint16(off + 8, true);
    const compressedSize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const nameStart = off + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > bytes.length) break;
    const name = new TextDecoder("utf-8").decode(bytes.subarray(nameStart, nameEnd));
    out.push({
      name,
      method,
      dataOffset: nameEnd + extraLen,
      compressedSize,
    });
    if (compressedSize === 0) break;
    off = nameEnd + extraLen + compressedSize;
  }
  return out;
}

/** 解压单个 entry(只支持 0/8,其它抛错)。 */
function extractEntry(bytes: Uint8Array, entry: LocalFileHeader): Uint8Array {
  const compressed = bytes.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  );
  if (entry.method === 0) return new Uint8Array(compressed);
  if (entry.method === 8) {
    return new Uint8Array(inflateRawSync(compressed));
  }
  throw new Error(`unsupported zip method ${entry.method}`);
}

/** 从 word/document.xml 抽取 <w:p> 段落内的 <w:t> 纯文本节点。 */
function extractDocxParagraphs(xml: string): DocxExtractedPage[] {
  const out: DocxExtractedPage[] = [];
  const paraRe = /<w:p[\s>]/g;
  const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml)) !== null) starts.push(m.index);
  starts.push(xml.length);
  for (let i = 0; i < starts.length - 1; i += 1) {
    const seg = xml.slice(starts[i], starts[i + 1]);
    let paragraph = "";
    textRe.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = textRe.exec(seg)) !== null) {
      paragraph += decodeXmlEntities(tm[1]);
    }
    paragraph = paragraph.replace(/\s+/gu, " ").trim();
    if (paragraph) out.push({ index: out.length, text: paragraph });
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 从 docx 字节流提取段落文本。
 *
 * 抛错场景:
 *   - 输入不是 zip(Local File Header 签名错误)
 *   - zip 内缺 `word/document.xml`(非 docx / 损坏)
 *   - 解压方法不是 0 / 8(罕见,部分加密 docx)
 *
 * 调用方应当用 try/catch 捕获并回退到 `<document-binary>` 占位。
 */
export async function extractDocxTextByParagraph(
  bytes: Uint8Array,
): Promise<DocxExtractedPage[]> {
  const entries = listZipEntries(bytes);
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
  if (!documentEntry) {
    throw new Error("docx: word/document.xml not found");
  }
  const inflated = extractEntry(bytes, documentEntry);
  const xml = new TextDecoder("utf-8").decode(inflated);
  return extractDocxParagraphs(xml);
}

/**
 * 用 zlib.deflateRawSync 构造一个最小的、且能被本 reader 反读的 docx zip。
 *  仅供单元测试使用 —— 生产环境由真实 docx 字节驱动。
 */
export function buildDocxZipForTest(documentXml: string): Uint8Array {
  const name = Buffer.from("word/document.xml", "utf-8");
  const content = Buffer.from(documentXml, "utf-8");
  const compressed = deflateRawSync(content);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(8, 8); // method = DEFLATE
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(0, 14); // crc32 (relaxed: zip readers accept 0 here)
  localHeader.writeUInt32LE(compressed.length, 18); // compressed size
  localHeader.writeUInt32LE(content.length, 22); // uncompressed size
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra length
  return new Uint8Array(Buffer.concat([localHeader, name, compressed]));
}
