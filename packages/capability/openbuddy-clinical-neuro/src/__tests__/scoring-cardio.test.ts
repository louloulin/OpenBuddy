import { describe, expect, it } from "vitest";
import { scoreCardioScale } from "../scoring-cardio";

function items(map: Record<string, number>) {
	return Object.entries(map).map(([id, value]) => ({ id, label: id, value, selection: "" }));
}

describe("cardiovascular scoring", () => {
	it("scores CHA2DS2-VASc high risk (female, 78, HTN, DM, stroke)", () => {
		const result = scoreCardioScale("chads_vasc", items({ htn: 1, age75: 1, dm: 1, stroke: 1, sex: 1 }));
		expect(result.totalScore).toBe(7);
		expect(result.severity).toBe("critical");
		expect(result.interpretation).toContain("抗凝");
	});

	it("scores CHA2DS2-VASc zero (male, <65, no risk)", () => {
		const result = scoreCardioScale("chads_vasc", items({ chf: 0, htn: 0, age75: 0, dm: 0, stroke: 0, vascular: 0, age65: 0, sex: 0 }));
		expect(result.totalScore).toBe(0);
		expect(result.severity).toBe("normal");
	});

	it("scores HAS-BLED high bleeding risk", () => {
		const result = scoreCardioScale("has_bled", items({ htn: 1, stroke: 1, bleeding: 1, elderly: 1 }));
		expect(result.totalScore).toBe(4);
		expect(result.severity).toBe("severe");
	});

	it("scores Killip IV cardiogenic shock", () => {
		const result = scoreCardioScale("killip", items({ class: 3 }));
		expect(result.totalScore).toBe(4);
		expect(result.severity).toBe("critical");
		expect(result.interpretation).toContain("81%");
	});

	it("scores NYHA class III", () => {
		const result = scoreCardioScale("nyha", items({ class: 2 }));
		expect(result.totalScore).toBe(3);
		expect(result.severity).toBe("moderate");
	});

	it("scores GRACE high risk", () => {
		const result = scoreCardioScale("grace", items({ age: 5, hr: 3, sbp: 1, creatinine: 3, killip: 3, cardiac_arrest: 1, st_deviation: 1, elevated_markers: 1 }));
		expect(result.totalScore).toBe(48 + 11 + 53 + 10 + 59 + 39 + 28 + 14);
		expect(result.totalScore).toBe(262);
		expect(result.severity).toBe("critical");
	});
});
