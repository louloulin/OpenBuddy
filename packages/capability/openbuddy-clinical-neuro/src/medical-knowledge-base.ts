import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

// ============================================================================
// Types — Drug catalog
// ============================================================================

export interface DrugRecord {
	readonly id: string;
	/** 通用名 (e.g., 阿司匹林). */
	readonly genericName: string;
	/** 商品名/品牌名. */
	readonly brandNames: readonly string[];
	/** 英文名. */
	readonly englishName?: string;
	/** ATC 分类. */
	readonly atcCode?: string;
	/** 药理分类 (e.g., 抗血小板药). */
	readonly category: string;
	/** 适应症. */
	readonly indications: readonly string[];
	/** 禁忌症. */
	readonly contraindications: readonly string[];
	/** 常见不良反应. */
	readonly adverseReactions: readonly string[];
	/** 药物相互作用(简述). */
	readonly interactions: readonly string[];
	/** 常用剂量范围(成人). */
	readonly dosage?: string;
	/** 医保类别: 甲类/乙类/自费. */
	readonly insuranceClass?: "甲类" | "乙类" | "自费";
	/** 是否处方药. */
	readonly prescriptionOnly: boolean;
	/** 妊娠分级 (A/B/C/D/X). */
	readonly pregnancyCategory?: "A" | "B" | "C" | "D" | "X";
	/** 数据来源标注. */
	readonly source?: string;
	readonly updatedAt: string;
}

// ============================================================================
// Types — Lab / examination catalog
// ============================================================================

export interface LabExamRecord {
	readonly id: string;
	/** 项目名称 (e.g., 高敏肌钙蛋白I). */
	readonly name: string;
	/** 英文名/缩写. */
	readonly abbreviations: readonly string[];
	/** LOINC 代码(如有). */
	readonly loincCode?: string;
	/** 标本类型 (血清/血浆/全血/尿液/脑脊液等). */
	readonly specimenType?: string;
	/** 参考范围(按性别/年龄分列). */
	readonly referenceRanges: readonly { label: string; range: string; unit: string }[];
	/** 临床意义(升高/降低分别说明). */
	readonly clinicalSignificance: readonly string[];
	/** 危急值. */
	readonly criticalValues?: readonly { condition: string; value: string }[];
	/** 类别: 化验/影像/功能/病理. */
	readonly category: "lab" | "imaging" | "function" | "pathology";
	/** 大致费用(元,仅供参考). */
	readonly approximateCost?: number;
	readonly source?: string;
	readonly updatedAt: string;
}

// ============================================================================
// Types — Disease catalog (ICD-10)
// ============================================================================

export interface DiseaseRecord {
	readonly id: string;
	/** ICD-10 编码. */
	readonly icd10: string;
	/** 疾病名称(中文). */
	readonly name: string;
	/** 英文名. */
	readonly englishName?: string;
	/** 所属科室. */
	readonly department: string;
	readonly updatedAt: string;
}

// ============================================================================
// Search
// ============================================================================

export interface MedicalKbQuery {
	readonly keyword: string;
	readonly type?: "drug" | "lab" | "disease";
	readonly category?: string;
	readonly limit?: number;
}

export interface MedicalKbSearchResult {
	readonly type: "drug" | "lab" | "disease";
	readonly score: number;
	readonly drug?: DrugRecord;
	readonly lab?: LabExamRecord;
	readonly disease?: DiseaseRecord;
	/** Matched field for highlighting. */
	readonly matchedField: string;
}

// ============================================================================
// Store
// ============================================================================

interface MedicalKbState {
	version: 1;
	drugs: DrugRecord[];
	labs: LabExamRecord[];
	diseases: DiseaseRecord[];
	/** Content hash for change detection. */
	contentHash: string;
	updatedAt: string;
}

export class MedicalKnowledgeBase {
	private state: MedicalKbState | null = null;
	private readonly filePath: string;

	constructor(filePath?: string) {
		this.filePath = filePath ?? join(process.env.HOME ?? ".", ".openbuddy", "medical-kb.json");
	}

	private async load(): Promise<MedicalKbState> {
		if (this.state) return this.state;
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as Partial<MedicalKbState>;
			if (parsed.version !== 1) throw new Error("unsupported version");
			this.state = {
				version: 1,
				drugs: Array.isArray(parsed.drugs) ? parsed.drugs : [],
				labs: Array.isArray(parsed.labs) ? parsed.labs : [],
				diseases: Array.isArray(parsed.diseases) ? parsed.diseases : [],
				contentHash: parsed.contentHash ?? "",
				updatedAt: parsed.updatedAt ?? "",
			};
		} catch {
			this.state = { version: 1, drugs: [], labs: [], diseases: [], contentHash: "", updatedAt: "" };
		}
		return this.state;
	}

	private async persist(): Promise<void> {
		const state = await this.load();
		state.contentHash = createHash("sha256")
			.update(JSON.stringify({ d: state.drugs, l: state.labs, dis: state.diseases }))
			.digest("hex");
		state.updatedAt = new Date().toISOString();
		await mkdir(dirname(this.filePath), { recursive: true });
		const tmp = `${this.filePath}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
		await rename(tmp, this.filePath);
	}

	// === Drug operations ===

	async addDrug(input: Omit<DrugRecord, "id" | "updatedAt">): Promise<DrugRecord> {
		const state = await this.load();
		const record: DrugRecord = { ...input, id: `drug_${createHash("md5").update(input.genericName).digest("hex").slice(0, 12)}`, updatedAt: new Date().toISOString() };
		const existing = state.drugs.findIndex((d) => d.genericName === input.genericName);
		if (existing >= 0) state.drugs[existing] = record;
		else state.drugs.push(record);
		await this.persist();
		return record;
	}

	// === Lab operations ===

	async addLabExam(input: Omit<LabExamRecord, "id" | "updatedAt">): Promise<LabExamRecord> {
		const state = await this.load();
		const record: LabExamRecord = { ...input, id: `lab_${createHash("md5").update(input.name).digest("hex").slice(0, 12)}`, updatedAt: new Date().toISOString() };
		const existing = state.labs.findIndex((l) => l.name === input.name);
		if (existing >= 0) state.labs[existing] = record;
		else state.labs.push(record);
		await this.persist();
		return record;
	}

	// === Disease operations ===

	async addDisease(input: Omit<DiseaseRecord, "id" | "updatedAt">): Promise<DiseaseRecord> {
		const state = await this.load();
		const record: DiseaseRecord = { ...input, id: `dis_${createHash("md5").update(input.icd10).digest("hex").slice(0, 12)}`, updatedAt: new Date().toISOString() };
		const existing = state.diseases.findIndex((d) => d.icd10 === input.icd10);
		if (existing >= 0) state.diseases[existing] = record;
		else state.diseases.push(record);
		await this.persist();
		return record;
	}

	// === Search ===

	async search(query: MedicalKbQuery): Promise<MedicalKbSearchResult[]> {
		const state = await this.load();
		const keyword = query.keyword.trim().toLowerCase();
		if (!keyword) return [];
		const results: MedicalKbSearchResult[] = [];
		const limit = query.limit ?? 20;

		if (!query.type || query.type === "drug") {
			for (const drug of state.drugs) {
				let score = 0;
				let matchedField = "";
				if (drug.genericName.toLowerCase().includes(keyword)) { score = 100; matchedField = "genericName"; }
				else if (drug.brandNames.some((b) => b.toLowerCase().includes(keyword))) { score = 80; matchedField = "brandNames"; }
				else if (drug.englishName?.toLowerCase().includes(keyword)) { score = 70; matchedField = "englishName"; }
				else if (drug.category.toLowerCase().includes(keyword)) { score = 60; matchedField = "category"; }
				else if (drug.indications.some((i) => i.toLowerCase().includes(keyword))) { score = 50; matchedField = "indications"; }
				if (score > 0 && (!query.category || drug.category.includes(query.category))) {
					results.push({ type: "drug", score, drug, matchedField });
				}
			}
		}

		if (!query.type || query.type === "lab") {
			for (const lab of state.labs) {
				let score = 0;
				let matchedField = "";
				if (lab.name.toLowerCase().includes(keyword)) { score = 100; matchedField = "name"; }
				else if (lab.abbreviations.some((a) => a.toLowerCase().includes(keyword))) { score = 85; matchedField = "abbreviations"; }
				else if (lab.clinicalSignificance.some((c) => c.toLowerCase().includes(keyword))) { score = 50; matchedField = "clinicalSignificance"; }
				if (score > 0 && (!query.category || lab.category === query.category)) {
					results.push({ type: "lab", score, lab, matchedField });
				}
			}
		}

		if (!query.type || query.type === "disease") {
			for (const disease of state.diseases) {
				let score = 0;
				let matchedField = "";
				if (disease.name.toLowerCase().includes(keyword)) { score = 100; matchedField = "name"; }
				else if (disease.icd10.toLowerCase().includes(keyword)) { score = 90; matchedField = "icd10"; }
				else if (disease.englishName?.toLowerCase().includes(keyword)) { score = 70; matchedField = "englishName"; }
				else if (disease.department.toLowerCase().includes(keyword)) { score = 50; matchedField = "department"; }
				if (score > 0) results.push({ type: "disease", score, disease, matchedField });
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	async stats(): Promise<{ drugs: number; labs: number; diseases: number; updatedAt: string }> {
		const state = await this.load();
		return { drugs: state.drugs.length, labs: state.labs.length, diseases: state.diseases.length, updatedAt: state.updatedAt };
	}

	// === CSV import ===

	/** Import drugs from CSV: genericName,brandNames(|),category,indications(|),contraindications(|),dosage,insuranceClass,prescriptionOnly */
	async importDrugsCsv(csv: string): Promise<{ added: number; skipped: number; errors: string[] }> {
		const lines = csv.trim().split(/\r?\n/);
		if (lines.length < 2) return { added: 0, skipped: 0, errors: ["CSV 需要至少一行表头和一行数据"] };
		const errors: string[] = [];
		let added = 0;
		let skipped = 0;
		for (let i = 1; i < lines.length; i++) {
			const cols = this.parseCsvLine(lines[i]);
			if (cols.length < 3) { errors.push(`第 ${i + 1} 行: 列数不足(需要至少 3 列)`); skipped++; continue; }
			try {
				await this.addDrug({
					genericName: cols[0],
					brandNames: cols[1] ? cols[1].split("|").filter(Boolean) : [],
					category: cols[2] ?? "",
					indications: cols[3] ? cols[3].split("|").filter(Boolean) : [],
					contraindications: cols[4] ? cols[4].split("|").filter(Boolean) : [],
					adverseReactions: [],
					interactions: [],
					dosage: cols[5],
					insuranceClass: (cols[6] as DrugRecord["insuranceClass"]) || undefined,
					prescriptionOnly: cols[7]?.toLowerCase() !== "false",
					source: "csv_import",
				});
				added++;
			} catch (error) {
				errors.push(`第 ${i + 1} 行: ${error instanceof Error ? error.message : String(error)}`);
				skipped++;
			}
		}
		return { added, skipped, errors };
	}

	/** Import labs from CSV: name,abbreviations(|),category,specimenType,referenceRange,unit,clinicalSignificance(|) */
	async importLabsCsv(csv: string): Promise<{ added: number; skipped: number; errors: string[] }> {
		const lines = csv.trim().split(/\r?\n/);
		if (lines.length < 2) return { added: 0, skipped: 0, errors: ["CSV 需要至少一行表头和一行数据"] };
		const errors: string[] = [];
		let added = 0;
		let skipped = 0;
		for (let i = 1; i < lines.length; i++) {
			const cols = this.parseCsvLine(lines[i]);
			if (cols.length < 2) { errors.push(`第 ${i + 1} 行: 列数不足`); skipped++; continue; }
			try {
				await this.addLabExam({
					name: cols[0],
					abbreviations: cols[1] ? cols[1].split("|").filter(Boolean) : [],
					category: (cols[2] as LabExamRecord["category"]) || "lab",
					specimenType: cols[3],
					referenceRanges: cols[4] ? [{ label: "成人", range: cols[4], unit: cols[5] ?? "" }] : [],
					clinicalSignificance: cols[6] ? cols[6].split("|").filter(Boolean) : [],
					source: "csv_import",
				});
				added++;
			} catch (error) {
				errors.push(`第 ${i + 1} 行: ${error instanceof Error ? error.message : String(error)}`);
				skipped++;
			}
		}
		return { added, skipped, errors };
	}

	private parseCsvLine(line: string): string[] {
		const result: string[] = [];
		let current = "";
		let inQuotes = false;
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === '"') {
				if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
				else inQuotes = !inQuotes;
			} else if (char === "," && !inQuotes) {
				result.push(current.trim());
				current = "";
			} else current += char;
		}
		result.push(current.trim());
		return result;
	}
}

let kbInstance: MedicalKnowledgeBase | null = null;

export function getMedicalKnowledgeBase(): MedicalKnowledgeBase {
	if (!kbInstance) kbInstance = new MedicalKnowledgeBase();
	return kbInstance;
}

export function setMedicalKnowledgeBase(instance: MedicalKnowledgeBase): void {
	kbInstance = instance;
}
