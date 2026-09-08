import { describe, expect, it } from "vitest";
import { checkDifferentialSafety } from "../diagnosis-guard";
import type { DifferentialDiagnosisItem, DifferentialDiagnosisInput } from "../index";

const actor = { id: "dr-001", role: "attending" as const, ward: "neuro" };

function makeInput(text: string): DifferentialDiagnosisInput {
	return { clinicalText: text, actor, reasonForUse: "临床辅助鉴别诊断测试用例" };
}

function makeDiff(overrides: Partial<DifferentialDiagnosisItem> = {}): DifferentialDiagnosisItem {
	return {
		diagnosis: "急性缺血性脑卒中",
		likelihood: "high",
		supportingFindings: ["突发肢体无力", "言语不清"],
		conflictingFindings: ["CT 未见出血"],
		recommendedWorkup: ["头颅 MRI", "血管评估"],
		...overrides,
	};
}

describe("DiagnosisGuard", () => {
	it("passes with valid differential list", () => {
		const result = checkDifferentialSafety(
			makeInput("患者突发右侧肢体无力,言语不清,意识清楚GCS 15分,CT排除出血,生命体征平稳BP 130/80,血常规和生化正常,既往史无特殊,无过敏史"),
			[makeDiff(), makeDiff({ diagnosis: "TIA", likelihood: "low" }), makeDiff({ diagnosis: "低血糖脑病", likelihood: "low" })],
		);
		expect(result.severity).toBe("pass");
		expect(result.violations).toHaveLength(0);
	});

	it("warns when fewer than 3 differentials", () => {
		const result = checkDifferentialSafety(makeInput("头痛"), [makeDiff()]);
		expect(result.violations.some((v) => v.rule === "minimum_differentials")).toBe(true);
		expect(result.severity).toBe("warn");
	});

	it("blocks definitive diagnosis language", () => {
		const result = checkDifferentialSafety(
			makeInput("头痛"),
			[makeDiff({ diagnosis: "确诊为偏头痛" }), makeDiff({ diagnosis: "TIA" }), makeDiff({ diagnosis: "脑炎" })],
		);
		expect(result.violations.some((v) => v.rule === "no_definitive_conclusion" && v.severity === "block")).toBe(true);
		expect(result.severity).toBe("block");
	});

	it("warns when missing conflicting findings", () => {
		const result = checkDifferentialSafety(
			makeInput("头痛"),
			[makeDiff({ conflictingFindings: [] }), makeDiff({ conflictingFindings: [] }), makeDiff({ conflictingFindings: [] })],
		);
		expect(result.violations.filter((v) => v.rule === "require_conflicting_findings")).toHaveLength(3);
	});

	it("warns when no recommended workup", () => {
		const result = checkDifferentialSafety(
			makeInput("头痛"),
			[makeDiff({ recommendedWorkup: [] }), makeDiff({ recommendedWorkup: [] }), makeDiff({ recommendedWorkup: [] })],
		);
		expect(result.violations.filter((v) => v.rule === "require_recommended_workup")).toHaveLength(3);
	});

	it("promotes emergency when red flag detected but not covered first", () => {
		const result = checkDifferentialSafety(
			makeInput("患者突发剧烈头痛,伴呕吐"),
			[makeDiff({ diagnosis: "偏头痛", likelihood: "medium" }), makeDiff({ diagnosis: "紧张性头痛" }), makeDiff({ diagnosis: "脑炎" })],
		);
		expect(result.violations.some((v) => v.rule === "red_flag_emergency_check")).toBe(true);
		expect(result.differentials[0].diagnosis).toContain("蛛网膜下腔出血");
	});

	it("caps high confidence when critical data is missing", () => {
		const result = checkDifferentialSafety(
			makeInput("头痛"), // Missing vitals, imaging, labs, history
			[makeDiff({ likelihood: "high" }), makeDiff({ likelihood: "high" }), makeDiff({ likelihood: "low" })],
		);
		expect(result.violations.some((v) => v.rule === "confidence_cap_missing_data")).toBe(true);
		expect(result.differentials.every((d) => d.likelihood !== "high")).toBe(true);
	});

	it("generates safety banner with violation summary", () => {
		const result = checkDifferentialSafety(makeInput("头痛"), [makeDiff()]);
		expect(result.safetyBanner).toContain("安全护栏");
		expect(result.safetyBanner).toContain("鉴别");
	});
});
