import { describe, expect, it } from "vitest";
import { scoreOrthoScale } from "../scoring-ortho";

function items(map: Record<string, number>) {
	return Object.entries(map).map(([id, value]) => ({ id, label: id, value, selection: "" }));
}

describe("orthopedic scoring", () => {
	it("scores Harris Hip excellent", () => {
		const result = scoreOrthoScale("harris_hip", items({ pain: 0, limp: 0, support: 0, distance: 0, stairs: 0, sitting: 0, transport: 0, shoes: 0, deformity: 0, rom: 0 }));
		expect(result.totalScore).toBe(100);
		expect(result.severity).toBe("normal");
	});

	it("scores Harris Hip poor (severe pain + can't walk)", () => {
		const result = scoreOrthoScale("harris_hip", items({ pain: 5, limp: 3, support: 5, distance: 4, stairs: 3, sitting: 2, transport: 1, shoes: 2, deformity: 1, rom: 3 }));
		expect(result.totalScore).toBeLessThan(60);
		expect(result.severity).toBe("critical");
	});

	it("scores Garden IV displaced fracture", () => {
		const result = scoreOrthoScale("garden", items({ stage: 3 }));
		expect(result.totalScore).toBe(4);
		expect(result.severity).toBe("critical");
		expect(result.interpretation).toContain("关节置换");
	});

	it("scores Mirels high risk pathological fracture", () => {
		const result = scoreOrthoScale("mirels", items({ site: 2, pain: 2, lesion: 2, size: 2 }));
		expect(result.totalScore).toBe(12);
		expect(result.severity).toBe("critical");
		expect(result.interpretation).toContain("预防性");
	});

	it("scores Oxford Knee excellent", () => {
		const allPerfect = { pain_walk: 0, pain_night: 0, washing: 0, transport: 0, standing: 0, kneeling: 0, stairs: 0, shopping: 0, limp: 0, kneel_up: 0, stairs_up: 0, swelling: 0 };
		const result = scoreOrthoScale("oxford_knee", items(allPerfect));
		expect(result.totalScore).toBe(48);
		expect(result.severity).toBe("normal");
	});

	it("throws on unknown scale", () => {
		expect(() => scoreOrthoScale("unknown" as never, [])).toThrow();
	});
});
