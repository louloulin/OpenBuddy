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
    const { labels, edges } = flowchartGraph(lines);
    const name = (id: string) => (labels.has(id) ? nodeText(labels.get(id)!) : id);
    const rows = edges.map(([from, to]) => [name(from), name(to)]);
    return rows.length ? { headers: ["上游", "下游"], rows: rows.slice(0, MERMAID_ROWS) } : null;
  }
  return null;
}

/** Raw node labels (by id, `<br/>` kept) and edges (id pairs, in source order) of a mermaid flowchart. */
const flowchartGraph = (lines: readonly string[]): { labels: Map<string, string>; edges: [string, string][] } => {
  const labels = new Map<string, string>();
  const node = /([A-Za-z_][\w-]*)\s*(?:\[\"?(.*?)\"?\]|\(\"?(.*?)\"?\)|\{\"?(.*?)\"?\})/g;
  for (const line of lines.slice(1)) for (const match of line.matchAll(node)) {
    const label = match[2] ?? match[3] ?? match[4];
    if (label) labels.set(match[1]!, label);
  }
  const edges: [string, string][] = [];
  for (const line of lines.slice(1)) {
    const ids = line.replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, "").split(/\s*(?:-->|---|-\.->|==>)(?:\|[^|]*\|)?\s*/).map((id) => id.trim()).filter(Boolean);
    for (let index = 1; index < ids.length; index += 1) edges.push([ids[index - 1]!, ids[index]!]);
  }
  return { labels, edges };
};

const FLOW_NODES = 6;
const TIMELINE_MILESTONES = 8;

/**
 * A left-to-right flowchart that is a single unbranched chain (A --> B --> C), as display labels
 * (`<br/>` → newline). Returns null for other directions, branches / merges / cycles, isolated nodes,
 * fewer than 2 or more than FLOW_NODES nodes: those stay a data table.
 */
const flowChain = (source: string): string[] | null => {
  const lines = String(source ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  if (!/^(flowchart|graph)\s+lr\b/i.test(lines[0] ?? "")) return null;
  const { labels, edges } = flowchartGraph(lines);
  const next = new Map<string, string>();
  const incoming = new Map<string, number>();
  for (const [from, to] of edges) {
    if (from === to || (next.has(from) && next.get(from) !== to)) return null;
    if (next.get(from) === to) continue;
    next.set(from, to);
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
  }
  if ([...incoming.values()].some((count) => count > 1)) return null;
  const ids = new Set([...labels.keys(), ...edges.flat()]);
  if (ids.size < 2 || ids.size > FLOW_NODES) return null;
  const starts = [...ids].filter((id) => !incoming.has(id));
  if (starts.length !== 1) return null;
  const chain: string[] = [];
  for (let id: string | undefined = starts[0]; id !== undefined && chain.length <= ids.size; id = next.get(id)) chain.push(id);
  if (chain.length !== ids.size) return null;
  return chain.map((id) => flowLabel(labels, id));
};

/** Display label of a flowchart node: `<br/>` → newline, each line capped. */
const flowLabel = (labels: ReadonlyMap<string, string>, id: string): string =>
  (labels.get(id) ?? id).split(/<br\s*\/?>/i).map((part) => stringOf(part.replace(/\s+/g, " ").trim(), 40)).filter(Boolean).join("\n") || id;

const mermaidLines = (source: string): string[] =>
  String(source ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));

/**
 * Longest-path layering of an acyclic graph (Kahn). Returns null on a cycle or self-loop.
 * `edges` must reference ids in `ids`.
 */
const longestPathLayers = (ids: readonly string[], edges: readonly (readonly [string, string])[]): Map<string, number> | null => {
  const succ = new Map(ids.map((id) => [id, [] as string[]]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const [from, to] of edges) {
    if (from === to) return null;
    succ.get(from)!.push(to);
    indegree.set(to, indegree.get(to)! + 1);
  }
  const layer = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const to of succ.get(id)!) {
      layer.set(to, Math.max(layer.get(to)!, layer.get(id)! + 1));
      indegree.set(to, indegree.get(to)! - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  return visited === ids.length ? layer : null;
};

/** Reorders each layer by the mean position of its neighbours (down, up, down) to cut edge crossings. */
const orderLayers = (layers: string[][], pairs: readonly (readonly [string, string])[]): void => {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const [from, to] of pairs) {
    preds.set(to, [...(preds.get(to) ?? []), from]);
    succs.set(from, [...(succs.get(from) ?? []), to]);
  }
  const sweep = (index: number, neighbours: Map<string, string[]>, ref: readonly string[]) => {
    const position = new Map(ref.map((id, at) => [id, at]));
    const key = (id: string, at: number) => {
      const near = (neighbours.get(id) ?? []).map((other) => position.get(other)).filter((at): at is number => at !== undefined);
      return near.length ? near.reduce((sum, at) => sum + at, 0) / near.length : at;
    };
    layers[index] = layers[index]!.map((id, at) => ({ id, at, key: key(id, at) })).sort((a, b) => a.key - b.key || a.at - b.at).map((entry) => entry.id);
  };
  for (let index = 1; index < layers.length; index += 1) sweep(index, preds, layers[index - 1]!);
  for (let index = layers.length - 2; index >= 0; index -= 1) sweep(index, succs, layers[index + 1]!);
  for (let index = 1; index < layers.length; index += 1) sweep(index, preds, layers[index - 1]!);
};

const FLOW_GRAPH_NODES = 10;
/** Virtual pass-through points that carry an edge across skipped layers start with this prefix. */
const DUMMY = "\u0000";

interface FlowGraph {
  readonly direction: "LR" | "TD";
  /** Node ids per layer, in drawing order; ids starting with DUMMY are edge bends. */
  readonly layers: string[][];
  /** Each edge as the id sequence it passes (source, bends…, target). */
  readonly paths: string[][];
  readonly labels: ReadonlyMap<string, string>;
}

/**
 * A left-to-right or top-down flowchart with branches / merges: acyclic, 2..FLOW_GRAPH_NODES nodes and at
 * least one edge. Edges that skip layers get bend points so they never cross a box. Null otherwise.
 */
const flowGraph = (source: string): FlowGraph | null => {
  const lines = mermaidLines(source);
  const direction = lines[0]?.match(/^(?:flowchart|graph)\s+(LR|TD|TB)\b/i)?.[1]?.toUpperCase();
  if (!direction) return null;
  const { labels, edges: raw } = flowchartGraph(lines);
  const seen = new Set<string>();
  const edges = raw.filter(([from, to]) => {
    const key = `${from}\u0001${to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ids = [...new Set([...labels.keys(), ...edges.flat()])];
  if (!edges.length || ids.length < 2 || ids.length > FLOW_GRAPH_NODES) return null;
  const layer = longestPathLayers(ids, edges);
  if (!layer) return null;
  const layers: string[][] = Array.from({ length: Math.max(...layer.values()) + 1 }, () => []);
  for (const id of ids) layers[layer.get(id)!]!.push(id);
  let bends = 0;
  const paths = edges.map(([from, to]) => {
    const path = [from];
    for (let index = layer.get(from)! + 1; index < layer.get(to)!; index += 1) {
      const bend = `${DUMMY}${bends++}`;
      layers[index]!.push(bend);
      path.push(bend);
    }
    path.push(to);
    return path;
  });
  orderLayers(layers, paths.flatMap((path) => path.slice(1).map((to, at) => [path[at]!, to] as const)));
  return { direction: direction === "LR" ? "LR" : "TD", layers, paths, labels: new Map(ids.map((id) => [id, flowLabel(labels, id)])) };
};

const SANKEY_NODES = 12;

interface SankeyFlow {
  readonly links: readonly { from: string; to: string; raw: string; value: number }[];
  readonly layers: string[][];
  /** Height weight of each node: max(inflow, outflow). */
  readonly weight: ReadonlyMap<string, number>;
  /** Value shown on each node, taken from the source text (exact decimal sum when several links meet). */
  readonly shown: ReadonlyMap<string, string>;
}

/** Exact sum of decimal strings (no float rounding); a single value is returned as written. */
const decimalSum = (values: readonly string[]): string => {
  if (values.length === 1) return values[0]!;
  const parts = values.map((value) => value.match(/^\+?(\d+)(?:\.(\d+))?$/));
  if (parts.some((part) => !part)) return values.join(" + ");
  const scale = Math.max(...parts.map((part) => part![2]?.length ?? 0));
  const total = parts.reduce((sum, part) => sum + BigInt(`${part![1]}${(part![2] ?? "").padEnd(scale, "0")}`), 0n).toString().padStart(scale + 1, "0");
  return scale ? `${total.slice(0, -scale)}.${total.slice(-scale)}` : total;
};

/**
 * A `sankey-beta` diagram as layered nodes: null when a value is not a positive number, a link loops,
 * or there are more than SANKEY_NODES nodes (those stay a data table).
 */
const sankeyFlow = (source: string): SankeyFlow | null => {
  const lines = mermaidLines(source);
  if (!lines[0]?.toLowerCase().startsWith("sankey")) return null;
  const rows = lines.slice(1).map(csvCells).filter((cells) => cells.length === 3 && cells[0] && cells[1] && cells[2] !== "" && Number.isFinite(Number(cells[2])));
  if (!rows.length) return null;
  const links = rows.map(([from, to, raw]) => ({ from: from!, to: to!, raw: raw!, value: Number(raw) }));
  if (links.some((link) => !(link.value > 0))) return null;
  const ids = [...new Set(links.flatMap((link) => [link.from, link.to]))];
  if (ids.length > SANKEY_NODES) return null;
  const layer = longestPathLayers(ids, links.map((link) => [link.from, link.to] as const));
  if (!layer) return null;
  const layers: string[][] = Array.from({ length: Math.max(...layer.values()) + 1 }, () => []);
  for (const id of ids) layers[layer.get(id)!]!.push(id);
  orderLayers(layers, links.map((link) => [link.from, link.to] as const));
  const weight = new Map<string, number>();
  const shown = new Map<string, string>();
  for (const id of ids) {
    const incoming = links.filter((link) => link.to === id);
    const outgoing = links.filter((link) => link.from === id);
    const sum = (list: typeof links) => list.reduce((total, link) => total + link.value, 0);
    weight.set(id, Math.max(sum(incoming), sum(outgoing)));
    shown.set(id, decimalSum((incoming.length ? incoming : outgoing).map((link) => link.raw)));
  }
  return { links, layers, weight, shown };
};

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
  if (all.length <= LIMITS.sheets) return { sheets: all };
  // 超出上限的部分合并到最后一页：每张表依次写「表名行 + 原表头 + 原数据」，不丢数据。
  const overflow = all.slice(LIMITS.sheets - 1);
  const width = Math.max(1, ...overflow.map((sheet) => Math.max(sheet.columns?.length ?? 0, ...sheet.rows.map((row) => row.length))));
  const pad = (cells: Array<string | number | null | undefined>) => ["", ...cells, ...Array<string>(Math.max(0, width - cells.length)).fill("")];
  const rows: XlsxSheetSpec["rows"] = [];
  for (const sheet of overflow) {
    rows.push([sheet.name ?? "", ...Array<string>(width).fill("")]);
    if (sheet.columns?.length) rows.push(pad(sheet.columns));
    for (const row of sheet.rows) rows.push(pad(row));
  }
  const merged: XlsxSheetSpec = { name: "其他表格与图表数据", columns: ["表名", ...Array.from({ length: width }, (_, index) => `列${index + 1}`)], rows };
  return { sheets: [...all.slice(0, LIMITS.sheets - 1), merged] };
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
const KICKER_Y = 228_600;
const KICKER_H = 320_040;
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
  link: "A9BCD6",
} as const;
const NOTE_LABEL = { assumption: "假设", inference: "推断", disclaimer: "声明" } as const;

const emu = (value: number): string => `${Math.max(0, Math.round(value))}emu`;

type PptxDoc = ReturnType<typeof officegen>;
type SlideHandle = {
  addText(text: string, options: Record<string, unknown>): void;
  addTable(rows: Array<Array<string | { val: string; opts?: Record<string, unknown> }>>, options: Record<string, unknown>): void;
  addChart(data: Record<string, unknown>, done: () => void, fail?: (error: unknown) => void): void;
  addImage(path: string, options: Record<string, unknown>): void;
  addShape(shape: string, options: Record<string, unknown>): void;
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

/** A native diagram: x is absolute (EMU), y is relative to the top of the reserved block. */
interface DiagramPlan {
  readonly height: number;
  readonly boxes: { x: number; y: number; w: number; h: number; text: string; style: Record<string, unknown> }[];
  readonly lines: { x1: number; y1: number; x2: number; y2: number; arrow?: boolean; size: number; color: string }[];
}

const PT = 12_700;
const CAPTION_H = 274_320;
/** Tallest diagram that still leaves room for its caption on an empty slide. */
const DIAGRAM_MAX_H = BODY_BOTTOM - BODY_TOP - CAPTION_H;

/** Whether the segment passes through the interior of the box (Liang–Barsky clipping). */
const segmentHitsBox = (x1: number, y1: number, x2: number, y2: number, box: { x: number; y: number; w: number; h: number }): boolean => {
  const [left, top, right, bottom] = [box.x + 1, box.y + 1, box.x + box.w - 1, box.y + box.h - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  let low = 0;
  let high = 1;
  for (const [p, q] of [[-dx, x1 - left], [dx, right - x1], [-dy, y1 - top], [dy, bottom - y1]] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) low = Math.max(low, t);
      else high = Math.min(high, t);
      if (low > high) return false;
    }
  }
  return true;
};

/**
 * Layered layout of a branching flowchart: LR puts layers in columns, TD in rows; boxes are centred in
 * their layer. Edges leave a box mid-side and end with an arrow on the next box; bends cross a skipped
 * layer in their own slot. Null when the boxes would be too narrow or the diagram taller than a slide.
 */
const layoutFlowGraph = (graph: FlowGraph): DiagramPlan | null => {
  const { layers, direction } = graph;
  const along = layers.length;
  const across = Math.max(...layers.map((layer) => layer.length));
  const fontSize = along > 4 || across > 3 ? 12 : 14;
  const lineH = Math.round(fontSize * PT * 1.35);
  const crossGap = 182_880;
  let boxW: number;
  let flowGap: number;
  if (direction === "LR") {
    boxW = Math.min(2_286_000, Math.floor((BODY_W - (along - 1) * 365_760) / along));
    flowGap = along > 1 ? Math.min(1_097_280, Math.floor((BODY_W - along * boxW) / (along - 1))) : 0;
  } else {
    boxW = Math.min(2_286_000, Math.floor((BODY_W - (across - 1) * crossGap) / across));
    flowGap = 320_040;
  }
  if (boxW < 731_520) return null;
  const perLine = Math.max(2, Math.floor((boxW - 182_880) / (fontSize * PT)));
  const boxH = Math.max(548_640, Math.max(...[...graph.labels.values()].map((label) => lineCount(label, perLine))) * lineH + 137_160);
  const height = direction === "LR" ? across * boxH + (across - 1) * crossGap : along * boxH + (along - 1) * flowGap;
  if (height > DIAGRAM_MAX_H) return null;
  const slots = new Map<string, { x: number; y: number; w: number; h: number }>();
  const lengthAlong = along * (direction === "LR" ? boxW : boxH) + (along - 1) * flowGap;
  const x0 = direction === "LR" ? MARGIN + Math.floor((BODY_W - lengthAlong) / 2) : 0;
  layers.forEach((layer, index) => {
    const span = layer.length * (direction === "LR" ? boxH : boxW) + (layer.length - 1) * crossGap;
    layer.forEach((id, at) => {
      slots.set(id, direction === "LR"
        ? { x: x0 + index * (boxW + flowGap), y: Math.floor((height - span) / 2) + at * (boxH + crossGap), w: boxW, h: boxH }
        : { x: MARGIN + Math.floor((BODY_W - span) / 2) + at * (boxW + crossGap), y: index * (boxH + flowGap), w: boxW, h: boxH });
    });
  });
  const boxes = [...graph.labels].map(([id, text]) => ({
    ...slots.get(id)!,
    text,
    style: { shape: "roundRect", font_size: fontSize, fill: COLOR.kpiFill, line: COLOR.accent, line_size: 1, align: "center", bodyProp: { anchor: "ctr", autoFit: false } },
  }));
  const lines: DiagramPlan["lines"] = [];
  const exit = (slot: { x: number; y: number; w: number; h: number }) => (direction === "LR" ? [slot.x + slot.w, slot.y + slot.h / 2] : [slot.x + slot.w / 2, slot.y + slot.h]) as const;
  const entry = (slot: { x: number; y: number; w: number; h: number }) => (direction === "LR" ? [slot.x, slot.y + slot.h / 2] : [slot.x + slot.w / 2, slot.y]) as const;
  for (const path of graph.paths) {
    path.slice(1).forEach((to, at) => {
      const from = slots.get(path[at]!)!;
      const target = slots.get(to)!;
      const bend = to.startsWith(DUMMY);
      const [x1, y1] = exit(from);
      const [x2, y2] = entry(target);
      lines.push({ x1, y1, x2, y2, arrow: !bend, size: 1, color: COLOR.accent });
      if (bend) {
        const [x3, y3] = exit(target);
        lines.push({ x1: x2, y1: y2, x2: x3, y2: y3, size: 1, color: COLOR.accent });
      }
    });
  }
  return { height, boxes, lines };
};

/**
 * Sankey layout: one column per layer, node heights proportional to max(inflow, outflow) on one shared
 * scale (with a minimum that keeps name and value readable), links as lines from the source's band to the
 * target's band, thickness following the flow. Null when nodes would be too narrow, the diagram taller
 * than a slide, or a link would cross another node.
 */
const layoutSankey = (flow: SankeyFlow): DiagramPlan | null => {
  const { layers, weight, shown, links } = flow;
  const along = layers.length;
  const nodeW = Math.min(1_645_920, Math.floor((BODY_W - (along - 1) * 640_080) / along));
  if (nodeW < 822_960) return null;
  const gap = along > 1 ? Math.min(2_743_200, Math.floor((BODY_W - along * nodeW) / (along - 1))) : 0;
  const x0 = MARGIN + Math.floor((BODY_W - (along * nodeW + (along - 1) * gap)) / 2);
  const fontSize = 11;
  const lineH = Math.round(fontSize * PT * 1.3);
  const perLine = Math.max(2, Math.floor((nodeW - 91_440) / (fontSize * PT)));
  const label = (id: string) => `${stringOf(id, 40)}\n${shown.get(id)}`;
  const minH = new Map([...weight.keys()].map((id) => [id, lineCount(label(id), perLine) * lineH + 54_864]));
  const gapY = 137_160;
  const column = (layer: readonly string[], scale: number) => layer.reduce((sum, id) => sum + Math.max(minH.get(id)!, weight.get(id)! * scale), 0) + (layer.length - 1) * gapY;
  const height = Math.max(2_286_000, ...layers.map((layer) => column(layer, 0)));
  if (height > DIAGRAM_MAX_H) return null;
  let low = 0;
  let high = (height / Math.min(...weight.values())) * 2;
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    if (layers.every((layer) => column(layer, mid) <= height)) low = mid;
    else high = mid;
  }
  const rect = new Map<string, { x: number; y: number; w: number; h: number }>();
  layers.forEach((layer, index) => {
    let y = Math.floor((height - column(layer, low)) / 2);
    for (const id of layer) {
      const h = Math.floor(Math.max(minH.get(id)!, weight.get(id)! * low));
      rect.set(id, { x: x0 + index * (nodeW + gap), y, w: nodeW, h });
      y += h + gapY;
    }
  });
  const centre = (id: string) => rect.get(id)!.y + rect.get(id)!.h / 2;
  const bands = new Map<(typeof links)[number], { y1: number; y2: number; thick: number }>();
  const spread = (id: string, list: typeof links, side: "y1" | "y2", other: (link: (typeof links)[number]) => string) => {
    const box = rect.get(id)!;
    const total = list.reduce((sum, link) => sum + link.value, 0);
    let top = box.y;
    for (const link of [...list].sort((a, b) => centre(other(a)) - centre(other(b)))) {
      const band = (box.h * link.value) / total;
      const entry = bands.get(link) ?? { y1: 0, y2: 0, thick: Infinity };
      bands.set(link, { ...entry, [side]: top + band / 2, thick: Math.min(entry.thick, band) });
      top += band;
    }
  };
  for (const id of rect.keys()) {
    spread(id, links.filter((link) => link.from === id), "y1", (link) => link.to);
    spread(id, links.filter((link) => link.to === id), "y2", (link) => link.from);
  }
  const lines = links.map((link) => {
    const band = bands.get(link)!;
    return { x1: rect.get(link.from)!.x + nodeW, y1: band.y1, x2: rect.get(link.to)!.x, y2: band.y2, size: Math.max(1, Math.min(36, Math.round((band.thick * 0.7) / PT))), color: COLOR.link };
  });
  for (const [index, line] of lines.entries()) {
    const ends = [links[index]!.from, links[index]!.to];
    for (const [id, box] of rect) if (!ends.includes(id) && segmentHitsBox(line.x1, line.y1, line.x2, line.y2, box)) return null;
  }
  const boxes = [...rect].map(([id, box]) => ({
    ...box,
    text: label(id),
    style: { shape: "rect", font_size: fontSize, color: COLOR.headerText, fill: COLOR.accent, align: "center", bodyProp: { anchor: "ctr", lIns: "45720emu", rIns: "45720emu", tIns: "18288emu", bIns: "18288emu", autoFit: false } },
  }));
  return { height, boxes, lines };
};

/** Draws a straight line from (x1, y1) to (x2, y2); flips encode the direction, the arrow sits at the end. */
const drawLine = (slide: SlideHandle, line: DiagramPlan["lines"][number], top: number): void => {
  slide.addShape("line", {
    x: emu(Math.min(line.x1, line.x2)),
    y: emu(top + Math.min(line.y1, line.y2)),
    cx: emu(Math.abs(line.x2 - line.x1)),
    cy: emu(Math.abs(line.y2 - line.y1)),
    line: line.color,
    line_size: line.size,
    ...(line.arrow ? { line_tail: "triangle" } : {}),
    ...(line.x2 < line.x1 ? { flip_horizontal: true } : {}),
    ...(line.y2 < line.y1 ? { flip_vertical: true } : {}),
  });
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
    if (this.spec.kicker) textBox(slide, stringOf(this.spec.kicker, 60), MARGIN, KICKER_Y, BODY_W, KICKER_H, { font_size: 12, color: COLOR.accent, bold: true });
    const title = stringOf(this.spec.title, 200) + (this.page > 1 ? "（续）" : "");
    // Kicker 228_600..548_640, title 548_640..1_280_160, body from BODY_TOP (1_325_880): no overlap.
    textBox(slide, title, MARGIN, KICKER_Y + KICKER_H, BODY_W, 731_520, { font_size: 26, bold: true });
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
    // Whole EMU: chart / table frames write these values verbatim, and OOXML coordinates are integers.
    const used = Math.floor(flexible ? Math.max(Math.min(available, height * 1.4), Math.min(height, available)) : Math.min(height, available));
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
      slide.addTable(data, { ...base, x: MARGIN, y, cx: BODY_W, cy: data.length * 338_328, columnWidth, rowHeight: 338_328 });
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

  /** Caption under a native diagram, in the same spot and style as a table caption. */
  private diagramCaption(slide: SlideHandle, caption: string | undefined, y: number): void {
    const value = `${caption ? `${stringOf(caption, 120)}；` : ""}图形在工作台预览中可交互`;
    textBox(slide, value, MARGIN, y + 27_432, BODY_W, 246_888, { font_size: 11, color: COLOR.muted });
  }

  /** Horizontal timeline: one axis line, a rounded marker per milestone, date above and event below. */
  private timeline(rows: readonly (string | number)[][], caption: string | undefined): void {
    const shown = rows.slice(0, TIMELINE_MILESTONES).map(([time, event]) => [stringOf(String(time ?? ""), 20), stringOf(String(event ?? ""), 48) || "—"] as const);
    const slot = Math.floor(BODY_W / shown.length);
    const dateH = 320_040;
    const markerH = 228_600;
    const perLine = Math.max(4, Math.floor((slot - 91_440 - 182_880) / 152_400));
    const eventH = Math.max(...shown.map(([, event]) => lineCount(event, perLine))) * 228_600 + 91_440;
    const total = dateH + markerH + 45_720 + eventH + 274_320;
    const { slide, y } = this.reserve(total);
    const axisY = y + dateH + markerH / 2;
    slide.addShape("line", { x: emu(MARGIN), y: emu(axisY), cx: emu(BODY_W), cy: 0, line: COLOR.muted, line_size: 2 });
    const markerW = Math.min(Math.floor(slot * 0.6), 1_097_280);
    shown.forEach(([time, event], index) => {
      const x = MARGIN + index * slot;
      if (time) textBox(slide, time, x, y, slot, dateH, { font_size: 12, bold: true, color: COLOR.accent, align: "center" });
      slide.addShape("roundRect", { x: emu(x + (slot - markerW) / 2), y: emu(y + dateH), cx: emu(markerW), cy: emu(markerH), fill: COLOR.accent, line: COLOR.accent });
      textBox(slide, event, x + 45_720, y + dateH + markerH + 45_720, slot - 91_440, eventH, { font_size: 12, align: "center" });
    });
    this.diagramCaption(slide, caption, y + dateH + markerH + 45_720 + eventH);
    const rest = rows.slice(TIMELINE_MILESTONES);
    if (rest.length) this.table({ kind: "table", headers: ["时间", "事件"], rows: rest, caption: `时间轴其余 ${rest.length} 项；PPTX 以数据表呈现` });
  }

  /** Left-to-right chain: rounded boxes joined by right arrows. */
  private flow(labels: readonly string[], caption: string | undefined): void {
    const arrowW = 320_040;
    const pad = 64_008;
    const boxW = Math.floor((BODY_W - (labels.length - 1) * (arrowW + pad * 2)) / labels.length);
    const perLine = Math.max(3, Math.floor((boxW - 182_880) / 177_800));
    const boxH = Math.max(731_520, Math.max(...labels.map((label) => lineCount(label, perLine))) * 256_032 + 182_880);
    const { slide, y } = this.reserve(boxH + 274_320);
    labels.forEach((label, index) => {
      const x = MARGIN + index * (boxW + arrowW + pad * 2);
      textBox(slide, label, x, y, boxW, boxH, { shape: "roundRect", font_size: 14, fill: COLOR.kpiFill, line: COLOR.accent, line_size: 1, align: "center", bodyProp: { anchor: "ctr" } });
      if (index < labels.length - 1) slide.addShape("rightArrow", { x: emu(x + boxW + pad), y: emu(y + boxH / 2 - 137_160), cx: emu(arrowW), cy: emu(274_320), fill: COLOR.accent });
    });
    this.diagramCaption(slide, caption, y + boxH);
  }

  /** Draws a laid-out diagram (lines under boxes) with the caption below it. */
  private diagram(plan: DiagramPlan, caption: string | undefined): void {
    const { slide, y } = this.reserve(plan.height + CAPTION_H);
    for (const line of plan.lines) drawLine(slide, line, y);
    for (const box of plan.boxes) textBox(slide, box.text, box.x, y + box.y, box.w, box.h, box.style);
    this.diagramCaption(slide, caption, y + plan.height);
  }

  mermaid(block: Extract<PptxBlock, { kind: "mermaid" }>): void {
    const chain = flowChain(block.source);
    if (chain) {
      this.flow(chain, block.caption);
      return;
    }
    const graph = flowGraph(block.source);
    const graphPlan = graph && layoutFlowGraph(graph);
    if (graphPlan) {
      this.diagram(graphPlan, block.caption);
      return;
    }
    const sankey = sankeyFlow(block.source);
    const sankeyPlan = sankey && layoutSankey(sankey);
    if (sankey && sankeyPlan) {
      this.diagram(sankeyPlan, block.caption);
      // The exact figures follow as a table, as written in the source.
      this.table({ kind: "table", headers: ["来源", "去向", "数值"], rows: sankey.links.map((link) => [link.from, link.to, link.raw]), caption: "桑基图数据" });
      return;
    }
    const table = mermaidTable(block.source);
    if (table && table.headers[0] === "时间") {
      this.timeline(table.rows, block.caption);
      return;
    }
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
