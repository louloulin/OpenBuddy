import { describe, expect, it } from "vitest";
import { getImportTemplateRegistry, MEDICAL_DRUG_TEMPLATE, MEDICAL_LAB_TEMPLATE } from "../import-template";
import { UniversalImportEngine, detectImportFormat } from "../universal-import";

describe("ImportTemplateRegistry", () => {
	it("lists built-in medical templates", () => {
		const registry = getImportTemplateRegistry();
		const medical = registry.list("medical");
		expect(medical.length).toBeGreaterThanOrEqual(3);
		expect(medical.map((t) => t.id)).toContain("medical-drug");
		expect(medical.map((t) => t.id)).toContain("medical-lab");
		expect(medical.map((t) => t.id)).toContain("medical-disease");
	});

	it("registers custom template from JSON", () => {
		const registry = getImportTemplateRegistry();
		const template = registry.registerFromJson({
			id: "chemistry-compound",
			name: "化合物名目",
			description: "化学化合物数据导入",
			domain: "chemistry",
			storageCollection: "compounds",
			primaryKey: "formula",
			fields: [
				{ name: "formula", label: "分子式", type: "string", required: true, synonyms: ["分子式", "formula"], description: "化学分子式" },
				{ name: "name", label: "名称", type: "string", required: true, synonyms: ["名称", "化合物名", "name"], description: "化合物名称" },
			],
			llmInstructions: "识别化合物数据",
		});
		expect(template.id).toBe("chemistry-compound");
		expect(registry.get("chemistry-compound")).toBeDefined();
		expect(registry.list("chemistry")).toHaveLength(1);
	});
});

describe("UniversalImportEngine", () => {
	it("detects file format from extension", () => {
		expect(detectImportFormat("data.csv")).toBe("csv");
		expect(detectImportFormat("data.xlsx")).toBe("xlsx");
		expect(detectImportFormat("data.json")).toBe("json");
		expect(detectImportFormat("data.pdf")).toBe("unknown");
	});

	it("auto-detects drug template from CSV headers", async () => {
		const engine = new UniversalImportEngine();
		const csv = `通用名,商品名,药理分类,适应症,用法用量
阿司匹林,拜阿司匹灵,抗血小板药,心肌梗死|脑卒中,100mg qd
氯吡格雷,波立维,抗血小板药,急性冠脉综合征,75mg qd`;
		const result = await engine.detectTemplate({ fileName: "drugs.csv", content: csv, format: "csv" });
		expect(result.templateId).toBe("medical-drug");
		expect(result.confidence).toBeGreaterThan(0.5);
	});

	it("previews drug import with rule-based matching", async () => {
		const engine = new UniversalImportEngine();
		const csv = `通用名,商品名,药理分类,适应症,禁忌症,用法用量,医保类别
阿司匹林,拜阿司匹灵|巴米尔,抗血小板药,心肌梗死|脑卒中二级预防,活动性出血|过敏,100mg qd,甲类
氯吡格雷,波立维,抗血小板药,ACS|缺血性卒中,活动性出血,75mg qd,乙类`;
		const preview = await engine.preview({ fileName: "drugs.csv", content: csv, format: "csv" }, "medical-drug");
		expect(preview.templateId).toBe("medical-drug");
		expect(preview.totalExtracted).toBe(2);
		expect(preview.records[0].data.genericName).toBe("阿司匹林");
		expect(preview.records[0].data.brandNames).toEqual(["拜阿司匹灵", "巴米尔"]);
		expect(preview.records[0].data.indications).toEqual(["心肌梗死", "脑卒中二级预防"]);
		expect(preview.records[0].confidence).toBeGreaterThan(0.8);
	});

	it("previews lab import with Chinese column names", async () => {
		const engine = new UniversalImportEngine();
		const csv = `项目名称,英文缩写,标本类型,参考范围,单位,临床意义
高敏肌钙蛋白I,hs-cTnI|cTnI,血清,<0.04,ng/mL,心肌损伤|AMI诊断
B型钠尿肽,BNP|NT-proBNP,血浆,<100,pg/mL,心力衰竭诊断`;
		const preview = await engine.preview({ fileName: "labs.csv", content: csv, format: "csv" }, "medical-lab");
		expect(preview.totalExtracted).toBe(2);
		expect(preview.records[0].data.name).toBe("高敏肌钙蛋白I");
		expect(preview.records[0].data.abbreviations).toEqual(["hs-cTnI", "cTnI"]);
	});

	it("handles messy column names via fuzzy matching", async () => {
		const engine = new UniversalImportEngine();
		const csv = `药品名称(必填),厂家商品名,治疗类别,主治疾病,用法与用量,医保类型
华法林,华法林钠,抗凝药,房颤|DVT,个体化,甲类`;
		const preview = await engine.preview({ fileName: "messy.csv", content: csv, format: "csv" }, "medical-drug");
		expect(preview.records).toHaveLength(1);
		expect(preview.records[0].data.genericName).toBe("华法林");
		expect(preview.records[0].data.dosage).toBe("个体化");
	});
});
