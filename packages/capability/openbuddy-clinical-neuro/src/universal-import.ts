import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { getImportTemplateRegistry, type ImportTemplate, type ImportFieldDefinition } from "./import-template";

// ============================================================================
// Types
// ============================================================================

export type ImportFileFormat = "csv" | "tsv" | "xlsx" | "json" | "txt" | "unknown";

export interface ImportFileInput {
	readonly fileName: string;
	readonly /** Text content, or base64 for binary (xlsx). */
	content: string;
	readonly format: ImportFileFormat;
}

export interface ImportPreviewRecord {
	readonly /** Extracted and mapped fields. */
	data: Record<string, unknown>;
	readonly /** Confidence score 0-1. */
	confidence: number;
	readonly /** Warnings for this record. */
	warnings: string[];
}

export interface ImportPreview {
	readonly templateId: string;
	readonly templateName: string;
	readonly /** All extracted records. */
	records: readonly ImportPreviewRecord[];
	readonly totalExtracted: number;
	readonly totalSkipped: number;
	readonly /** Summary of what was found. */
	summary: string;
	readonly warnings: readonly string[];
	readonly /** Content hash for dedup. */
	contentHash: string;
}

export interface ImportExecuteResult {
	readonly added: number;
	readonly updated: number;
	readonly skipped: number;
	readonly errors: readonly string[];
}

// ============================================================================
// File format detection and text extraction
// ============================================================================

export function detectImportFormat(fileName: string): ImportFileFormat {
	const ext = extname(fileName).toLowerCase();
	if (ext === ".csv") return "csv";
	if (ext === ".tsv" || ext === ".tab") return "tsv";
	if (ext === ".xlsx" || ext === ".xls") return "xlsx";
	if (ext === ".json") return "json";
	if (ext === ".txt" || ext === ".text" || ext === ".md") return "txt";
	return "unknown";
}

function parseDelimited(content: string, delimiter: string): string[][] {
	const lines = content.trim().split(/\r?\n/).filter((l) => l.trim());
	return lines.map((line) => {
		const result: string[] = [];
		let current = "";
		let inQuotes = false;
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === '"') {
				if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
				else inQuotes = !inQuotes;
			} else if (char === delimiter && !inQuotes) {
				result.push(current.trim());
				current = "";
			} else current += char;
		}
		result.push(current.trim());
		return result;
	});
}

async function extractTable(file: ImportFileInput): Promise<string[][]> {
	switch (file.format) {
		case "csv": return parseDelimited(file.content, ",");
		case "tsv": return parseDelimited(file.content, "\t");
		case "json": {
			const data = JSON.parse(file.content);
			if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
				const headers = Object.keys(data[0]);
				return [headers, ...data.map((item: Record<string, unknown>) => headers.map((h) => String(item[h] ?? "")))];
			}
			throw new Error("JSON 必须是对象数组");
		}
		case "xlsx": {
			try {
				const XLSX = await import("xlsx");
				const buffer = Buffer.from(file.content, "base64");
				const workbook = XLSX.read(buffer, { type: "buffer" });
				const sheetName = workbook.SheetNames[0];
				if (!sheetName) throw new Error("Excel 文件没有工作表");
				const sheet = workbook.Sheets[sheetName];
				return XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
			} catch { throw new Error("XLSX 解析失败,建议另存为 CSV"); }
		}
		case "txt": {
			if (file.content.includes("\t")) return parseDelimited(file.content, "\t");
			if (file.content.includes(",")) return parseDelimited(file.content, ",");
			if (file.content.includes("|")) return parseDelimited(file.content, "|");
			throw new Error("纯文本无法识别分隔符(支持 Tab/逗号/竖线)");
		}
		default: throw new Error(`不支持的格式: ${file.fileName}`);
	}
}

// ============================================================================
// Rule-based field matching (fast path, no LLM needed)
// ============================================================================

function matchColumns(headers: readonly string[], template: ImportTemplate): Record<number, ImportFieldDefinition | null> {
	const mapping: Record<number, ImportFieldDefinition | null> = {};
	for (let i = 0; i < headers.length; i++) {
		// Normalize: lowercase, remove whitespace, strip parenthetical annotations like "(必填)".
		const header = headers[i].toLowerCase().replace(/\s+/gu, "").replace(/[（(][^）)]*[）)]/gu, "");
		let best: ImportFieldDefinition | null = null;
		let bestScore = 0;
		for (const field of template.fields) {
			for (const synonym of field.synonyms) {
				const normalizedSynonym = synonym.toLowerCase().replace(/\s+/gu, "");
				if (header === normalizedSynonym) { best = field; bestScore = 1.0; break; }
				if (header.includes(normalizedSynonym) || normalizedSynonym.includes(header)) {
					// Substring match is meaningful — score based on overlap ratio but with a floor.
					const overlap = Math.min(header.length, normalizedSynonym.length) / Math.max(header.length, normalizedSynonym.length);
					const score = Math.max(overlap, 0.55);
					if (score > bestScore) { bestScore = score; best = field; }
				}
			}
			if (bestScore === 1.0) break;
		}
		mapping[i] = bestScore >= 0.5 ? best : null;
	}
	return mapping;
}

// ============================================================================
// Universal Import Engine
// ============================================================================

export interface UniversalImportLlm {
	extract(input: { template: ImportTemplate; rawContent: string }): Promise<{ records: Record<string, unknown>[]; summary: string; warnings: string[] }>;
}

export class UniversalImportEngine {
	constructor(private readonly llm?: UniversalImportLlm | null) {}

	/** List available templates. */
	listTemplates(domain?: string): ImportTemplate[] {
		return getImportTemplateRegistry().list(domain);
	}

	/** Auto-detect best matching template for the content. */
	async detectTemplate(file: ImportFileInput): Promise<{ templateId: string | null; confidence: number }> {
		const table = await extractTable(file);
		if (table.length < 2) return { templateId: null, confidence: 0 };
		const headers = table[0].map((h) => String(h ?? ""));
		const headerText = headers.join(" ").toLowerCase();
		let bestTemplate: ImportTemplate | null = null;
		let bestScore = 0;
		for (const template of getImportTemplateRegistry().list()) {
			let score = 0;
			let matchedFields = 0;
			for (const field of template.fields) {
				if (field.synonyms.some((s) => headerText.includes(s.toLowerCase()))) matchedFields++;
			}
			// Score: matched fields / total fields, weighted by required fields being present
			const requiredMatched = template.fields.filter((f) => f.required && f.synonyms.some((s) => headerText.includes(s.toLowerCase()))).length;
			const requiredTotal = template.fields.filter((f) => f.required).length;
			score = (matchedFields / template.fields.length) * 0.6 + (requiredTotal > 0 ? (requiredMatched / requiredTotal) * 0.4 : 0);
			if (score > bestScore) { bestScore = score; bestTemplate = template; }
		}
		return { templateId: bestTemplate?.id ?? null, confidence: bestScore };
	}

	/** Preview: parse file and extract records using template. */
	async preview(file: ImportFileInput, templateId: string): Promise<ImportPreview> {
		const template = getImportTemplateRegistry().get(templateId);
		if (!template) throw new Error(`未找到导入模板: ${templateId}`);

		const table = await extractTable(file);
		if (table.length < 2) throw new Error("文件没有数据行");
		const headers = table[0].map((h) => String(h ?? "").trim());
		const rows = table.slice(1);

		// Strategy 1: Rule-based column matching (fast, deterministic)
		const columnMapping = matchColumns(headers, template);
		const mappedCount = Object.values(columnMapping).filter(Boolean).length;
		const requiredMapped = template.fields.filter((f) => f.required && Object.values(columnMapping).some((m) => m?.name === f.name)).length;
		const allRequiredMapped = requiredMapped === template.fields.filter((f) => f.required).length;

		const records: ImportPreviewRecord[] = [];
		const warnings: string[] = [];

		if (mappedCount >= 2 && allRequiredMapped) {
			// Rule-based extraction
			for (const row of rows) {
				const data: Record<string, unknown> = {};
				const recordWarnings: string[] = [];
				for (let colIndex = 0; colIndex < headers.length; colIndex++) {
					const field = columnMapping[colIndex];
					if (!field) continue;
					const value = String(row[colIndex] ?? "").trim();
					if (!value) continue;
					if (field.type === "string[]" && field.multiValueSeparator) {
						data[field.name] = value.split(field.multiValueSeparator).map((s) => s.trim()).filter(Boolean);
					} else if (field.type === "boolean") {
						data[field.name] = !/false|否|非|no/i.test(value);
					} else if (field.type === "number") {
						data[field.name] = Number(value) || 0;
					} else {
						data[field.name] = value;
					}
				}
				// Check required fields
				for (const field of template.fields) {
					if (field.required && !data[field.name]) recordWarnings.push(`缺少必填字段: ${field.label}`);
				}
				if (recordWarnings.length === 0) records.push({ data, confidence: 0.95, warnings: [] });
				else records.push({ data, confidence: 0.5, warnings: recordWarnings });
			}
			warnings.push(`规则匹配: ${mappedCount}/${headers.length} 列已映射`);
		} else if (this.llm) {
			// Strategy 2: LLM-powered extraction
			warnings.push("规则匹配不足,使用 LLM 智能解析");
			const rawContent = file.format === "xlsx" ? rows.map((r) => r.join("\t")).join("\n") : file.content;
			const llmResult = await this.llm.extract({ template, rawContent });
			for (const record of llmResult.records) {
				const recordWarnings: string[] = [];
				for (const field of template.fields) {
					if (field.required && !record[field.name]) recordWarnings.push(`缺少: ${field.label}`);
				}
				records.push({ data: record, confidence: recordWarnings.length === 0 ? 0.85 : 0.4, warnings: recordWarnings });
			}
			if (llmResult.warnings.length > 0) warnings.push(...llmResult.warnings);
			if (llmResult.summary) warnings.push(llmResult.summary);
		} else {
			throw new Error(`无法解析:规则匹配率不足(${mappedCount} 列),且未配置 LLM 解析器`);
		}

		const validRecords = records.filter((r) => r.warnings.length === 0);
		const skippedRecords = records.length - validRecords.length;

		return {
			templateId,
			templateName: template.name,
			records,
			totalExtracted: records.length,
			totalSkipped: skippedRecords,
			summary: `识别到 ${records.length} 条记录,其中 ${validRecords.length} 条完整,${skippedRecords} 条有缺失字段`,
			warnings,
			contentHash: createHash("sha256").update(file.content.slice(0, 10000)).digest("hex"),
		};
	}
}

let engineInstance: UniversalImportEngine | null = null;

export function getUniversalImportEngine(llm?: UniversalImportLlm | null): UniversalImportEngine {
	if (!engineInstance) engineInstance = new UniversalImportEngine(llm);
	return engineInstance;
}
