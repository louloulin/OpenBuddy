import { describe, expect, it } from "vitest";
import { redactPhi } from "../phi-redactor";

describe("PHI redactor", () => {
	it("redacts Chinese national ID card numbers", () => {
		const input = "患者张三，身份证号 420106199001011234，因头痛就诊";
		const result = redactPhi(input);
		expect(result.redacted).not.toContain("420106199001011234");
		expect(result.stats.idCard).toBe(1);
		expect(result.redacted).toContain("[PHI-IDCARD-1]");
	});

	it("redacts mobile phone numbers", () => {
		const result = redactPhi("联系电话 13812345678");
		expect(result.redacted).not.toContain("13812345678");
		expect(result.stats.phone).toBe(1);
	});

	it("redacts patient names adjacent to medical context markers", () => {
		const input = "患者：王小明，男，45岁，主诉突发剧烈头痛";
		const result = redactPhi(input);
		expect(result.stats.chineseName).toBe(1);
		expect(result.redacted).not.toContain("王小明");
	});

	it("redacts dates of birth / clinical dates", () => {
		const input = "出生日期 1985年03月12日，入院日期 2024/01/15";
		const result = redactPhi(input);
		expect(result.stats.dateOfBirth).toBeGreaterThanOrEqual(2);
	});

	it("redacts medical record numbers", () => {
		const input = "住院号: 2024015678，门诊号 M12345";
		const result = redactPhi(input);
		expect(result.stats.medicalRecordNumber).toBeGreaterThanOrEqual(1);
		expect(result.redacted).not.toContain("2024015678");
	});

	it("produces stable fingerprint", () => {
		const input = "患者李四，电话 13987654321";
		const a = redactPhi(input);
		const b = redactPhi(input);
		expect(a.fingerprint).toBe(b.fingerprint);
		expect(a.stats.total).toBeGreaterThan(0);
	});

	it("handles empty input", () => {
		const result = redactPhi("");
		expect(result.redacted).toBe("");
		expect(result.stats.total).toBe(0);
	});

	it("preserves clinical content", () => {
		const input = "患者：王大明，GCS 评分 E3V4M5=12 分，右侧肢体肌力 3 级，CT 示左侧基底节区脑出血约 25ml";
		const result = redactPhi(input);
		expect(result.redacted).toContain("GCS");
		expect(result.redacted).toContain("基底节区脑出血");
		expect(result.redacted).toContain("25ml");
	});
});
