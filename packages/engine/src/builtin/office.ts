import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildDocx, buildPptx, buildXlsx, deckSpecToXlsx } from "@openbuddy/services/office/index";
import type { EngineContext } from "../engine-context.js";

/**
 * 办公产物 (B2b): real .docx / .xlsx / .pptx through `officegen` (OOXML).
 *
 * The tools are ordinary Pi tools, so they go through the permission gate; each one snapshots
 * the target through the checkpoint store before writing and asks the artifact panel to refresh.
 * Content stays in the model's own context: the tool only turns a structured description into
 * bytes, it never calls another model.
 */

export const DOCX_TOOL = "ob_docx";
export const XLSX_TOOL = "ob_xlsx";
export const PPTX_TOOL = "ob_pptx";

const PATH_MAX = 4096;
const FILE_MAX = 40 * 1024 * 1024;

const pathSchema = { type: "string", description: "File path. Relative paths are resolved against the task workspace; the extension is added when missing." };

const DOCX_PARAMETERS = {
  type: "object",
  properties: {
    path: pathSchema,
    title: { type: "string", description: "Optional document title (centered, larger)." },
    blocks: {
      type: "array",
      description: "Ordered content blocks: heading {text,level?}, paragraph {text}, bullets {items}, table {headers,rows}.",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["heading", "paragraph", "bullets", "table"] },
          text: { type: "string" },
          level: { type: "number", enum: [1, 2, 3] },
          items: { type: "array", items: { type: "string" } },
          headers: { type: "array", items: { type: "string" } },
          rows: { type: "array", items: { type: "array", items: { type: ["string", "number"] } } },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
  },
  required: ["path", "blocks"],
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

const XLSX_PARAMETERS = {
  type: "object",
  properties: {
    path: pathSchema,
    sheets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Sheet name (31 chars max; invalid characters are replaced)." },
          columns: { type: "array", items: { type: ["string", "number"] }, description: "Optional header row." },
          rows: { type: "array", items: { type: "array", items: { type: ["string", "number", "null"] } } },
        },
        required: ["rows"],
        additionalProperties: false,
      },
    },
    deck: {
      type: "object",
      description: "Optional UpUp DeckSpec (run_industry_analysis.deckSpec). Its tables (continuation pages merged), chart data and sources become sheets, appended after any explicit sheets.",
    },
  },
  required: ["path"],
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

const PPTX_BLOCK_SCHEMA = {
  type: "object",
  description:
    "Typed slide block: bullets {items}, paragraph {text}, table {headers,rows,caption?,sourceId?}, chart {chartType:column|line|pie,title,categories,series:[{name,values}],unit?,sourceId?}, kpi {items:[{label,value,delta?}]}, note {text,tone:assumption|inference|disclaimer}, image {path (workspace-relative),alt?}, mermaid {source,caption?}.",
  properties: {
    kind: { type: "string", enum: ["bullets", "paragraph", "table", "chart", "kpi", "note", "image", "mermaid"] },
    items: { type: "array" },
    text: { type: "string" },
    headers: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: ["string", "number"] } } },
    caption: { type: "string" },
    sourceId: { type: "string" },
    chartType: { type: "string", enum: ["column", "line", "pie"] },
    title: { type: "string" },
    categories: { type: "array", items: { type: "string" } },
    series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } },
    unit: { type: "string" },
    tone: { type: "string", enum: ["assumption", "inference", "disclaimer"] },
    path: { type: "string" },
    alt: { type: "string" },
    source: { type: "string" },
  },
  required: ["kind"],
  additionalProperties: false,
};

const PPTX_PARAMETERS = {
  type: "object",
  properties: {
    path: pathSchema,
    title: { type: "string", description: "Optional cover slide title (skipped when the first slide has layout=cover)." },
    subtitle: { type: "string" },
    asOf: { type: "string", description: "Data cut-off date shown on the cover (YYYY-MM-DD)." },
    schemaVersion: { type: "number", description: "Accepted so an UpUp DeckSpec can be passed through unchanged." },
    sources: {
      type: "array",
      description: "Sources referenced by table/chart sourceId; printed as a footer on the slide that uses them.",
      items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, url: { type: "string" }, asOf: { type: "string" } }, required: ["id", "name", "asOf"], additionalProperties: false },
    },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          kicker: { type: "string" },
          layout: { type: "string", enum: ["cover", "section", "content", "comparison", "table", "chart", "kpi"] },
          blocks: { type: "array", items: PPTX_BLOCK_SCHEMA },
          speakerNotes: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  required: ["path", "slides"],
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif"]);
const IMAGE_MAX = 10 * 1024 * 1024;

/** Image blocks may only point inside the task workspace (after resolving symlinks). */
const workspaceImage = (cwd: string, raw: string): string | null => {
  if (!raw || raw.length > PATH_MAX || isAbsolute(raw) || !IMAGE_EXTENSIONS.has(extname(raw).toLowerCase())) return null;
  try {
    const root = realpathSync(cwd);
    const file = realpathSync(resolve(root, raw));
    const inside = relative(root, file);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) return null;
    const info = statSync(file);
    return info.isFile() && info.size <= IMAGE_MAX ? file : null;
  } catch {
    return null;
  }
};

const targetPath = (cwd: string, raw: unknown, extension: string): string => {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("path 必须是非空字符串");
  let value = raw.trim();
  if (value.length > PATH_MAX) throw new Error("path 过长");
  if (extname(value).toLowerCase() !== extension) value += extension;
  return isAbsolute(value) ? value : resolve(cwd, value);
};

export interface OfficeBuiltinContext {
  engine: EngineContext;
  sessionId: string;
  cwd: string;
}

export function createOfficeExtension({ engine, sessionId, cwd }: OfficeBuiltinContext): ExtensionFactory {
  const write = async (
    toolCallId: string,
    path: string,
    bytes: Uint8Array,
    format: "docx" | "xlsx" | "pptx",
  ) => {
    if (bytes.length > FILE_MAX) throw new Error("生成结果超过 40 MB");
    try {
      await engine.checkpoints.begin(sessionId, toolCallId, path);
    } catch {
      /* a failed snapshot must never block the write */
    }
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, bytes, { mode: 0o600 });
      // Commit the checkpoint so the file is listed as created and can be restored/rewound.
      await engine.checkpoints.finish(toolCallId);
    } catch (error) {
      engine.checkpoints.discard(toolCallId);
      throw error;
    }
    engine.emit("agent://artifacts", { sessionId });
    return {
      content: [{ type: "text" as const, text: `已生成 ${format.toUpperCase()}：${path}（${Math.max(1, Math.round(bytes.length / 1024))} KB）` }],
      details: { path, format, bytes: bytes.length },
    };
  };

  return (pi) => {
    pi.registerTool({
      name: DOCX_TOOL,
      label: "Word 文档",
      description: "Create a real .docx with headings, paragraphs, bullet lists and tables.",
      promptSnippet: "Create a Word .docx report with headings, paragraphs, bullets and tables",
      promptGuidelines: [
        "Use ob_docx when the user wants a Word document, report, contract or formatted write-up.",
        "Put the complete content in blocks; do not write a script or ask for Microsoft Word.",
      ],
      parameters: DOCX_PARAMETERS,
      executionMode: "sequential",
      async execute(toolCallId: string, params: unknown) {
        const value = (params ?? {}) as Record<string, unknown>;
        const path = targetPath(cwd, value.path, ".docx");
        const bytes = await buildDocx({
          ...(typeof value.title === "string" ? { title: value.title } : {}),
          blocks: (Array.isArray(value.blocks) ? value.blocks : []) as never,
        });
        return write(toolCallId, path, bytes, "docx");
      },
    });

    pi.registerTool({
      name: XLSX_TOOL,
      label: "Excel 表格",
      description: "Create a real .xlsx workbook with multiple sheets, header rows and numbers.",
      promptSnippet: "Create an Excel .xlsx workbook with sheets, headers and rows",
      promptGuidelines: [
        "Use ob_xlsx for spreadsheets, data tables, budgets and exports; numbers stay numeric.",
        "Give every sheet a short name and put the header row in columns.",
        "To export an industry report's data, pass its DeckSpec as deck instead of re-typing the tables.",
      ],
      parameters: XLSX_PARAMETERS,
      executionMode: "sequential",
      async execute(toolCallId: string, params: unknown) {
        const value = (params ?? {}) as Record<string, unknown>;
        const path = targetPath(cwd, value.path, ".xlsx");
        const sheets = (Array.isArray(value.sheets) ? value.sheets : []) as never[];
        const deck = value.deck && typeof value.deck === "object" ? deckSpecToXlsx(value.deck as never).sheets : [];
        // buildXlsx caps a workbook at 20 sheets; deck sheets fill whatever room the explicit sheets leave.
        const bytes = await buildXlsx({ sheets: [...sheets, ...deck.slice(0, Math.max(0, 20 - sheets.length))] as never });
        return write(toolCallId, path, bytes, "xlsx");
      },
    });

    pi.registerTool({
      name: PPTX_TOOL,
      label: "PowerPoint 演示",
      description: "Create a real 16:9 .pptx deck. Each slide has a title plus bullets or typed blocks: tables, native column/pie charts, KPI cards, notes and workspace images. Accepts an UpUp DeckSpec (run_industry_analysis.deckSpec) unchanged.",
      promptSnippet: "Create a PowerPoint .pptx deck with tables, charts, KPI cards and bullet slides",
      promptGuidelines: [
        "Use ob_pptx for decks, pitches and readouts. One idea per slide: a short title and 3–6 bullets or one table/chart.",
        "Only chart numbers that came from the user or a tool result; give tables/charts a sourceId listed in sources, or add a note block with tone=assumption.",
        "To export an industry analysis, pass run_industry_analysis.deckSpec fields (title, subtitle, asOf, sources, slides) as they are.",
      ],
      parameters: PPTX_PARAMETERS,
      executionMode: "sequential",
      async execute(toolCallId: string, params: unknown) {
        const value = (params ?? {}) as Record<string, unknown>;
        const path = targetPath(cwd, value.path, ".pptx");
        const bytes = await buildPptx(
          {
            ...(typeof value.title === "string" ? { title: value.title } : {}),
            ...(typeof value.subtitle === "string" ? { subtitle: value.subtitle } : {}),
            ...(typeof value.asOf === "string" ? { asOf: value.asOf } : {}),
            ...(Array.isArray(value.sources) ? { sources: value.sources as never } : {}),
            slides: (Array.isArray(value.slides) ? value.slides : []) as never,
          },
          { resolveImage: (raw) => workspaceImage(cwd, raw) },
        );
        return write(toolCallId, path, bytes, "pptx");
      },
    });
  };
}

export const officeBuiltin = {
  id: "office",
  label: "办公文档",
  description: "让模型直接生成 Word / Excel / PowerPoint 文件（ob_docx / ob_xlsx / ob_pptx），产物进入工作台",
  tools: [DOCX_TOOL, XLSX_TOOL, PPTX_TOOL] as readonly string[],
  create: (ctx: OfficeBuiltinContext) => createOfficeExtension(ctx),
};
