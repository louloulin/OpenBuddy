import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
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

/**
 * Slide blocks mirror the UpUp `DeckSpec` (schemaVersion 1) so an industry-analysis deck can be passed
 * straight through; `bullets` stays supported for the original title+bullets slides.
 */
export type PptxBlock =
  | { kind: "bullets"; items: string[] }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; headers: string[]; rows: Array<Array<string | number>>; caption?: string; sourceId?: string }
  | { kind: "chart"; chartType: "column" | "line" | "pie"; title: string; categories: string[]; series: Array<{ name: string; values: number[] }>; unit?: string; sourceId?: string }
  | { kind: "kpi"; items: Array<{ label: string; value: string; delta?: string }> }
  | { kind: "image"; path: string; alt?: string }
  | { kind: "note"; text: string; tone: "assumption" | "inference" | "disclaimer" }
  | { kind: "mermaid"; source: string; caption?: string };

export type PptxLayout = "cover" | "section" | "content" | "comparison" | "table" | "chart" | "kpi";

export interface PptxSlideSpec {
  title: string;
  bullets?: string[];
  kicker?: string;
  layout?: PptxLayout;
  blocks?: PptxBlock[];
  speakerNotes?: string;
}

export interface PptxSource {
  id: string;
  name: string;
  url?: string;
  asOf: string;
}

export interface PptxSpec {
  title?: string;
  subtitle?: string;
  asOf?: string;
  sources?: PptxSource[];
  slides: PptxSlideSpec[];
}

export interface PptxBuildOptions {
  /** Maps an image block path to an absolute, already-authorised file path; null skips the image. */
  resolveImage?: (path: string) => string | null;
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
  blocks: 12,
  slideTableRows: 14,
  slideTableCols: 12,
  chartCategories: 24,
  chartSeries: 6,
  kpis: 6,
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

const CONTINUED = /（续 \d+\/\d+）$/;

const MERMAID_ROWS = 40;
const csvCells = (line: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { cells.push(current); current = ""; }
    else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
};
const nodeText = (label: string) => label.replace(/<br\s*\/?>/gi, " · ").replace(/\s+/g, " ").trim();

/**
 * Data behind a mermaid diagram as a table, for exports that cannot render mermaid (PPTX / Word / Excel).
 * Supports `sankey-beta` (来源 / 去向 / 数值), `timeline` (时间 / 事件) and `flowchart` / `graph`
 * edges (上游 / 下游, node labels resolved). Anything else returns null and the caller keeps a text note.
 */
export function mermaidTable(source: string): { headers: string[]; rows: (string | number)[][] } | null {
  const lines = String(source ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  const head = lines[0]?.toLowerCase() ?? "";
  if (head.startsWith("sankey")) {
    const rows = lines.slice(1).map(csvCells).filter((cells) => cells.length === 3 && cells[0] && cells[1] && Number.isFinite(Number(cells[2])))
      .map(([from, to, value]) => [from!, to!, Number(value)]);
    return rows.length ? { headers: ["来源", "去向", "数值"], rows: rows.slice(0, MERMAID_ROWS) } : null;
  }
  if (head.startsWith("timeline")) {
    const rows: string[][] = [];
    for (const line of lines.slice(1)) {
      if (/^(title|section)\b/i.test(line)) continue;
      const [time, ...events] = line.split(/\s+:\s+|\s*:\s*/);
      if (!time || !events.length) continue;
      rows.push([time === "·" ? "" : time, events.filter(Boolean).join("；")]);
    }
    return rows.length ? { headers: ["时间", "事件"], rows: rows.slice(0, MERMAID_ROWS) } : null;
  }
  if (/^(flowchart|graph)\b/.test(head)) {
    const labels = new Map<string, string>();
    const node = /([A-Za-z_][\w-]*)\s*(?:\[\"?(.*?)\"?\]|\(\"?(.*?)\"?\)|\{\"?(.*?)\"?\})/g;
    for (const line of lines.slice(1)) for (const match of line.matchAll(node)) {
      const label = match[2] ?? match[3] ?? match[4];
      if (label) labels.set(match[1]!, nodeText(label));
    }
    const rows: string[][] = [];
    for (const line of lines.slice(1)) {
      const ids = line.replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, "").split(/\s*(?:-->|---|-\.->|==>)(?:\|[^|]*\|)?\s*/).map((id) => id.trim()).filter(Boolean);
      for (let index = 1; index < ids.length; index += 1) rows.push([labels.get(ids[index - 1]!) ?? ids[index - 1]!, labels.get(ids[index]!) ?? ids[index]!]);
    }
    return rows.length ? { headers: ["上游", "下游"], rows: rows.slice(0, MERMAID_ROWS) } : null;
  }
  return null;
}

/**
 * Same-source xlsx for a deck: every table becomes a sheet (continuation pages `（续 n/m）` are merged back),
 * every chart becomes a data sheet, and a 来源 sheet lists the sources. Only values already in the deck are
 * written; empty tables/charts are skipped.
 */
export function deckSpecToXlsx(spec: PptxSpec): XlsxSpec {
  const sheets: XlsxSheetSpec[] = [];
  const charts: XlsxSheetSpec[] = [];
  const byTitle = new Map<string, XlsxSheetSpec>();
  for (const slide of Array.isArray(spec.slides) ? spec.slides : []) {
    const base = stringOf(slide?.title, 200).replace(CONTINUED, "").trim() || "表";
    for (const block of Array.isArray(slide?.blocks) ? slide.blocks : []) {
      if (block?.kind === "table" && Array.isArray(block.rows) && block.rows.length) {
        const existing = byTitle.get(base);
        if (existing && JSON.stringify(existing.columns) === JSON.stringify(block.headers)) {
          existing.rows.push(...block.rows);
          continue;
        }
        const sheet: XlsxSheetSpec = { name: base, columns: [...(block.headers ?? [])], rows: [...block.rows] };
        byTitle.set(base, sheet);
        sheets.push(sheet);
      } else if (block?.kind === "mermaid") {
        const table = mermaidTable(block.source);
        if (table) charts.push({ name: `图-${stringOf(base, 28)}`, columns: table.headers, rows: table.rows });
      } else if (block?.kind === "chart" && Array.isArray(block.categories) && block.categories.length && Array.isArray(block.series) && block.series.length) {
        const unit = block.unit ? `（${block.unit}）` : "";
        charts.push({
          name: `图-${stringOf(block.title, 28)}`,
          columns: ["类别", ...block.series.map((series) => `${stringOf(series.name, 60)}${unit}`)],
          rows: block.categories.map((category, index) => [category, ...block.series.map((series) => series.values[index])]),
        });
      }
    }
  }
  if (spec.sources?.length) sheets.push({ name: "来源", columns: ["id", "来源", "取数日", "链接"], rows: spec.sources.map((source) => [source.id, source.name, source.asOf, source.url ?? ""]) });
  // 工作表上限内优先保留表格与来源，图表数据表排在最后。
  const all = [...sheets, ...charts];
  if (!all.length) bad("xlsx: 报告规格里没有可导出的表格或图表");
  return { sheets: all.slice(0, LIMITS.sheets) };
}

const NOTE_PREFIX = { assumption: "【假设】", inference: "【推断】", disclaimer: "【声明】" } as const;

/**
 * Same-source Word report for a deck: section slides become level-1 headings, other slides level-2
 * headings; tables keep their rows (continuation pages merged), charts become data tables, notes keep
 * their 假设/推断/声明 label, and speaker notes follow as paragraphs. Nothing is added that the deck
 * does not already contain.
 */
export function deckSpecToDocx(spec: PptxSpec): DocxSpec {
  const blocks: DocxBlock[] = [];
  const sources = new Map((spec.sources ?? []).map((source) => [source.id, source]));
  const sourceLine = (id: string | undefined) => {
    const source = id ? sources.get(id) : undefined;
    return source ? `来源：${source.name}（${source.asOf}）` : "";
  };
  if (spec.subtitle) blocks.push({ type: "paragraph", text: stringOf(spec.subtitle, 400) });
  if (spec.asOf) blocks.push({ type: "paragraph", text: `数据截止：${stringOf(spec.asOf, 20)}` });
  let lastTable: { title: string; block: Extract<DocxBlock, { type: "table" }> } | null = null;
  for (const slide of Array.isArray(spec.slides) ? spec.slides : []) {
    if (slide?.layout === "cover") continue;
    const title = stringOf(slide?.title, 200);
    const base = title.replace(CONTINUED, "").trim();
    const continued = base !== title;
    if (!continued) {
      blocks.push({ type: "heading", text: base || "（无标题）", level: slide?.layout === "section" ? 1 : 2 });
      lastTable = null;
    }
    if (Array.isArray(slide?.bullets) && slide.bullets.length) blocks.push({ type: "bullets", items: slide.bullets.map((item) => stringOf(item, 600)) });
    for (const block of Array.isArray(slide?.blocks) ? slide.blocks : []) {
      switch (block?.kind) {
        case "bullets": if (block.items?.length) blocks.push({ type: "bullets", items: block.items.map((item) => stringOf(item, 600)) }); break;
        case "paragraph": if (block.text) blocks.push({ type: "paragraph", text: stringOf(block.text, 4000) }); break;
        case "note": if (block.text) blocks.push({ type: "paragraph", text: `${NOTE_PREFIX[block.tone] ?? NOTE_PREFIX.disclaimer}${stringOf(block.text, 4000)}` }); break;
        case "kpi": if (block.items?.length) blocks.push({ type: "bullets", items: block.items.map((item) => `${stringOf(item.label, 60)}：${stringOf(item.value, 40) || "—"}${item.delta ? `（${stringOf(item.delta, 80)}）` : ""}`) }); break;
        case "table": {
          if (!Array.isArray(block.rows) || !block.rows.length) break;
          if (continued && lastTable && lastTable.title === base && JSON.stringify(lastTable.block.headers) === JSON.stringify(block.headers)) {
            lastTable.block.rows.push(...block.rows);
            break;
          }
          const table: Extract<DocxBlock, { type: "table" }> = { type: "table", headers: [...(block.headers ?? [])], rows: [...block.rows] };
          blocks.push(table);
          lastTable = { title: base, block: table };
          const caption = [block.caption, sourceLine(block.sourceId)].filter(Boolean).join(" ｜ ");
          if (caption) blocks.push({ type: "paragraph", text: caption });
          break;
        }
        case "chart": {
          if (!Array.isArray(block.categories) || !block.categories.length || !Array.isArray(block.series) || !block.series.length) break;
          blocks.push({ type: "paragraph", text: `图：${stringOf(block.title, 120)}${block.unit ? `（${block.unit}）` : ""}` });
          blocks.push({ type: "table", headers: ["类别", ...block.series.map((series) => stringOf(series.name, 60))], rows: block.categories.map((category, index) => [category, ...block.series.map((series) => series.values[index] ?? "")]) });
          const source = sourceLine(block.sourceId);
          if (source) blocks.push({ type: "paragraph", text: source });
          break;
        }
        case "mermaid": {
          const table = mermaidTable(block.source);
          blocks.push({ type: "paragraph", text: `图示：${stringOf(block.caption, 200) || "流程图"}（${table ? "Word 中以数据表呈现" : "Word 中不渲染"}，图形见报告预览）` });
          if (table) blocks.push({ type: "table", headers: table.headers, rows: table.rows });
          break;
        }
        case "image": blocks.push({ type: "paragraph", text: `图片：${stringOf(block.alt ?? block.path, 200)}` }); break;
        default: break;
      }
    }
    if (slide?.speakerNotes) blocks.push({ type: "paragraph", text: stringOf(slide.speakerNotes, 8000) });
  }
  if (blocks.length > LIMITS.docxBlocks) bad(`docx: 报告规格展开后超过 ${LIMITS.docxBlocks} 个内容块`);
  return { ...(spec.title ? { title: stringOf(spec.title, 200) } : {}), blocks };
}

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

const SLIDE_W = 12_192_000; // 16:9 widescreen, EMU
const SLIDE_H = 6_858_000;
const MARGIN = 457_200;
const BODY_W = SLIDE_W - MARGIN * 2;
const BODY_TOP = 1_325_880;
const BODY_BOTTOM = SLIDE_H - 502_920;
const GAP = 137_160;
const FONT = "Microsoft YaHei";
const COLOR = {
  ink: "1F2937",
  muted: "6B7280",
  accent: "1F4E79",
  headerText: "FFFFFF",
  rowAlt: "F3F6FA",
  kpiFill: "EEF3F9",
  assumption: "FFF4E5",
  inference: "EAF2FB",
  disclaimer: "F3F4F6",
} as const;
const NOTE_LABEL = { assumption: "假设", inference: "推断", disclaimer: "声明" } as const;

const emu = (value: number): string => `${Math.max(0, Math.round(value))}emu`;

type PptxDoc = ReturnType<typeof officegen>;
type SlideHandle = {
  addText(text: string, options: Record<string, unknown>): void;
  addTable(rows: Array<Array<string | { val: string; opts?: Record<string, unknown> }>>, options: Record<string, unknown>): void;
  addChart(data: Record<string, unknown>, done: () => void, fail?: (error: unknown) => void): void;
  addImage(path: string, options: Record<string, unknown>): void;
  setSpeakerNote?: (text: string) => void;
};

interface RenderState {
  readonly doc: { makeNewSlide(): SlideHandle };
  readonly charts: Promise<void>[];
  readonly sources: ReadonlyMap<string, PptxSource>;
  readonly options: PptxBuildOptions;
}

const textBox = (slide: SlideHandle, value: string, x: number, y: number, cx: number, cy: number, style: Record<string, unknown> = {}): void => {
  slide.addText(value, { x: emu(x), y: emu(y), cx: emu(cx), cy: emu(cy), font_face: FONT, font_size: 16, color: COLOR.ink, ...style });
};

const cellText = (value: unknown): string => {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  return stringOf(String(value ?? ""), 400) || "—";
};

const lineCount = (value: string, perLine: number): number =>
  value.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);

/** Estimated height (EMU) a block needs; charts and images take what is left. */
const blockHeight = (block: PptxBlock, rows?: number): number => {
  switch (block.kind) {
    case "bullets":
      return block.items.reduce((sum, item) => sum + lineCount(String(item), 58) * 320_040, 0) + 91_440;
    case "paragraph":
      return lineCount(block.text, 64) * 320_040 + 91_440;
    case "table":
      return ((rows ?? block.rows.length) + 1) * 338_328 + (block.caption ? 274_320 : 0);
    case "kpi":
      return 1_097_280;
    case "note":
      return lineCount(block.text, 80) * 274_320 + 137_160;
    case "mermaid":
      return 548_640;
    case "chart":
      return 2_743_200;
    case "image":
      return 2_286_000;
    default:
      return 0;
  }
};

class SlideCursor {
  private slide: SlideHandle | null = null;
  private y = BODY_TOP;
  private charted = false;
  private page = 0;
  private readonly usedSources = new Set<string>();

  constructor(
    private readonly state: RenderState,
    private readonly spec: PptxSlideSpec,
  ) {}

  private open(): SlideHandle {
    if (this.slide) return this.slide;
    const slide = this.state.doc.makeNewSlide();
    this.page += 1;
    if (this.spec.kicker) textBox(slide, stringOf(this.spec.kicker, 60), MARGIN, 228_600, BODY_W, 320_040, { font_size: 12, color: COLOR.accent, bold: true });
    const title = stringOf(this.spec.title, 200) + (this.page > 1 ? "（续）" : "");
    textBox(slide, title, MARGIN, 502_920, BODY_W, 731_520, { font_size: 26, bold: true });
    if (this.page === 1 && this.spec.speakerNotes && typeof slide.setSpeakerNote === "function") slide.setSpeakerNote(stringOf(this.spec.speakerNotes, 8000));
    this.slide = slide;
    this.y = BODY_TOP;
    this.charted = false;
    return slide;
  }

  /** Closes the physical slide: prints the source footer for the numbers it showed. */
  close(): void {
    if (!this.slide) return;
    const names = [...this.usedSources].map((id) => this.state.sources.get(id)).filter((source): source is PptxSource => Boolean(source));
    if (names.length) {
      const footer = `来源：${names.map((source) => `${source.name}（${source.asOf}）`).join("；")}`;
      textBox(this.slide, stringOf(footer, 400), MARGIN, SLIDE_H - 457_200, BODY_W, 320_040, { font_size: 10, color: COLOR.muted });
    }
    this.usedSources.clear();
    this.slide = null;
  }

  /** Returns the slide and top y for a block of the given height, breaking to a continuation slide when needed. */
  private reserve(height: number, flexible = false): { slide: SlideHandle; y: number; height: number } {
    let slide = this.open();
    const room = BODY_BOTTOM - this.y;
    if (height > room && this.y > BODY_TOP) {
      if (!flexible || room < 1_828_800) {
        this.close();
        slide = this.open();
      }
    }
    const available = BODY_BOTTOM - this.y;
    const used = flexible ? Math.max(Math.min(available, height * 1.4), Math.min(height, available)) : Math.min(height, available);
    const y = this.y;
    this.y += used + GAP;
    return { slide, y, height: used };
  }

  private noteSource(sourceId: string | undefined): void {
    if (sourceId && this.state.sources.has(sourceId)) this.usedSources.add(sourceId);
  }

  bullets(items: readonly string[]): void {
    const clean = items.map((item) => stringOf(String(item), 1000)).filter(Boolean).slice(0, LIMITS.bullets);
    if (!clean.length) return;
    const { slide, y, height } = this.reserve(blockHeight({ kind: "bullets", items: clean }));
    textBox(slide, clean.map((item) => `• ${item}`).join("\n"), MARGIN, y, BODY_W, height, { font_size: 16 });
  }

  paragraph(text: string): void {
    const value = stringOf(text, 4000);
    if (!value) return;
    const { slide, y, height } = this.reserve(blockHeight({ kind: "paragraph", text: value }));
    textBox(slide, value, MARGIN, y, BODY_W, height, { font_size: 16 });
  }

  note(text: string, tone: keyof typeof NOTE_LABEL): void {
    const value = `${NOTE_LABEL[tone] ?? "说明"}｜${stringOf(text, 1000)}`;
    const { slide, y, height } = this.reserve(blockHeight({ kind: "note", text: value, tone }));
    textBox(slide, value, MARGIN, y, BODY_W, height, { font_size: 12, color: COLOR.muted, fill: COLOR[tone] ?? COLOR.disclaimer });
  }

  table(block: Extract<PptxBlock, { kind: "table" }>): void {
    const headers = (Array.isArray(block.headers) ? block.headers : []).slice(0, LIMITS.slideTableCols).map(cellText);
    const width = Math.max(headers.length, ...(Array.isArray(block.rows) ? block.rows : []).map((row) => (Array.isArray(row) ? Math.min(row.length, LIMITS.slideTableCols) : 0)));
    if (!width) return;
    const rows = (Array.isArray(block.rows) ? block.rows : []).slice(0, LIMITS.tableRows).map((row) => Array.from({ length: width }, (_, index) => cellText(Array.isArray(row) ? row[index] : "")));
    const fontSize = width > 8 ? 10 : width > 5 ? 12 : 14;
    const columnWidth = Math.floor(BODY_W / width);
    const base = { font_size: fontSize, font_face: FONT, align: "l" };
    for (let start = 0; start < Math.max(rows.length, 1); start += LIMITS.slideTableRows) {
      const page = rows.slice(start, start + LIMITS.slideTableRows);
      const { slide, y } = this.reserve(blockHeight(block, page.length));
      const header = (headers.length ? headers : Array.from({ length: width }, () => "")).concat(Array.from({ length: Math.max(0, width - headers.length) }, () => ""));
      const data = [
        header.map((cell) => ({ val: cell, opts: { ...base, bold: "1", fill_color: COLOR.accent, font_color: COLOR.headerText } })),
        ...page.map((row, index) => row.map((cell) => (index % 2 === 1 ? { val: cell, opts: { ...base, fill_color: COLOR.rowAlt } } : { val: cell, opts: base }))),
      ];
      slide.addTable(data, { ...base, x: MARGIN, y, cx: BODY_W, columnWidth, rowHeight: 338_328 });
      if (block.caption && start === 0) textBox(slide, stringOf(block.caption, 200), MARGIN, y + (page.length + 1) * 338_328 + 27_432, BODY_W, 246_888, { font_size: 11, color: COLOR.muted });
      this.noteSource(block.sourceId);
    }
  }

  kpi(items: Extract<PptxBlock, { kind: "kpi" }>["items"]): void {
    const usable = (Array.isArray(items) ? items : []).slice(0, LIMITS.kpis);
    if (!usable.length) return;
    const { slide, y, height } = this.reserve(blockHeight({ kind: "kpi", items: usable }));
    const cardW = Math.floor((BODY_W - GAP * (usable.length - 1)) / usable.length);
    usable.forEach((item, index) => {
      const x = MARGIN + index * (cardW + GAP);
      const lines = [stringOf(String(item.value ?? "—"), 40), stringOf(String(item.label ?? ""), 60), item.delta ? stringOf(String(item.delta), 80) : ""].filter(Boolean);
      textBox(slide, lines.join("\n"), x, y, cardW, height, { font_size: 18, bold: true, color: COLOR.accent, fill: COLOR.kpiFill, align: "center" });
    });
  }

  chart(block: Extract<PptxBlock, { kind: "chart" }>): void {
    const categories = (Array.isArray(block.categories) ? block.categories : []).slice(0, LIMITS.chartCategories).map((item) => stringOf(String(item), 60));
    const series = (Array.isArray(block.series) ? block.series : []).slice(0, block.chartType === "pie" ? 1 : LIMITS.chartSeries)
      .map((entry) => ({ name: stringOf(String(entry?.name ?? ""), 60) || "系列", values: categories.map((_, index) => Number(entry?.values?.[index])) }))
      .filter((entry) => entry.values.every((value) => Number.isFinite(value)));
    if (!categories.length || !series.length) {
      this.note(`图表「${stringOf(block.title, 80)}」缺少可绘制的数据，未生成。`, "disclaimer");
      return;
    }
    // officegen's chart frame binds to the slide's first relationship, so each physical slide carries one chart.
    if (this.charted) this.close();
    const { slide, y, height } = this.reserve(blockHeight(block), true);
    this.charted = true;
    // officegen 0.6.5 ships native column / line / pie chart frames (lib/pptx/charts.js).
    const renderType = block.chartType === "pie" ? "pie" : block.chartType === "line" ? "line" : "column";
    const title = `${stringOf(block.title, 120)}${block.unit ? `（${stringOf(block.unit, 16)}）` : ""}`;
    // officegen swallows workbook.save errors (e.g. ENOSPC) without calling back: fail instead of hanging.
    this.state.charts.push(new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pptx: 图表数据写入临时目录失败（超时）")), 15_000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const fail = (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      slide.addChart({
        title,
        renderType,
        x: MARGIN,
        y,
        cx: BODY_W,
        cy: height,
        data: series.map((entry) => ({ name: entry.name, labels: categories, values: entry.values })),
      }, done, fail);
    }));
    this.noteSource(block.sourceId);
  }

  image(block: Extract<PptxBlock, { kind: "image" }>): void {
    const resolved = this.state.options.resolveImage?.(String(block.path ?? "")) ?? null;
    if (!resolved) {
      this.note(`图片「${stringOf(block.alt ?? block.path, 120)}」未导出（路径不在工作区或不可读）。`, "disclaimer");
      return;
    }
    const { slide, y, height } = this.reserve(blockHeight(block), true);
    slide.addImage(resolved, { x: emu(MARGIN), y: emu(y), cx: emu(Math.min(BODY_W, height * 1.6)), cy: emu(height) });
  }

  mermaid(block: Extract<PptxBlock, { kind: "mermaid" }>): void {
    const table = mermaidTable(block.source);
    if (table) {
      this.table({ kind: "table", headers: table.headers, rows: table.rows, caption: `${block.caption ? `${stringOf(block.caption, 120)}；` : ""}图形在工作台预览（DeckPreview）中渲染，PPTX 以数据表呈现` });
      return;
    }
    this.note(`${block.caption ? `${stringOf(block.caption, 120)}：` : ""}流程图在工作台预览（DeckPreview）中渲染，PPTX 导出保留文字说明。`, "inference");
  }
}

/**
 * officegen 0.6.5 opens each chart workbook with a lazy ReadStream and then calls `fs.unlinkSync` on it in
 * the same tick, so the stream fails with ENOENT. While a deck is packaged we skip deletions inside our own
 * temp directories (they are removed as a whole afterwards); every other path is deleted normally.
 */
const guardedRoots = new Set<string>();
let originalUnlinkSync: typeof fs.unlinkSync | null = null;
const deferUnlinkUnder = (root: string): (() => void) => {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  guardedRoots.add(prefix);
  if (!originalUnlinkSync) {
    const original = fs.unlinkSync;
    originalUnlinkSync = original;
    fs.unlinkSync = ((target: fs.PathLike) => {
      const value = String(target);
      for (const guarded of guardedRoots) if (value.startsWith(guarded)) return;
      original(target);
    }) as typeof fs.unlinkSync;
  }
  return () => {
    guardedRoots.delete(prefix);
    if (!guardedRoots.size && originalUnlinkSync) {
      fs.unlinkSync = originalUnlinkSync;
      originalUnlinkSync = null;
    }
  };
};

const renderCover = (state: RenderState, spec: PptxSpec, slideSpec: PptxSlideSpec | null): void => {
  const slide = state.doc.makeNewSlide();
  const title = stringOf(slideSpec?.title ?? spec.title ?? "", 200);
  textBox(slide, title, MARGIN, 2_011_680, BODY_W, 1_097_280, { font_size: 36, bold: true, color: COLOR.accent, align: "center" });
  const lines = [
    spec.subtitle ? stringOf(spec.subtitle, 200) : "",
    ...(slideSpec?.blocks ?? []).flatMap((block) => (block.kind === "paragraph" ? [stringOf(block.text, 400)] : block.kind === "bullets" ? block.items.map((item) => stringOf(String(item), 200)) : [])),
    ...(slideSpec?.bullets ?? []).map((item) => stringOf(String(item), 200)),
    spec.asOf ? `数据截止 ${stringOf(spec.asOf, 20)}` : "",
  ].filter(Boolean);
  if (lines.length) textBox(slide, lines.join("\n"), MARGIN, 3_200_400, BODY_W, 1_280_160, { font_size: 18, color: COLOR.muted, align: "center" });
  if (slideSpec?.speakerNotes && typeof slide.setSpeakerNote === "function") slide.setSpeakerNote(stringOf(slideSpec.speakerNotes, 8000));
};

const renderSection = (state: RenderState, slideSpec: PptxSlideSpec): void => {
  const slide = state.doc.makeNewSlide();
  if (slideSpec.kicker) textBox(slide, stringOf(slideSpec.kicker, 60), MARGIN, 2_103_120, BODY_W, 365_760, { font_size: 14, bold: true, color: COLOR.accent });
  textBox(slide, stringOf(slideSpec.title, 200), MARGIN, 2_514_600, BODY_W, 914_400, { font_size: 34, bold: true });
  const text = (slideSpec.blocks ?? []).flatMap((block) => (block.kind === "paragraph" || block.kind === "note" ? [stringOf(block.text, 600)] : [])).join("\n");
  if (text) textBox(slide, text, MARGIN, 3_520_440, BODY_W, 1_005_840, { font_size: 16, color: COLOR.muted });
};

const renderSlide = (state: RenderState, slideSpec: PptxSlideSpec): void => {
  const cursor = new SlideCursor(state, slideSpec);
  const blocks = Array.isArray(slideSpec.blocks) ? slideSpec.blocks.slice(0, LIMITS.blocks) : [];
  const legacy = Array.isArray(slideSpec.bullets) ? slideSpec.bullets : [];
  if (legacy.length) cursor.bullets(legacy);
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    switch (block.kind) {
      case "bullets":
        cursor.bullets(Array.isArray(block.items) ? block.items : []);
        break;
      case "paragraph":
        cursor.paragraph(String(block.text ?? ""));
        break;
      case "note":
        cursor.note(String(block.text ?? ""), block.tone in NOTE_LABEL ? block.tone : "disclaimer");
        break;
      case "table":
        cursor.table(block);
        break;
      case "kpi":
        cursor.kpi(block.items);
        break;
      case "chart":
        cursor.chart(block);
        break;
      case "image":
        cursor.image(block);
        break;
      case "mermaid":
        cursor.mermaid(block);
        break;
      default:
        break;
    }
  }
  // A title-only slide still exists as a page.
  if (!legacy.length && !blocks.length) cursor.paragraph(" ");
  cursor.close();
};

/**
 * PowerPoint: 16:9 deck. Each slide may carry plain `bullets` or typed `blocks` (table / native chart /
 * KPI cards / notes / images). Content that does not fit flows onto a continuation slide.
 */
export async function buildPptx(spec: PptxSpec, options: PptxBuildOptions = {}): Promise<Uint8Array> {
  const slides = Array.isArray(spec.slides) ? spec.slides : bad("pptx: slides 必须是数组");
  if (!slides.length) bad("pptx: 至少需要一页幻灯片");
  if (slides.length > LIMITS.slides) bad(`pptx: 最多 ${LIMITS.slides} 页`);
  const usesCharts = slides.some((slide) => Array.isArray(slide?.blocks) && slide.blocks.some((block) => block?.kind === "chart"));
  // officegen writes each chart's embedded workbook to tempDir before packaging; keep it out of the cwd.
  const tempDir = usesCharts ? await mkdtemp(join(tmpdir(), "ob-pptx-")) : null;
  try {
    const doc = (tempDir ? officegen({ type: "pptx", tempDir: `${tempDir}${sep}` }) : officegen("pptx")) as PptxDoc & { setWidescreen?: (wide: boolean) => void; makeNewSlide(): SlideHandle };
    doc.setWidescreen?.(true);
    const sources = new Map((Array.isArray(spec.sources) ? spec.sources : []).filter((source) => source && typeof source.id === "string").map((source) => [source.id, source]));
    const state: RenderState = { doc, charts: [], sources, options };
    const first = slides[0];
    const hasCover = Boolean(first && first.layout === "cover");
    if (spec.title && !hasCover) renderCover(state, spec, null);
    for (const item of slides) {
      if (!item || typeof item !== "object") continue;
      if (item.layout === "cover") renderCover(state, spec, item);
      else if (item.layout === "section") renderSection(state, item);
      else renderSlide(state, item);
    }
    await Promise.all(state.charts);
    if (!tempDir) return await collect(doc);
    const release = deferUnlinkUnder(tempDir);
    try {
      return await collect(doc);
    } finally {
      release();
    }
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}
