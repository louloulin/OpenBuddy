import { describe, expect, it } from "vitest";
import { scoreClinicalScale, type ScaleItem } from "../scoring";

function items(map: Record<string, number>): ScaleItem[] {
	return Object.entries(map).map(([id, value]) => ({ id, label: id, value, selection: "" }));
}

describe("clinical scoring", () => {
	it("scores a normal NIHSS (all zeros)", () => {
		const zero = Object.fromEntries(["1a","1b","1c","2","3","4","5a","5b","6a","6b","7","8","9","10","11"].map((id) => [id, 0]));
		const result = scoreClinicalScale({ scaleId: "nihss", items: items(zero) });
		expect(result.totalScore).toBe(0);
		expect(result.severity).toBe("normal");
	});

	it("scores a moderate NIHSS", () => {
		const map: Record<string, number> = { "1a": 0, "1b": 0, "1c": 0, "2": 1, "3": 0, "4": 1, "5a": 2, "5b": 0, "6a": 2, "6b": 0, "7": 0, "8": 1, "9": 1, "10": 0, "11": 0 };
		const result = scoreClinicalScale({ scaleId: "nihss", items: items(map) });
		expect(result.totalScore).toBe(8);
		expect(result.severity).toBe("moderate");
		expect(result.disclaimer).toContain("主诊医师");
	});

	it("scores GCS correctly", () => {
		const result = scoreClinicalScale({ scaleId: "gcs", items: items({ eye: 1, verbal: 2, motor: 3 }) });
		expect(result.totalScore).toBe(3 + 3 + 3);
		expect(result.severity).toBe("moderate");
		expect(result.interpretation).toContain("中度");
	});

	it("scores Hunt-Hess grade III", () => {
		const result = scoreClinicalScale({ scaleId: "hunt_hess", items: items({ grade: 2 }) });
		expect(result.totalScore).toBe(3);
		expect(result.interpretation).toContain("III 级");
		expect(result.severity).toBe("severe");
	});

	it("scores Fisher CT grade IV", () => {
		const result = scoreClinicalScale({ scaleId: "fisher_ct", items: items({ grade: 3 }) });
		expect(result.totalScore).toBe(4);
		expect(result.severity).toBe("critical");
	});

	it("scores ASPECTS with all 10 regions normal", () => {
		const all = Object.fromEntries(["caudate","lentiform","internal_capsule","insula","m1","m2","m3","m4","m5","m6"].map((id) => [id, 0]));
		const result = scoreClinicalScale({ scaleId: "aspects", items: items(all) });
		expect(result.totalScore).toBe(10);
		expect(result.severity).toBe("mild");
	});

	it("throws on unknown scale", () => {
		expect(() => scoreClinicalScale({ scaleId: "unknown" as never, items: [] })).toThrow();
	});
});
