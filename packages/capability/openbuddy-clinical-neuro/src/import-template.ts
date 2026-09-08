// ============================================================================
// Universal Import Template System — domain-agnostic
// ============================================================================

export type ImportFieldType = "string" | "string[]" | "boolean" | "number" | "enum" | "object";

export interface ImportFieldDefinition {
	readonly name: string;
	readonly label: string;
	readonly type: ImportFieldType;
	readonly /** For enum type: allowed values. */
	enumValues?: readonly string[];
	readonly /** Is this field required for a valid record? */
	required: boolean;
	readonly /** Synonyms for rule-based column matching. */
	synonyms: readonly string[];
	readonly /** Brief description for LLM prompt. */
	description: string;
	readonly /** How to split multi-value fields. */
	multiValueSeparator?: RegExp;
}

export interface ImportTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly /** Domain category (e.g., "medical", "chemistry", "finance"). */
	domain: string;
	readonly /** Icon for UI display. */
	icon?: string;
	readonly /** Target storage collection name. */
	storageCollection: string;
	readonly /** Primary key field for dedup. */
	primaryKey: string;
	readonly /** Field definitions. */
	fields: readonly ImportFieldDefinition[];
	readonly /** Domain-specific LLM extraction instructions. */
	llmInstructions: string;
	readonly /** Validation: function name or regex pattern per field. */
	validation?: Record<string, string>;
}

// ============================================================================
// Built-in Medical Templates
// ============================================================================

export const MEDICAL_DRUG_TEMPLATE: ImportTemplate = {
	id: "medical-drug",
	name: "药品名目",
	description: "导入药品目录:通用名、商品名、适应症、禁忌症、用法用量等",
	domain: "medical",
	icon: "💊",
	storageCollection: "drugs",
	primaryKey: "genericName",
	fields: [
		{ name: "genericName", label: "通用名", type: "string", required: true, synonyms: ["通用名", "药品名称", "药品名", "品名", "药名", "generic", "drug_name"], description: "药品通用名(中文)" },
		{ name: "brandNames", label: "商品名", type: "string[]", required: false, synonyms: ["商品名", "品牌", "商标名", "brand", "trade_name"], description: "商品名/品牌名数组", multiValueSeparator: /[|;；]/u },
		{ name: "englishName", label: "英文名", type: "string", required: false, synonyms: ["英文名", "英文", "english"], description: "英文名" },
		{ name: "category", label: "药理分类", type: "string", required: false, synonyms: ["分类", "类别", "药理分类", "category", "class"], description: "药理分类(如抗血小板药)" },
		{ name: "indications", label: "适应症", type: "string[]", required: false, synonyms: ["适应症", "适应证", "主治", "功能主治", "indication"], description: "适应症数组", multiValueSeparator: /[|;；]/u },
		{ name: "contraindications", label: "禁忌症", type: "string[]", required: false, synonyms: ["禁忌症", "禁忌", "禁忌证", "contraindication"], description: "禁忌症数组", multiValueSeparator: /[|;；]/u },
		{ name: "adverseReactions", label: "不良反应", type: "string[]", required: false, synonyms: ["不良反应", "副作用", "adverse", "sideEffect"], description: "不良反应数组", multiValueSeparator: /[|;；]/u },
		{ name: "interactions", label: "相互作用", type: "string[]", required: false, synonyms: ["相互作用", "药物相互作用", "interaction"], description: "药物相互作用数组", multiValueSeparator: /[|;；]/u },
		{ name: "dosage", label: "用法用量", type: "string", required: false, synonyms: ["用法用量", "剂量", "用量", "用法", "dosage", "dose"], description: "常用剂量(如 100mg qd)" },
		{ name: "insuranceClass", label: "医保类别", type: "enum", enumValues: ["甲类", "乙类", "自费"], required: false, synonyms: ["医保类别", "医保", "insurance"], description: "医保类别" },
		{ name: "prescriptionOnly", label: "处方药", type: "boolean", required: false, synonyms: ["处方药", "是否处方药", "Rx", "prescription"], description: "是否处方药(true/false)" },
		{ name: "pregnancyCategory", label: "妊娠分级", type: "enum", enumValues: ["A", "B", "C", "D", "X"], required: false, synonyms: ["妊娠分级", "妊娠", "pregnancy"], description: "妊娠期用药分级" },
	],
	llmInstructions: `识别药品名目数据。注意:
- "100mg 每日一次" → dosage: "100mg qd"
- "拜阿司匹灵|巴米尔" → brandNames: ["拜阿司匹灵", "巴米尔"]
- 医保类别只能是:甲类、乙类、自费
- 处方药:是/Rx/true → true;否/OTC/false → false
- 忽略序号、备注、更新时间等无关列`,
};

export const MEDICAL_LAB_TEMPLATE: ImportTemplate = {
	id: "medical-lab",
	name: "检查项目",
	description: "导入检验/检查项目目录:名称、缩写、参考范围、临床意义等",
	domain: "medical",
	icon: "🧪",
	storageCollection: "labs",
	primaryKey: "name",
	fields: [
		{ name: "name", label: "项目名称", type: "string", required: true, synonyms: ["项目名称", "检验项目", "检查项目", "名称", "test_name"], description: "检查/检验项目名称" },
		{ name: "abbreviations", label: "缩写", type: "string[]", required: false, synonyms: ["缩写", "简称", "英文缩写", "abbr", "abbreviation"], description: "缩写数组", multiValueSeparator: /[|;；,，]/u },
		{ name: "category", label: "类别", type: "enum", enumValues: ["lab", "imaging", "function", "pathology"], required: false, synonyms: ["类别", "分类", "类型", "category"], description: "类别:lab/imaging/function/pathology" },
		{ name: "specimenType", label: "标本类型", type: "string", required: false, synonyms: ["标本类型", "标本", "样本类型", "specimen"], description: "标本类型(血清/血浆/全血/尿液等)" },
		{ name: "referenceRanges", label: "参考范围", type: "string", required: false, synonyms: ["参考范围", "参考值", "正常值", "reference"], description: "参考范围(如 3.9-6.1)" },
		{ name: "unit", label: "单位", type: "string", required: false, synonyms: ["单位", "计量单位", "unit"], description: "计量单位" },
		{ name: "clinicalSignificance", label: "临床意义", type: "string[]", required: false, synonyms: ["临床意义", "意义", "significance"], description: "临床意义数组", multiValueSeparator: /[|;；]/u },
		{ name: "criticalValues", label: "危急值", type: "string", required: false, synonyms: ["危急值", "critical", "panic"], description: "危急值定义" },
	],
	llmInstructions: `识别检验/检查项目数据。注意:
- "3.9-6.1 mmol/L" → referenceRanges: "3.9-6.1", unit: "mmol/L"
- 类别映射:化验→lab, 影像→imaging, 功能检查→function, 病理→pathology
- 缩写如 "hs-cTnI|cTnI" → ["hs-cTnI", "cTnI"]`,
};

export const MEDICAL_DISEASE_TEMPLATE: ImportTemplate = {
	id: "medical-disease",
	name: "疾病名目",
	description: "导入疾病目录:ICD-10编码、疾病名称、科室等",
	domain: "medical",
	icon: "🏥",
	storageCollection: "diseases",
	primaryKey: "icd10",
	fields: [
		{ name: "icd10", label: "ICD-10编码", type: "string", required: true, synonyms: ["ICD", "ICD-10", "ICD编码", "icd"], description: "ICD-10 编码(如 I63.9)" },
		{ name: "name", label: "疾病名称", type: "string", required: true, synonyms: ["疾病名称", "诊断名称", "名称", "病名", "diagnosis"], description: "疾病中文名" },
		{ name: "englishName", label: "英文名", type: "string", required: false, synonyms: ["英文名", "英文", "english"], description: "疾病英文名" },
		{ name: "department", label: "科室", type: "string", required: false, synonyms: ["科室", "就诊科室", "department", "dept"], description: "所属科室" },
	],
	llmInstructions: `识别疾病名目数据。注意:
- ICD-10编码格式如 I63.9、E11.9、S72.0
- 必须同时有编码和名称才算有效记录`,
};

// ============================================================================
// Template Registry — extensible for any domain
// ============================================================================

export class ImportTemplateRegistry {
	private templates = new Map<string, ImportTemplate>();

	constructor() {
		// Built-in medical templates
		this.register(MEDICAL_DRUG_TEMPLATE);
		this.register(MEDICAL_LAB_TEMPLATE);
		this.register(MEDICAL_DISEASE_TEMPLATE);
	}

	register(template: ImportTemplate): void {
		this.templates.set(template.id, template);
	}

	get(id: string): ImportTemplate | undefined {
		return this.templates.get(id);
	}

	list(domain?: string): ImportTemplate[] {
		const all = [...this.templates.values()];
		return domain ? all.filter((t) => t.domain === domain) : all;
	}

	/** Register a custom template from a JSON definition. */
	registerFromJson(json: Record<string, unknown>): ImportTemplate {
		const template: ImportTemplate = {
			id: String(json.id ?? `custom_${Date.now()}`),
			name: String(json.name ?? "自定义模板"),
			description: String(json.description ?? ""),
			domain: String(json.domain ?? "custom"),
			icon: json.icon ? String(json.icon) : undefined,
			storageCollection: String(json.storageCollection ?? "custom"),
			primaryKey: String(json.primaryKey ?? "id"),
			fields: Array.isArray(json.fields) ? json.fields as ImportFieldDefinition[] : [],
			llmInstructions: String(json.llmInstructions ?? ""),
		};
		this.register(template);
		return template;
	}
}

let registryInstance: ImportTemplateRegistry | null = null;

export function getImportTemplateRegistry(): ImportTemplateRegistry {
	if (!registryInstance) registryInstance = new ImportTemplateRegistry();
	return registryInstance;
}
