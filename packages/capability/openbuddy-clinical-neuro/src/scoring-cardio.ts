import type { ScaleItem, ScaleScore } from "./scoring";

export const CARDIO_SCALE_DISCLAIMER = "本评分仅供临床参考，最终判断以主诊医师意见为准。";

// ============================================================================
// CHA₂DS₂-VASc — Atrial fibrillation stroke risk
// ============================================================================

export const CHADS_VASC_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "chf", label: "充血性心力衰竭 (C)", options: ["无", "有"], scores: [0, 1] },
	{ id: "htn", label: "高血压 (H)", options: ["无", "有"], scores: [0, 1] },
	{ id: "age75", label: "年龄 ≥75 岁 (A₂)", options: ["<75 岁", "≥75 岁"], scores: [0, 2] },
	{ id: "dm", label: "糖尿病 (D)", options: ["无", "有"], scores: [0, 1] },
	{ id: "stroke", label: "卒中/TIA/血栓栓塞 (S₂)", options: ["无", "有"], scores: [0, 2] },
	{ id: "vascular", label: "血管疾病 (V)", options: ["无", "有"], scores: [0, 1] },
	{ id: "age65", label: "年龄 65-74 岁 (A)", options: ["<65 或 ≥75", "65-74"], scores: [0, 1] },
	{ id: "sex", label: "女性 (Sc)", options: ["男性", "女性"], scores: [0, 1] },
];

function chadsVascInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score === 0) return { interpretation: "0 分:卒中风险低(年卒中率 ~0.2%),男性可暂不抗凝", severity: "normal" };
	if (score === 1) return { interpretation: "1 分:低风险(年卒中率 ~0.6%),考虑抗凝或阿司匹林", severity: "mild" };
	if (score >= 2 && score <= 3) return { interpretation: `${score} 分:中风险(年卒中率 ~2-4%),推荐口服抗凝药(OAC)`, severity: "moderate" };
	if (score >= 4 && score <= 5) return { interpretation: `${score} 分:高风险(年卒中率 ~4-7%),强烈推荐口服抗凝药`, severity: "severe" };
	return { interpretation: `${score} 分:极高风险(年卒中率 >7%),必须抗凝(排除禁忌)`, severity: "critical" };
}

// ============================================================================
// HAS-BLED — Bleeding risk on anticoagulation
// ============================================================================

export const HAS_BLED_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "htn", label: "高血压 (SBP >160 mmHg)", options: ["无", "有"], scores: [0, 1] },
	{ id: "renal", label: "肾功能异常(透析/移植/Cr >200μmol/L)", options: ["无", "有"], scores: [0, 1] },
	{ id: "liver", label: "肝功能异常(Bil >2x/Cirrhosis)", options: ["无", "有"], scores: [0, 1] },
	{ id: "stroke", label: "卒中史", options: ["无", "有"], scores: [0, 1] },
	{ id: "bleeding", label: "出血史/出血倾向", options: ["无", "有"], scores: [0, 1] },
	{ id: "inr", label: "INR 不稳定(TTR <60%)", options: ["无", "有"], scores: [0, 1] },
	{ id: "elderly", label: "年龄 >65 岁", options: ["≤65", ">65"], scores: [0, 1] },
	{ id: "drugs", label: "同时用抗血小板/NSAID", options: ["无", "有"], scores: [0, 1] },
	{ id: "alcohol", label: "酗酒(≥8 杯/周)", options: ["无", "有"], scores: [0, 1] },
];

function hasBledInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score <= 1) return { interpretation: `${score} 分:出血风险低,可安全抗凝`, severity: "normal" };
	if (score === 2) return { interpretation: "2 分:出血风险中等,抗凝需谨慎监测", severity: "moderate" };
	return { interpretation: `${score} 分:出血风险高(≥3 分),需积极纠正可逆因素后再评估抗凝`, severity: "severe" };
}

// ============================================================================
// Killip — Acute myocardial infarction classification
// ============================================================================

export const KILLIP_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "class", label: "Killip 分级", options: ["I 级:无心衰", "II 级:轻-中度心衰(啰音<50%肺野/S3)", "III 级:重度心衰(肺水肿)", "IV 级:心源性休克"], scores: [1, 2, 3, 4] },
];

function killipInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	const map: Record<number, { interpretation: string; severity: ScaleScore["severity"] }> = {
		1: { interpretation: "Killip I:无心力衰竭征象,住院死亡率 6%", severity: "normal" },
		2: { interpretation: "Killip II:轻-中度心衰,住院死亡率 17%", severity: "moderate" },
		3: { interpretation: "Killip III:重度心衰/肺水肿,住院死亡率 38%", severity: "severe" },
		4: { interpretation: "Killip IV:心源性休克,住院死亡率 81%", severity: "critical" },
	};
	return map[score] ?? { interpretation: "无效", severity: "not-applicable" };
}

// ============================================================================
// NYHA — Heart failure functional classification
// ============================================================================

export const NYHA_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "class", label: "NYHA 心功能分级", options: ["I 级:日常活动不受限", "II 级:日常活动轻度受限", "III 级:日常活动明显受限", "IV 级:休息时也有症状"], scores: [1, 2, 3, 4] },
];

function nyhaInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	const map: Record<number, { interpretation: string; severity: ScaleScore["severity"] }> = {
		1: { interpretation: "NYHA I:体力活动不受限,普通活动无症状", severity: "normal" },
		2: { interpretation: "NYHA II:体力活动轻度受限,休息时无症状", severity: "mild" },
		3: { interpretation: "NYHA III:体力活动明显受限,低于日常活动即有症状", severity: "moderate" },
		4: { interpretation: "NYHA IV:不能从事任何体力活动,休息时有症状", severity: "critical" },
	};
	return map[score] ?? { interpretation: "无效", severity: "not-applicable" };
}

// ============================================================================
// GRACE — ACS risk prediction (simplified bedside version)
// ============================================================================

export const GRACE_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "age", label: "年龄", options: ["<30", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "≥90"], scores: [0, 8, 18, 28, 38, 48, 58, 68] },
	{ id: "hr", label: "心率 (bpm)", options: ["<50", "50-69", "70-89", "90-109", "110-149", "150-199", "≥200"], scores: [0, 3, 7, 11, 17, 23, 29] },
	{ id: "sbp", label: "收缩压 (mmHg)", options: ["<80", "80-99", "100-119", "120-139", "140-159", "160-199", "≥200"], scores: [58, 53, 43, 34, 24, 14, 5] },
	{ id: "creatinine", label: "肌酐 (mg/dL)", options: ["0-0.39", "0.4-0.79", "0.8-1.19", "1.2-1.59", "1.6-1.99", "2.0-3.99", "≥4.0"], scores: [1, 4, 7, 10, 13, 21, 28] },
	{ id: "killip", label: "Killip 分级", options: ["I", "II", "III", "IV"], scores: [0, 20, 39, 59] },
	{ id: "cardiac_arrest", label: "入院时心跳骤停", options: ["无", "有"], scores: [0, 39] },
	{ id: "st_deviation", label: "ST 段偏移", options: ["无", "有"], scores: [0, 28] },
	{ id: "elevated_markers", label: "心肌标志物升高", options: ["无", "有"], scores: [0, 14] },
];

function graceInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score <= 108) return { interpretation: `GRACE ${score} 分:低风险(院内死亡率 <1%)`, severity: "normal" };
	if (score <= 140) return { interpretation: `GRACE ${score} 分:中风险(院内死亡率 1-3%)`, severity: "moderate" };
	return { interpretation: `GRACE ${score} 分:高风险(院内死亡率 >3%),需早期侵入策略`, severity: "critical" };
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
	return { scaleId: scaleId as never, totalScore: total, maxScore, interpretation, severity, items: scored, disclaimer: CARDIO_SCALE_DISCLAIMER };
}

export function scoreCardioScale(scaleId: string, items: readonly ScaleItem[]): ScaleScore {
	switch (scaleId) {
		case "chads_vasc": return calculate(items, CHADS_VASC_ITEMS, chadsVascInterpret, 9, scaleId);
		case "has_bled": return calculate(items, HAS_BLED_ITEMS, hasBledInterpret, 9, scaleId);
		case "killip": return calculate(items, KILLIP_ITEMS, killipInterpret, 4, scaleId);
		case "nyha": return calculate(items, NYHA_ITEMS, nyhaInterpret, 4, scaleId);
		case "grace": return calculate(items, GRACE_ITEMS, graceInterpret, 263, scaleId);
		default: throw new Error(`不支持的心血管评分: ${scaleId}`);
	}
}
