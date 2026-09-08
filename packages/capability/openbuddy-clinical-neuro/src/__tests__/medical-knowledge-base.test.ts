import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MedicalKnowledgeBase } from "../medical-knowledge-base";

let tempDir: string | null = null;

afterEach(async () => {
	if (tempDir) { await rm(tempDir, { recursive: true, force: true }).catch(() => undefined); tempDir = null; }
});

async function makeKb(): Promise<MedicalKnowledgeBase> {
	tempDir = await mkdtemp(join(tmpdir(), "medical-kb-"));
	return new MedicalKnowledgeBase(join(tempDir, "kb.json"));
}

describe("MedicalKnowledgeBase", () => {
	it("adds and searches drugs by generic name", async () => {
		const kb = await makeKb();
		await kb.addDrug({
			genericName: "阿司匹林", brandNames: ["拜阿司匹灵", "巴米尔"], englishName: "Aspirin",
			category: "抗血小板药", indications: ["急性心肌梗死", "缺血性脑卒中二级预防"],
			contraindications: ["活动性消化道出血", "阿司匹林过敏"],
			adverseReactions: ["胃肠道出血", "过敏反应"], interactions: ["与华法林合用增加出血风险"],
			dosage: "100mg qd", insuranceClass: "甲类", prescriptionOnly: false,
		});
		const results = await kb.search({ keyword: "阿司匹林", type: "drug" });
		expect(results).toHaveLength(1);
		expect(results[0].drug?.genericName).toBe("阿司匹林");
	});

	it("searches drugs by brand name", async () => {
		const kb = await makeKb();
		await kb.addDrug({
			genericName: "阿司匹林", brandNames: ["拜阿司匹灵"], category: "抗血小板药",
			indications: [], contraindications: [], adverseReactions: [], interactions: [],
			prescriptionOnly: false,
		});
		const results = await kb.search({ keyword: "拜阿司匹灵" });
		expect(results).toHaveLength(1);
	});

	it("adds and searches lab exams", async () => {
		const kb = await makeKb();
		await kb.addLabExam({
			name: "高敏肌钙蛋白I", abbreviations: ["hs-cTnI", "cTnI"], category: "lab",
			specimenType: "血清", referenceRanges: [{ label: "成人", range: "<0.04", unit: "ng/mL" }],
			clinicalSignificance: ["升高提示心肌损伤", "用于急性心肌梗死诊断"],
			criticalValues: [{ condition: ">0.1", value: "危急值:提示急性心肌梗死可能" }],
		});
		const byName = await kb.search({ keyword: "肌钙蛋白", type: "lab" });
		expect(byName).toHaveLength(1);
		const byAbbr = await kb.search({ keyword: "cTnI", type: "lab" });
		expect(byAbbr).toHaveLength(1);
	});

	it("adds and searches diseases by ICD-10", async () => {
		const kb = await makeKb();
		await kb.addDisease({ icd10: "I63.9", name: "脑梗死", englishName: "Cerebral infarction", department: "神经内科" });
		const byIcd = await kb.search({ keyword: "I63", type: "disease" });
		expect(byIcd).toHaveLength(1);
		const byName = await kb.search({ keyword: "脑梗死", type: "disease" });
		expect(byName).toHaveLength(1);
	});

	it("imports drugs from CSV", async () => {
		const kb = await makeKb();
		const csv = `genericName,brandNames,category,indications,contraindications,dosage,insuranceClass,prescriptionOnly
"氯吡格雷","波立维|泰嘉","抗血小板药","急性冠脉综合征|缺血性卒中","活动性出血|严重肝功能不全","75mg qd","乙类","true"
"阿托伐他汀","立普妥|阿乐","调脂药","高胆固醇血症|心血管风险","活动性肝病|妊娠","20mg qn","乙类","true"`;
		const result = await kb.importDrugsCsv(csv);
		expect(result.added).toBe(2);
		expect(result.errors).toHaveLength(0);
		const search = await kb.search({ keyword: "波立维" });
		expect(search).toHaveLength(1);
	});

	it("returns correct stats", async () => {
		const kb = await makeKb();
		await kb.addDrug({ genericName: "测试药", brandNames: [], category: "测试", indications: [], contraindications: [], adverseReactions: [], interactions: [], prescriptionOnly: true });
		await kb.addLabExam({ name: "测试检查", abbreviations: [], category: "lab", referenceRanges: [], clinicalSignificance: [] });
		await kb.addDisease({ icd10: "I10", name: "高血压", department: "心内科" });
		const stats = await kb.stats();
		expect(stats.drugs).toBe(1);
		expect(stats.labs).toBe(1);
		expect(stats.diseases).toBe(1);
	});
});
