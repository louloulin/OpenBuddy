import { PassThrough } from "node:stream";
import officegen from "officegen";

/**
 * 办公产物 (B2b): generate real Word / Excel / PowerPoint files through `officegen`
 * (Office Open XML, MIT). The builders are pure: they return bytes and never touch the disk;
 * the Pi tool owns path checks, checkpoints and artifact refresh.
 */

export type DocxBlock =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; headers: string[]; rows: Array<Array<string | number>> };

export interface DocxSpec {
  title?: string;
  blocks: DocxBlock[];
}

export interface XlsxSheetSpec {
  name?: string;
  columns?: Array<string | number>;
  rows: Array<Array<string | number | null | undefined>>;
}

export interface XlsxSpec {
  sheets: XlsxSheetSpec[];
}

export interface PptxSlideSpec {
  title: string;
  bullets?: string[];
}

export interface PptxSpec {
  title?: string;
  slides: PptxSlideSpec[];
}

const LIMITS = {
  docxBlocks: 500,
  tableRows: 500,
  tableCols: 30,
  sheets: 20,
  sheetRows: 10_000,
  sheetCols: 64,
  slides: 100,
  bullets: 40,
} as const;

const bad = (message: string): never => {
  throw new Error(message);
};

const stringOf = (value: unknown, max: number): string => {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
};

type Generator = {
  on(event: "error", listener: (error: Error) => void): unknown;
  generate(stream: NodeJS.WritableStream): void;
};

const collect = (doc: Generator): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    stream.on("error", reject);
    doc.on("error", reject);
    doc.generate(stream);
  });

const columnName = (index: number): string => {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/** Word: title, headings, paragraphs, bullets and simple tables. */
export async function buildDocx(spec: DocxSpec): Promise<Uint8Array> {
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : bad("docx: blocks 必须是数组");
  if (blocks.length > LIMITS.docxBlocks) bad(`docx: 最多 ${LIMITS.docxBlocks} 个内容块`);
  if (!blocks.length) bad("docx: 至少需要一个内容块");
  const doc = officegen("docx", {});
  if (spec.title) {
    const heading = doc.createP({ align: "center" });
    heading.addText(stringOf(spec.title, 200), { bold: true, fontSize: 26 });
  }
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "heading") {
      const p = doc.createP();
      const level = block.level === 1 || block.level === 2 || block.level === 3 ? block.level : 2;
      p.addText(stringOf(block.text, 2000), { bold: true, fontSize: level === 1 ? 20 : level === 2 ? 16 : 14 });
      continue;
    }
    if (block.type === "paragraph") {
      const p = doc.createP();
      p.addText(stringOf(block.text, 20_000));
      continue;
    }
    if (block.type === "bullets") {
      const items = Array.isArray(block.items) ? block.items.slice(0, 200) : [];
      for (const item of items) {
        const p = doc.createP();
        p.addText(`• ${stringOf(item, 2000)}`);
      }
      continue;
    }
    if (block.type === "table") {
      const headers = Array.isArray(block.headers) ? block.headers.slice(0, LIMITS.tableCols) : [];
      const rows = Array.isArray(block.rows) ? block.rows.slice(0, LIMITS.tableRows) : [];
      if (!headers.length && !rows.length) continue;
      const cols = Math.max(headers.length, ...rows.map((row) => (Array.isArray(row) ? row.length : 0)));
      if (cols > LIMITS.tableCols) bad(`docx: 表格最多 ${LIMITS.tableCols} 列`);
      const data: Array<Array<string | number | { val: string; opts?: Record<string, unknown> }>> = [];
      if (headers.length) {
        data.push(headers.map((cell) => ({ val: stringOf(String(cell), 1000), opts: { b: true } })));
      }
      for (const row of rows) {
        const cells = Array.isArray(row) ? row : [];
        data.push(Array.from({ length: cols }, (_, index) => String(cells[index] ?? "").slice(0, 1000)));
      }
      doc.createTable(data, { borders: true, tableColWidth: 4800 });
    }
  }
  return collect(doc);
}

/** Excel: one or more sheets, optional header row, column widths. */
export async function buildXlsx(spec: XlsxSpec): Promise<Uint8Array> {
  const sheets = Array.isArray(spec.sheets) ? spec.sheets : bad("xlsx: sheets 必须是数组");
  if (!sheets.length) bad("xlsx: 至少需要一个工作表");
  if (sheets.length > LIMITS.sheets) bad(`xlsx: 最多 ${LIMITS.sheets} 个工作表`);
  const doc = officegen("xlsx", {});
  const used = new Set<string>();
  for (const [index, sheet] of sheets.entries()) {
    if (!sheet || typeof sheet !== "object") continue;
    const rows = Array.isArray(sheet.rows) ? sheet.rows.slice(0, LIMITS.sheetRows) : [];
    const columns = Array.isArray(sheet.columns) ? sheet.columns.slice(0, LIMITS.sheetCols) : [];
    const width = Math.max(columns.length, ...rows.map((row) => (Array.isArray(row) ? row.length : 0)));
    if (width > LIMITS.sheetCols) bad(`xlsx: 每个工作表最多 ${LIMITS.sheetCols} 列`);
    let name = stringOf(sheet.name, 31).replace(/[\\/*?:[\]]/g, "-").trim() || `Sheet${index + 1}`;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name}-${n}`)) n += 1;
      name = `${name}-${n}`;
    }
    used.add(name);
    const target = doc.makeNewSheet();
    target.name = name;
    for (let column = 0; column < width; column += 1) target.setColumnWidth(columnName(column), 18);
    const data: Array<Array<string | number | undefined>> = [];
    if (columns.length) data.push(columns.map((cell) => (typeof cell === "number" ? cell : stringOf(String(cell), 1000))));
    for (const row of rows) {
      const cells = Array.isArray(row) ? row : [];
      data.push(Array.from({ length: width }, (_, column) => {
        const value = cells[column];
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (value === null || value === undefined) return "";
        return String(value).slice(0, 4000);
      }));
    }
    target.data = data;
  }
  return collect(doc);
}

/** PowerPoint: one title + bullet list per slide. */
export async function buildPptx(spec: PptxSpec): Promise<Uint8Array> {
  const slides = Array.isArray(spec.slides) ? spec.slides : bad("pptx: slides 必须是数组");
  if (!slides.length) bad("pptx: 至少需要一页幻灯片");
  if (slides.length > LIMITS.slides) bad(`pptx: 最多 ${LIMITS.slides} 页`);
  const doc = officegen("pptx", {});
  if (spec.title) {
    const cover = doc.makeNewSlide();
    cover.addText(stringOf(spec.title, 200), { bold: true, fontSize: 32 });
  }
  for (const item of slides) {
    if (!item || typeof item !== "object") continue;
    const slide = doc.makeNewSlide();
    slide.addText(stringOf(item.title, 200), { bold: true, fontSize: 28 });
    const bullets = Array.isArray(item.bullets) ? item.bullets.slice(0, LIMITS.bullets) : [];
    for (const bullet of bullets) slide.addText(`• ${stringOf(String(bullet), 1000)}`, { fontSize: 18 });
  }
  return collect(doc);
}
