import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import type { ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildDocx, buildPptx, buildXlsx } from "@openbuddy/services/office/index";
import type { BuiltinContext } from "./index.js";

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
  },
  required: ["path", "sheets"],
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

const PPTX_PARAMETERS = {
  type: "object",
  properties: {
    path: pathSchema,
    title: { type: "string", description: "Optional cover slide title." },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  required: ["path", "slides"],
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

const targetPath = (cwd: string, raw: unknown, extension: string): string => {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("path 必须是非空字符串");
  let value = raw.trim();
  if (value.length > PATH_MAX) throw new Error("path 过长");
  if (extname(value).toLowerCase() !== extension) value += extension;
  return isAbsolute(value) ? value : resolve(cwd, value);
};

export function createOfficeExtension({ engine, sessionId, cwd }: BuiltinContext): ExtensionFactory {
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
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, bytes, { mode: 0o600 });
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
      ],
      parameters: XLSX_PARAMETERS,
      executionMode: "sequential",
      async execute(toolCallId: string, params: unknown) {
        const value = (params ?? {}) as Record<string, unknown>;
        const path = targetPath(cwd, value.path, ".xlsx");
        const bytes = await buildXlsx({ sheets: (Array.isArray(value.sheets) ? value.sheets : []) as never });
        return write(toolCallId, path, bytes, "xlsx");
      },
    });

    pi.registerTool({
      name: PPTX_TOOL,
      label: "PowerPoint 演示",
      description: "Create a real .pptx deck: an optional cover plus title + bullets per slide.",
      promptSnippet: "Create a PowerPoint .pptx deck with a cover and bullet slides",
      promptGuidelines: [
        "Use ob_pptx for decks, pitches and readouts.",
        "One idea per slide: a short title and 3–6 bullets.",
      ],
      parameters: PPTX_PARAMETERS,
      executionMode: "sequential",
      async execute(toolCallId: string, params: unknown) {
        const value = (params ?? {}) as Record<string, unknown>;
        const path = targetPath(cwd, value.path, ".pptx");
        const bytes = await buildPptx({
          ...(typeof value.title === "string" ? { title: value.title } : {}),
          slides: (Array.isArray(value.slides) ? value.slides : []) as never,
        });
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
  create: (ctx: BuiltinContext) => createOfficeExtension(ctx),
};
