import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { getMedicalKnowledgeBase } from "./medical-knowledge-base";

// ============================================================================
// Types
// ============================================================================

export type SmartImportFormat = "csv" | "xlsx" | "json" | "txt" | "tsv" | "unknown";

export interface SmartImportFile {
	readonly /** Original file name. */
	fileName: string;
	readonly /** Raw file content (text) or base64 (binary). */
	content: string;
	readonly /** Detected format. */
	format: SmartImportFormat;
}

export interface SmartImportPreviewColumn {
	readonly /** Column header from source file. */
	sourceHeader: string;
	readonly /** Mapped target field. */
	targetField: string | null;
	readonly /** Mapping confidence (0-1). */
	confidence: number;
	readonly /** Sample values from first 3 rows. */
	samples: readonly string[];
}

export interface SmartImportPreview {
	readonly /** Parsed raw table. */
	headers: readonly string[];
	readonly rows: readonly string[][];
	readonly /** Column mapping suggestion. */
	columns: readonly SmartImportPreviewColumn[];
	readonly /** Detected record type. */
	detectedType: "drug" | "lab" | "disease" | "unknown";
	readonly typeConfidence: number;
	readonly /** Total data rows. */
	totalRows: number;
	readonly /** Issues found during parsing. */
	issues: readonly string[];
	readonly /** Content hash for dedup. */
	contentHash: string;
}

export interface SmartImportResult {
	readonly added: number;
	readonly updated: number;
	readonly skipped: number;
	readonly errors: readonly string[];
	readonly /** Mapping used. */
	columnMapping: Record<string, string>;
}

// ============================================================================
// Field synonym dictionary — rule-based column matching
// ============================================================================

const DRUG_FIELD_SYNONYMS: Record<string, readonly string[]> = {
	genericName: ["通用名", "药品名称", "药品名", "名称", "品名", "药名", "generic", "generic_name", "genericName", "drug_name", "drugName"],
	brandNames: ["商品名", "品牌", "商标名", "brand", "trade_name", "tradeName", "商品名/品牌"],
	englishName: ["英文名", "英文", "english", "english_name", "englishName"],
	atcCode: ["ATC", "ATC编码", "ATC分类", "atc", "atc_code", "atcCode"],
	category: ["分类", "类别", "药理分类", "药理类别", "category", "class", "治疗类别"],
	indications: ["适应症", "适应证", "主治", "功能主治", "用途", "indication", "indications"],
	contraindications: ["禁忌症", "禁忌", "禁忌证", "contraindication", "contraindications"],
	adverseReactions: ["不良反应", "副作用", "adverse", "adverseReaction", "sideEffect", "side_effect"],
	interactions: ["相互作用", "药物相互作用", "interaction", "interactions", "drugInteraction"],
	dosage: ["用法用量", "剂量", "用量", "用法", "dosage", "dose", "dosing"],
	insuranceClass: ["医保类别", "医保", "医保类型", "insurance", "insuranceClass", "insurance_class"],
	prescriptionOnly: ["处方药", "是否处方药", "Rx", "prescription", "prescriptionOnly", "otc"],
	pregnancyCategory: ["妊娠分级", "妊娠期用药", "pregnancy", "pregnancyCategory", "pregnancy_category"],
};

const LAB_FIELD_SYNONYMS: Record<string, readonly string[]> = {
	name: ["项目名称", "检验项目", "检查项目", "名称", "项目名", "name", "testName", "test_name", "examName"],
	abbreviations: ["缩写", "简称", "英文缩写", "abbr", "abbreviation", "abbreviations", "shortName"],
	category: ["类别", "分类", "类型", "category", "class", "type"],
	specimenType: ["标本类型", "标本", "样本类型", "specimen", "specimenType", "specimen_type", "sampleType"],
	referenceRanges: ["参考范围", "参考值", "正常值", "reference", "referenceRange", "reference_range", "normalRange"],
	clinicalSignificance: ["临床意义", "意义", "clinicalSignificance", "significance", "clinical_significance"],
	criticalValues: ["危急值", "criticalValue", "critical_value", "panic"],
	unit: ["单位", "计量单位", "unit", "units"],
};

const DISEASE_FIELD_SYNONYMS: Record<string, readonly string[]> = {
	icd10: ["ICD", "ICD-10", "ICD编码", "ICD10", "icd", "icd10", "icd_code"],
	name: ["疾病名称", "诊断名称", "名称", "病名", "name", "diseaseName", "disease_name", "diagnosis"],
	englishName: ["英文名", "英文", "english", "englishName"],
	department: ["科室", "就诊科室", "department", "dept"],
};

// ============================================================================
// File format detection and parsing
// ============================================================================

export function detectFormat(fileName: string): SmartImportFormat {
	const ext = extname(fileName).toLowerCase();
	if (ext === ".csv") return "csv";
	if (ext === ".tsv" || ext === ".tab") return "tsv";
	if (ext === ".xlsx" || ext === ".xls") return "xlsx";
	if (ext === ".json") return "json";
	if (ext === ".txt" || ext === ".text") return "txt";
	return "unknown";
}

function parseDelimited(content: string, delimiter: "," | "\t"): { headers: string[]; rows: string[][] } {
	const lines = content.trim().split(/\r?\n/);
	if (lines.length === 0) return { headers: [], rows: [] };
	const parseLine = (line: string): string[] => {
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
	};
	const headers = parseLine(lines[0]);
	const rows = lines.slice(1).filter((line) => line.trim()).map(parseLine);
	return { headers, rows };
}

function parseJsonTable(content: string): { headers: string[]; rows: string[][] } {
	const data = JSON.parse(content);
	if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
		const headers = Object.keys(data[0]);
		const rows = data.map((item: Record<string, unknown>) => headers.map((h) => String(item[h] ?? "")));
		return { headers, rows };
	}
	throw new Error("JSON 必须是对象数组");
}

/** Parse XLSX from base64 using SheetJS if available, otherwise graceful error. */
async function parseXlsx(base64: string): Promise<{ headers: string[]; rows: string[][] }> {
	try {
		const XLSX = await import("xlsx");
		const buffer = Buffer.from(base64, "base64");
		const workbook = XLSX.read(buffer, { type: "buffer" });
		const sheetName = workbook.SheetNames[0];
		if (!sheetName) throw new Error("Excel 文件没有工作表");
		const sheet = workbook.Sheets[sheetName];
		const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 }) as unknown[][];
		if (jsonData.length === 0) return { headers: [], rows: [] };
		const headers = jsonData[0].map((h) => String(h ?? "").trim());
		const rows = jsonData.slice(1).map((row) => headers.map((_, i) => String(row[i] ?? "").trim()));
		return { headers, rows };
	} catch (error) {
		throw new Error(`XLSX 解析失败: ${error instanceof Error ? error.message : String(error)}。建议先另存为 CSV 后导入`);
	}
}

/** Parse plain text — try tab-delimited, then comma, then fixed-width heuristic. */
function parseText(content: string): { headers: string[]; rows: string[][] } {
	if (content.includes("\t")) return parseDelimited(content, "\t");
	if (content.includes(",")) return parseDelimited(content, ",");
	// Try pipe or semicolon delimited
	if (content.includes("|")) {
		const lines = content.trim().split(/\r?\n/);
		return { headers: lines[0].split("|").map((s) => s.trim()), rows: lines.slice(1).map((line) => line.split("|").map((s) => s.trim())) };
	}
	throw new Error("纯文本格式无法识别分隔符(支持 Tab、逗号、竖线)。建议另存为 CSV");
}

// ============================================================================
// Intelligent column mapping
// ============================================================================

function matchColumnToField(header: string, synonyms: Record<string, readonly string[]>): { field: string | null; confidence: number } {
	const normalized = header.toLowerCase().replace(/\s+/gu, "").replace(/[()（）]/gu, "");
	let bestField: string | null = null;
	let bestConfidence = 0;
	for (const [field, terms] of Object.entries(synonyms)) {
		for (const term of terms) {
			const normalizedTerm = term.toLowerCase().replace(/\s+/gu, "");
			if (normalized === normalizedTerm) return { field, confidence: 1.0 };
			if (normalized.includes(normalizedTerm) || normalizedTerm.includes(normalized)) {
				const confidence = Math.min(normalized.length, normalizedTerm.length) / Math.max(normalized.length, normalizedTerm.length);
				if (confidence > bestConfidence) { bestConfidence = confidence; bestField = field; }
			}
		}
	}
	return { field: bestField, confidence: bestConfidence };
}

function detectRecordType(headers: readonly string[]): { type: "drug" | "lab" | "disease" | "unknown"; confidence: number } {
	const headerText = headers.join(" ").toLowerCase();
	const drugScore = DRUG_FIELD_SYNONYMS.genericName.some((s) => headerText.includes(s.toLowerCase())) ? 0.5 : 0;
	const drugBonus = Object.values(DRUG_FIELD_SYNONYMS).flat().filter((s) => headerText.includes(s.toLowerCase())).length * 0.1;
	const labScore = LAB_FIELD_SYNONYMS.name.some((s) => headerText.includes(s.toLowerCase())) ? 0.3 : 0;
	const labBonus = Object.values(LAB_FIELD_SYNONYMS).flat().filter((s) => headerText.includes(s.toLowerCase())).length * 0.1;
	const diseaseScore = DISEASE_FIELD_SYNONYMS.icd10.some((s) => headerText.includes(s.toLowerCase())) ? 0.8 : 0;
	if (diseaseScore > 0) return { type: "disease", confidence: Math.min(0.95, diseaseScore) };
	if (drugScore + drugBonus >= labScore + labBonus && drugScore + drugBonus > 0.3) return { type: "drug", confidence: Math.min(0.95, drugScore + drugBonus) };
	if (labScore + labBonus > 0.3) return { type: "lab", confidence: Math.min(0.95, labScore + labBonus) };
	return { type: "unknown", confidence: 0 };
}

// ============================================================================
// Main smart import service
// ============================================================================

export class SmartImportService {

	/** Parse a file and generate a preview with column mapping suggestions. */
	async preview(file: SmartImportFile): Promise<SmartImportPreview> {
		const issues: string[] = [];
		let parsed: { headers: string[]; rows: string[][] };

		switch (file.format) {
			case "csv": parsed = parseDelimited(file.content, ","); break;
			case "tsv": parsed = parseDelimited(file.content, "\t"); break;
			case "json": parsed = parseJsonTable(file.content); break;
			case "xlsx": parsed = await parseXlsx(file.content); break;
			case "txt": parsed = parseText(file.content); break;
			default: throw new Error(`不支持的文件格式: ${file.fileName}。支持 CSV/TSV/XLSX/JSON/TXT`);
		}

		if (parsed.headers.length === 0) issues.push("未检测到表头");
		if (parsed.rows.length === 0) issues.push("未检测到数据行");

		const { type, confidence } = detectRecordType(parsed.headers);
		const synonyms = type === "drug" ? DRUG_FIELD_SYNONYMS : type === "lab" ? LAB_FIELD_SYNONYMS : DISEASE_FIELD_SYNONYMS;

		const columns: SmartImportPreviewColumn[] = parsed.headers.map((header, index) => {
			const { field, confidence: fieldConfidence } = matchColumnToField(header, synonyms);
			return {
				sourceHeader: header,
				targetField: field,
				confidence: fieldConfidence,
				samples: parsed.rows.slice(0, 3).map((row) => row[index] ?? "").filter(Boolean),
			};
		});

		const unmapped = columns.filter((c) => !c.targetField).length;
		if (unmapped > 0) issues.push(`${unmapped} 列未能自动映射,请手动指定或忽略`);

		const contentHash = createHash("sha256").update(file.content.slice(0, 10000)).digest("hex");

		return {
			headers: parsed.headers,
			rows: parsed.rows,
			columns,
			detectedType: type,
			typeConfidence: confidence,
			totalRows: parsed.rows.length,
			issues,
			contentHash,
		};
	}

	/** Execute the import using confirmed column mapping. */
	async execute(
		file: SmartImportFile,
		confirmedType: "drug" | "lab" | "disease",
		columnMapping: Record<string, string>,
	): Promise<SmartImportResult> {
		const preview = await this.preview(file);
		const kb = getMedicalKnowledgeBase();
		const errors: string[] = [];
		let added = 0;
		let updated = 0;
		let skipped = 0;

		for (let rowIndex = 0; rowIndex < preview.rows.length; rowIndex++) {
			const row = preview.rows[rowIndex];
			const record: Record<string, string | string[] | boolean> = {};
			for (let colIndex = 0; colIndex < preview.headers.length; colIndex++) {
				const header = preview.headers[colIndex];
				const targetField = columnMapping[header];
				if (!targetField || targetField === "ignore") continue;
				const value = row[colIndex] ?? "";
				if (!value) continue;
				// Multi-value fields split by |, ;, ;
				const multiValueFields = ["brandNames", "indications", "contraindications", "adverseReactions", "interactions", "abbreviations", "clinicalSignificance"];
				if (multiValueFields.includes(targetField)) {
					record[targetField] = value.split(/[|;；]/u).map((s) => s.trim()).filter(Boolean);
				} else if (targetField === "prescriptionOnly") {
					record[targetField] = !/false|否|非处方|otc/i.test(value);
				} else {
					record[targetField] = value;
				}
			}

			try {
				if (confirmedType === "drug") {
					if (!record.genericName) { errors.push(`第 ${rowIndex + 2} 行: 缺少药品通用名`); skipped++; continue; }
					await kb.addDrug({
						genericName: String(record.genericName),
						brandNames: (record.brandNames as string[]) ?? [],
						englishName: record.englishName ? String(record.englishName) : undefined,
						category: String(record.category ?? ""),
						indications: (record.indications as string[]) ?? [],
						contraindications: (record.contraindications as string[]) ?? [],
						adverseReactions: (record.adverseReactions as string[]) ?? [],
						interactions: (record.interactions as string[]) ?? [],
						dosage: record.dosage ? String(record.dosage) : undefined,
						insuranceClass: record.insuranceClass as never,
						prescriptionOnly: (record.prescriptionOnly as boolean) ?? true,
						pregnancyCategory: record.pregnancyCategory as never,
						source: "smart_import",
					});
					added++;
				} else if (confirmedType === "lab") {
					if (!record.name) { errors.push(`第 ${rowIndex + 2} 行: 缺少检查项目名称`); skipped++; continue; }
					await kb.addLabExam({
						name: String(record.name),
						abbreviations: (record.abbreviations as string[]) ?? [],
						category: (record.category as never) ?? "lab",
						specimenType: record.specimenType ? String(record.specimenType) : undefined,
						referenceRanges: record.referenceRanges ? [{ label: "成人", range: String(record.referenceRanges), unit: String(record.unit ?? "") }] : [],
						clinicalSignificance: (record.clinicalSignificance as string[]) ?? [],
						source: "smart_import",
					});
					added++;
				} else {
					if (!record.icd10 || !record.name) { errors.push(`第 ${rowIndex + 2} 行: 缺少 ICD-10 或疾病名称`); skipped++; continue; }
					await kb.addDisease({
						icd10: String(record.icd10),
						name: String(record.name),
						englishName: record.englishName ? String(record.englishName) : undefined,
						department: String(record.department ?? ""),
						source: "smart_import" as never,
					} as never);
					added++;
				}
			} catch (error) {
				errors.push(`第 ${rowIndex + 2} 行: ${error instanceof Error ? error.message : String(error)}`);
				skipped++;
			}
		}
		return { added, updated, skipped, errors, columnMapping };
	}
}

let smartImportInstance: SmartImportService | null = null;

export function getSmartImportService(): SmartImportService {
	if (!smartImportInstance) smartImportInstance = new SmartImportService();
	return smartImportInstance;
}
