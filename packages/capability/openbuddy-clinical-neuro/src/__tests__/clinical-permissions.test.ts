import { describe, expect, it } from "vitest";
import { ClinicalPermissionResolver, type ClinicalActor } from "../clinical-permissions";

const attending: ClinicalActor = { id: "dr-001", role: "attending", ward: "neurosurgery" };
const resident: ClinicalActor = { id: "dr-002", role: "resident", ward: "neurology" };
const nurse: ClinicalActor = { id: "nurse-001", role: "nurse", ward: "nicu" };

describe("ClinicalPermissionResolver", () => {
	const resolver = new ClinicalPermissionResolver();

	it("denies without reason for use", () => {
		const result = resolver.check({ actor: attending, action: "read_ehr", reasonForUse: "" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("用途说明");
	});

	it("denies with short reason", () => {
		const result = resolver.check({ actor: attending, action: "read_ehr", reasonForUse: "看病" });
		expect(result.allowed).toBe(false);
	});

	it("allows attending for clinical actions with valid reason", () => {
		const result = resolver.check({ actor: attending, action: "run_differential", reasonForUse: "辅助该患者鉴别诊断评估" });
		expect(result.allowed).toBe(true);
	});

	it("denies nurse from running differential diagnosis", () => {
		const result = resolver.check({ actor: nurse, action: "run_differential", reasonForUse: "护士站需要辅助判断病情" });
		expect(result.allowed).toBe(false);
	});

	it("allows nurse scoring and reading", () => {
		expect(resolver.check({ actor: nurse, action: "run_scoring", reasonForUse: "床旁 GCS 评分记录" }).allowed).toBe(true);
		expect(resolver.check({ actor: nurse, action: "read_ehr", reasonForUse: "查看患者生命体征和护理记录" }).allowed).toBe(true);
	});

	it("denies resident from managing permissions", () => {
		const result = resolver.check({ actor: resident, action: "manage_permissions", reasonForUse: "需要调整科室权限配置" });
		expect(result.allowed).toBe(false);
	});

	it("denies unknown role", () => {
		const result = resolver.check({ actor: { id: "x", role: "guest" as never }, action: "read_ehr", reasonForUse: "查看病历资料用于会诊" });
		expect(result.allowed).toBe(false);
	});
});
