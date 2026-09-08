import type { ScaleItem, ScaleScore } from "./scoring";

export const ORTHO_SCALE_DISCLAIMER = "本评分仅供临床参考，最终判断以主诊医师意见为准。";

// ============================================================================
// Harris Hip Score — Hip function assessment
// ============================================================================

export const HARRIS_HIP_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "pain", label: "疼痛 (44分)", options: ["无/可忽略", "轻微/偶尔", "轻度,不影响活动", "中度,可忍受/日常活动受限", "明显,严重受限", "完全残疾/卧床"], scores: [44, 40, 30, 20, 10, 0] },
	{ id: "limp", label: "跛行 (11分)", options: ["无", "轻微", "中度", "严重/不能行走"], scores: [11, 8, 5, 0] },
	{ id: "support", label: "辅助器具 (11分)", options: ["无", "长时间行走需手杖", "大部分时间需手杖", "需拐杖", "需双拐", "不能行走"], scores: [11, 7, 5, 3, 0, 0] },
	{ id: "distance", label: "行走距离 (11分)", options: ["不受限", "≥6 个街区", "2-3 个街区", "室内", "仅床椅"], scores: [11, 8, 5, 2, 0] },
	{ id: "stairs", label: "上下楼梯 (4分)", options: ["正常", "需扶栏杆", "只能上/下", "不能"], scores: [4, 2, 1, 0] },
	{ id: "sitting", label: "坐姿 (5分)", options: ["任意椅子≥1h", "高椅子30min", "不能舒适坐>30min"], scores: [5, 3, 0] },
	{ id: "transport", label: "乘坐交通工具 (1分)", options: ["能", "不能"], scores: [1, 0] },
	{ id: "shoes", label: "穿鞋袜 (4分)", options: ["容易", "困难", "不能"], scores: [4, 2, 0] },
	{ id: "deformity", label: "畸形 (4分)", options: ["无固定屈曲畸形<30°/内收<10°/伸直位内旋<10°", "有上述畸形之一"], scores: [4, 0] },
	{ id: "rom", label: "活动范围 (5分)", options: ["正常/≥90%", "61-90%", "31-60%", "≤30%"], scores: [5, 3, 1, 0] },
];

function harrisHipInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score >= 90) return { interpretation: `${score} 分:优秀(90-100),髋关节功能良好`, severity: "normal" };
	if (score >= 80) return { interpretation: `${score} 分:良好(80-89),轻度功能障碍`, severity: "mild" };
	if (score >= 70) return { interpretation: `${score} 分:一般(70-79),中度功能障碍`, severity: "moderate" };
	if (score >= 60) return { interpretation: `${score} 分:差(60-69),明显功能障碍`, severity: "severe" };
	return { interpretation: `${score} 分:极差(<60),严重功能障碍,考虑手术`, severity: "critical" };
}

// ============================================================================
// Garden Classification — Femoral neck fracture
// ============================================================================

export const GARDEN_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "stage", label: "Garden 分型", options: ["I 型:不完全骨折/外翻嵌插", "II 型:完全骨折无移位", "III 型:完全骨折部分移位", "IV 型:完全骨折完全移位"], scores: [1, 2, 3, 4] },
];

function gardenInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	const map: Record<number, { interpretation: string; severity: ScaleScore["severity"] }> = {
		1: { interpretation: "Garden I:不完全骨折,可保守治疗或内固定", severity: "mild" },
		2: { interpretation: "Garden II:完全骨折无移位,内固定(空心螺钉)", severity: "moderate" },
		3: { interpretation: "Garden III:部分移位,内固定或关节置换(依年龄)", severity: "severe" },
		4: { interpretation: "Garden IV:完全移位,高龄患者考虑人工关节置换", severity: "critical" },
	};
	return map[score] ?? { interpretation: "无效分型", severity: "not-applicable" };
}

// ============================================================================
// Mirels Classification — Pathological fracture risk
// ============================================================================

export const MIRELS_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "site", label: "部位", options: ["上肢", "下肢", "髋周/转子间"], scores: [1, 2, 3] },
	{ id: "pain", label: "疼痛", options: ["轻度", "中度", "重度/机械性疼痛"], scores: [1, 2, 3] },
	{ id: "lesion", label: "影像(骨破坏)", options: ["成骨性/混合性", "溶骨性", "溶骨性>2/3周径"], scores: [1, 2, 3] },
	{ id: "size", label: "病变大小(相对周径)", options: ["<1/3", "1/3-2/3", ">2/3"], scores: [1, 2, 3] },
];

function mirelsInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score <= 7) return { interpretation: `Mirels ${score} 分:病理性骨折风险低(<5%),可保守治疗`, severity: "normal" };
	if (score <= 9) return { interpretation: `Mirels ${score} 分:骨折风险中等,考虑放疗±预防性固定`, severity: "moderate" };
	return { interpretation: `Mirels ${score} 分:骨折风险高(≥10 分),推荐预防性内固定+放疗`, severity: "critical" };
}

// ============================================================================
// AO/OTA — Fracture classification (simplified long bone)
// ============================================================================

export const AO_OTA_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "bone", label: "骨(编号)", options: ["肱骨(1)", "桡尺骨(2)", "股骨(3)", "胫腓骨(4)", "脊柱(5)", "骨盆(6)", "手(7)", "足(8)"], scores: [1, 2, 3, 4, 5, 6, 7, 8] },
	{ id: "segment", label: "节段", options: ["近端(1)", "骨干(2)", "远端(3)"], scores: [1, 2, 3] },
	{ id: "pattern", label: "骨折形态", options: ["简单(A)", "楔形(B)", "复杂(C)"], scores: [1, 2, 3] },
];

function aoOtaInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	return { interpretation: `AO/OTA 编码组合(骨-节段-形态):${score},需结合影像确定完整分型`, severity: "moderate" };
}

// ============================================================================
// Oxford Knee Score
// ============================================================================

export const OXFORD_KNEE_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "pain_walk", label: "走路时疼痛", options: ["无", "很轻", "轻度", "中度", "重度"], scores: [4, 3, 2, 1, 0] },
	{ id: "pain_night", label: "夜间疼痛", options: ["无", "很轻", "轻度", "中度", "重度"], scores: [4, 3, 2, 1, 0] },
	{ id: "washing", label: "洗漱/穿袜困难", options: ["无困难", "很少困难", "中度困难", "很大困难", "不能完成"], scores: [4, 3, 2, 1, 0] },
	{ id: "transport", label: "乘坐交通工具", options: ["能", "需辅助", "很困难", "不能"], scores: [4, 2, 1, 0] },
	{ id: "standing", label: "站立(>2min)", options: ["能", "需辅助", "很困难", "不能"], scores: [4, 2, 1, 0] },
	{ id: "kneeling", label: "跪下", options: ["能", "需辅助", "很困难", "不能"], scores: [4, 2, 1, 0] },
	{ id: "stairs", label: "下楼", options: ["无困难", "很少困难", "中度困难", "很大困难", "不能"], scores: [4, 3, 2, 1, 0] },
	{ id: "shopping", label: "站立做家务/购物", options: ["能", "需辅助", "很困难", "不能"], scores: [4, 2, 1, 0] },
	{ id: "limp", label: "跛行", options: ["无", "很少/轻度", "中度", "重度"], scores: [4, 2, 1, 0] },
	{ id: "kneel_up", label: "从椅子站起", options: ["能", "需辅助", "很困难", "不能"], scores: [4, 2, 1, 0] },
	{ id: "stairs_up", label: "上楼", options: ["无困难", "很少困难", "中度困难", "很大困难", "不能"], scores: [4, 3, 2, 1, 0] },
	{ id: "swelling", label: "膝关节肿胀", options: ["很少", "有时", "经常", "持续"], scores: [4, 3, 2, 1] },
];

function oxfordKneeInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score >= 42) return { interpretation: `${score} 分:膝关节功能优秀(42-48)`, severity: "normal" };
	if (score >= 34) return { interpretation: `${score} 分:良好(34-41)`, severity: "mild" };
	if (score >= 27) return { interpretation: `${score} 分:一般(27-33),可能需保守治疗`, severity: "moderate" };
	if (score >= 20) return { interpretation: `${score} 分:差(20-26),考虑手术干预`, severity: "severe" };
	return { interpretation: `${score} 分:极差(<20),强烈考虑关节置换`, severity: "critical" };
}

// ============================================================================
// Main scoring function
// ============================================================================

function calculate(items: readonly ScaleItem[], definitions: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }>, interpreter: (score: number) => { interpretation: string; severity: ScaleScore["severity"] }, maxScore: number, scaleId: string): ScaleScore {
	let total = 0;
	const scored: ScaleItem[] = [];
	for (const item of items) {
		const def = definitions.find((d) => d.id === item.id);
		if (!def) continue;
		const idx = Math.max(0, Math.min(item.value, def.scores.length - 1));
		total += def.scores[idx];
		scored.push({ ...item, selection: def.options[idx] ?? item.selection, value: idx });
	}
	const { interpretation, severity } = interpreter(total);
	return { scaleId: scaleId as never, totalScore: total, maxScore, interpretation, severity, items: scored, disclaimer: ORTHO_SCALE_DISCLAIMER };
}

export function scoreOrthoScale(scaleId: string, items: readonly ScaleItem[]): ScaleScore {
	switch (scaleId) {
		case "harris_hip": return calculate(items, HARRIS_HIP_ITEMS, harrisHipInterpret, 100, scaleId);
		case "garden": return calculate(items, GARDEN_ITEMS, gardenInterpret, 4, scaleId);
		case "mirels": return calculate(items, MIRELS_ITEMS, mirelsInterpret, 12, scaleId);
		case "ao_ota": return calculate(items, AO_OTA_ITEMS, aoOtaInterpret, 14, scaleId);
		case "oxford_knee": return calculate(items, OXFORD_KNEE_ITEMS, oxfordKneeInterpret, 48, scaleId);
		default: throw new Error(`不支持的骨科评分: ${scaleId}`);
	}
}
