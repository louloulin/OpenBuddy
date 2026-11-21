/**
 * 文档预览纯函数层 —— 对齐 WorkBuddy `context-viewer-components/media-preview`
 * 的 docx/pptx/sheet 预览。
 *
 * OOXML(docx/pptx/xlsx)本质是 zip,内含 XML。为避免引入重型依赖,这里把「解压」
 * 作为依赖注入(`ZipReader` 接口),核心「XML 文本提取」是纯函数,便于单测。
 * 运行时可注入任意 zip 实现(如 fflate/jszip),或由后端解压后只传 XML 文本。
 */

/** 解压接口:按 entry 路径返回文本内容(缺省返回 null)。 */
export interface ZipReader {
  /** 读取某个 entry 的文本内容;不存在返回 null。 */
  readText(path: string): string | null;
  /** 列出所有 entry 路径(支持 glob 匹配,如 ppt/slides/slide*.xml)。 */
  listEntries(): string[];
}

/** docx 提取结果:按段落聚合的纯文本。 */
export interface DocxExtract {
  /** 段落列表(已去标签、去空白)。 */
  paragraphs: string[];
  /** 合并后的纯文本(段落用换行连接)。 */
  text: string;
}

/** 把 OOXML <w:t>(docx)/<a:t>(pptx) 文本节点内容按顺序抽出来,返回段落数组。 */
function extractTextNodes(xml: string, tagName: "w:t" | "a:t"): string[] {
  const out: string[] = [];
  // docx:段落由 <w:p> 包裹,段落内多个 <w:t> 拼接;pptx:<a:p> 内 <a:t>。
  const paraTag = tagName === "w:t" ? "w:p" : "a:p";
  const paraRe = new RegExp(`<${paraTag}[ >]`, "g");
  // 先按段落切分,再在段内抽取文本节点。
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml)) !== null) starts.push(m.index);
  starts.push(xml.length);
  for (let i = 0; i < starts.length - 1; i++) {
    const seg = xml.slice(starts[i], starts[i + 1]);
    const tRe = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "g");
    let tm: RegExpExecArray | null;
    let para = "";
    while ((tm = tRe.exec(seg)) !== null) {
      // 反转义基本 XML 实体。
      para += decodeXml(tm[1]);
    }
    para = para.trim();
    if (para) out.push(para);
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 从 docx 的 word/document.xml 提取段落文本。 */
export function extractDocxParagraphs(documentXml: string): DocxExtract {
  const paragraphs = extractTextNodes(documentXml, "w:t");
  return { paragraphs, text: paragraphs.join("\n") };
}

/** pptx 提取结果:每页幻灯片的文本(标题/正文聚合)。 */
export interface PptxExtract {
  /** 每张幻灯片的文本行。 */
  slides: string[][];
  /** 合并文本(幻灯片间用空行,行内用换行)。 */
  text: string;
}

/** 从 pptx 的若干 slideN.xml 提取每页文本(按 slide 编号排序)。 */
export function extractPptxSlides(slideXmls: Array<{ name: string; xml: string }>): PptxExtract {
  const sorted = [...slideXmls].sort((a, b) => slideIndex(a.name) - slideIndex(b.name));
  const slides = sorted.map((s) => extractTextNodes(s.xml, "a:t"));
  return { slides, text: slides.map((lines) => lines.join("\n")).join("\n\n") };
}

/** 从 entry 名解析幻灯片序号(ppt/slides/slide1.xml → 1)。 */
export function slideIndex(name: string): number {
  const m = name.match(/slide(\d+)\.xml$/i);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** xlsx 提取结果:每个 sheet 的二维表格(行 × 列)。 */
export interface SheetExtract {
  /** 每个 sheet 的行(每行是单元格字符串数组)。 */
  sheets: Array<{ name: string; rows: string[][] }>;
  /** 合并文本(TSV 近似,sheet 间空行)。 */
  text: string;
}

/**
 * 从 xlsx 的 sheet XML 提取二维表。
 *  - sheetXmls:每个 sheet 的 xml(worksheet.xml,含 <c><v>/<c><is> 单元格)
 *  - sharedStrings:共享字符串表(若存在;cell 的 t="s" 时 v 是下标)
 * 返回每 sheet 的行列。
 */
export function extractSheets(
  sheetXmls: Array<{ name: string; xml: string }>,
  sharedStrings: string[] = [],
): SheetExtract {
  const sheets = sheetXmls.map(({ name, xml }) => {
    const rows: string[][] = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(xml)) !== null) {
      const rowXml = rm[1];
      const cells: string[] = [];
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rowXml)) !== null) {
        const attrs = cm[1];
        const inner = cm[2];
        const isShared = /t="s"/.test(attrs);
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        const isMatch = inner.match(/<is>([\s\S]*?)<\/is>/);
        let value = "";
        if (isMatch) {
          // inline string:<t>text</t>
          const tMatch = isMatch[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g);
          value = tMatch ? tMatch.map((t) => t.replace(/<[^>]+>/g, "")).join("") : "";
        } else if (vMatch) {
          value = decodeXml(vMatch[1]);
          if (isShared) {
            const idx = parseInt(value, 10);
            value = Number.isFinite(idx) && idx < sharedStrings.length ? sharedStrings[idx] : value;
          }
        }
        cells.push(decodeXml(value));
      }
      if (cells.length) rows.push(cells);
    }
    return { name, rows };
  });
  const text = sheets
    .map((s) => `# ${s.name}\n` + s.rows.map((r) => r.join("\t")).join("\n"))
    .join("\n\n");
  return { sheets, text };
}

/** 从 xlsx xl/sharedStrings.xml 提取共享字符串数组(顺序保留下标)。 */
export function extractSharedStrings(sharedStringsXml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(sharedStringsXml)) !== null) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    let val = "";
    while ((tm = tRe.exec(m[1])!) !== null) {
      val += decodeXml(tm[1]);
    }
    out.push(val);
  }
  return out;
}

/**
 * 高层:从 ZipReader 提取 docx 文本(读 word/document.xml)。
 * 非 docx 或缺 entry 返回 null。
 */
export function extractDocxFromZip(zip: ZipReader): DocxExtract | null {
  const xml = zip.readText("word/document.xml");
  if (xml == null) return null;
  return extractDocxParagraphs(xml);
}

/** 高层:从 ZipReader 提取 pptx(读所有 ppt/slides/slideN.xml)。 */
export function extractPptxFromZip(zip: ZipReader): PptxExtract | null {
  const names = zip.listEntries().filter((n) => /ppt\/slides\/slide\d+\.xml$/i.test(n));
  if (names.length === 0) return null;
  const slideXmls = names
    .map((name) => ({ name, xml: zip.readText(name) ?? "" }))
    .filter((s) => s.xml);
  if (slideXmls.length === 0) return null;
  return extractPptxSlides(slideXmls);
}

/** 高层:从 ZipReader 提取 xlsx(读 xl/worksheets/sheetN.xml + 共享字符串)。 */
export function extractSheetFromZip(zip: ZipReader): SheetExtract | null {
  const ssXml = zip.readText("xl/sharedStrings.xml");
  const shared = ssXml ? extractSharedStrings(ssXml) : [];
  const names = zip
    .listEntries()
    .filter((n) => /xl\/worksheets\/sheet\d+\.xml$/i.test(n));
  if (names.length === 0) return null;
  const sheetXmls = names.map((name) => ({ name: sheetNameFromPath(name), xml: zip.readText(name) ?? "" }));
  return extractSheets(sheetXmls, shared);
}

/** 从 entry 路径取 sheet 显示名(xl/worksheets/sheet1.xml → Sheet1)。 */
export function sheetNameFromPath(path: string): string {
  const m = path.match(/sheet(\d+)\.xml$/i);
  return m ? `Sheet${m[1]}` : path;
}
