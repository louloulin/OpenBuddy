export type ClinicalScaleId = "nihss" | "gcs" | "hunt_hess" | "fisher_ct" | "mrs" | "aspects";

export interface ScaleItem {
	readonly id: string;
	readonly label: string;
	readonly /** 0-based option index selected by the clinician. */
	value: number;
	readonly /** Human-readable selected option text. */
	selection: string;
}

export interface ScaleInput {
	readonly scaleId: ClinicalScaleId;
	readonly items: readonly ScaleItem[];
}

export interface ScaleScore {
	readonly scaleId: ClinicalScaleId;
	readonly totalScore: number;
	readonly maxScore: number;
	readonly interpretation: string;
	readonly severity: "normal" | "mild" | "moderate" | "severe" | "critical" | "not-applicable";
	readonly items: readonly ScaleItem[];
	readonly disclaimer: string;
}

export const SCALE_DISCLAIMER = "本评分仅供临床参考，最终判断以主诊医师意见为准。评分工具不能替代完整神经系统查体。";

/** NIHSS item definitions with scoring options (0a-11). */
export const NIHSS_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "1a", label: "意识水平", options: ["清醒", "嗜睡", "昏睡", "昏迷"], scores: [0, 1, 2, 3] },
	{ id: "1b", label: "意识水平提问（月份/年龄）", options: ["两项均正确", "一项正确", "两项均错误"], scores: [0, 1, 2] },
	{ id: "1c", label: "意识水平指令（睁眼/握手）", options: ["两项均正确", "一项正确", "两项均错误"], scores: [0, 1, 2] },
	{ id: "2", label: "凝视", options: ["正常", "部分凝视麻痹", "完全凝视麻痹"], scores: [0, 1, 2] },
	{ id: "3", label: "视野", options: ["无视野缺损", "部分偏盲", "完全偏盲", "双侧偏盲"], scores: [0, 1, 2, 3] },
	{ id: "4", label: "面瘫", options: ["正常", "轻微", "部分", "完全"], scores: [0, 1, 2, 3] },
	{ id: "5a", label: "左上肢运动", options: ["无下落", "下落", "抵抗重力", "不能抗重力", "无移动"], scores: [0, 1, 2, 3, 4] },
	{ id: "5b", label: "右上肢运动", options: ["无下落", "下落", "抵抗重力", "不能抗重力", "无移动"], scores: [0, 1, 2, 3, 4] },
	{ id: "6a", label: "左下肢运动", options: ["无下落", "下落", "抵抗重力", "不能抗重力", "无移动"], scores: [0, 1, 2, 3, 4] },
	{ id: "6b", label: "右下肢运动", options: ["无下落", "下落", "抵抗重力", "不能抗重力", "无移动"], scores: [0, 1, 2, 3, 4] },
	{ id: "7", label: "共济失调", options: ["无", "一侧有", "两侧有"], scores: [0, 1, 2] },
	{ id: "8", label: "感觉", options: ["正常", "轻-中度", "重度/完全"], scores: [0, 1, 2] },
	{ id: "9", label: "语言", options: ["正常", "轻-中度失语", "重度失语", "完全失语"], scores: [0, 1, 2, 3] },
	{ id: "10", label: "构音障碍", options: ["正常", "轻-中度", "重度"], scores: [0, 1, 2] },
	{ id: "11", label: "忽视症", options: ["无", "轻-中度", "重度"], scores: [0, 1, 2] },
];

export const GCS_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "eye", label: "睁眼反应 (E)", options: ["自动睁眼", "呼唤睁眼", "刺痛睁眼", "无反应"], scores: [4, 3, 2, 1] },
	{ id: "verbal", label: "语言反应 (V)", options: ["回答正确", "回答错误", "含糊不清", "唯有声叹", "无反应"], scores: [5, 4, 3, 2, 1] },
	{ id: "motor", label: "运动反应 (M)", options: ["遵嘱运动", "刺痛定位", "刺痛躲避", "刺痛屈曲", "刺痛过伸", "无反应"], scores: [6, 5, 4, 3, 2, 1] },
];

export const HUNT_HESS_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "grade", label: "Hunt-Hess 分级", options: ["无症状/轻微头痛", "中-重度头痛/颈强直/颅神经麻痹", "嗜睡/意识模糊/轻度局灶症状", "昏睡/中-重度偏瘫/去脑强直早期", "深昏迷/去脑强直/濒死"], scores: [1, 2, 3, 4, 5] },
];

export const FISHER_CT_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "grade", label: "Fisher CT 分级", options: ["未见出血", "薄层出血<1mm", "薄层出血>1mm", "脑室积血", "脑实质或脑室内厚层出血"], scores: [1, 2, 3, 4] },
];

export const MRS_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "grade", label: "改良 Rankin 量表", options: ["完全无症状", "有症状但无明显残疾", "轻度残疾", "中度残疾", "中重度残疾", "重度残疾", "死亡"], scores: [0, 1, 2, 3, 4, 5, 6] },
];

export const ASPECTS_ITEMS: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }> = [
	{ id: "caudate", label: "尾状核", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "lentiform", label: "豆状核", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "internal_capsule", label: "内囊", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "insula", label: "岛叶", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "m1", label: "M1 区域", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "m2", label: "M2 区域", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "m3", label: "M3 区域", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "m4", label: "M4 区域", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "m5", label: "M5 区域", options: ["正常", "低密度"], scores: [1, 0] },
	{ id: "m6", label: "M6 区域", options: ["正常", "低密度"], scores: [1, 0] },
];

function nihssInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score === 0) return { interpretation: "正常，无神经功能缺损", severity: "normal" };
	if (score >= 1 && score <= 4) return { interpretation: "轻度卒中", severity: "mild" };
	if (score >= 5 && score <= 15) return { interpretation: "中度卒中", severity: "moderate" };
	if (score >= 16 && score <= 20) return { interpretation: "中-重度卒中", severity: "severe" };
	return { interpretation: "重度卒中", severity: "critical" };
}

function gcsInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score >= 13 && score <= 15) return { interpretation: "轻度脑损伤（GCS 13-15）", severity: "mild" };
	if (score >= 9 && score <= 12) return { interpretation: "中度脑损伤（GCS 9-12）", severity: "moderate" };
	if (score >= 3 && score <= 8) return { interpretation: "重度脑损伤（GCS 3-8，昏迷）", severity: "critical" };
	return { interpretation: "无法分类", severity: "not-applicable" };
}

function huntHessInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	const map: Record<number, { interpretation: string; severity: ScaleScore["severity"] }> = {
		1: { interpretation: "I 级：无症状或轻微头痛，手术风险低", severity: "mild" },
		2: { interpretation: "II 级：中-重度头痛，颈强直，可有颅神经麻痹", severity: "moderate" },
		3: { interpretation: "III 级：嗜睡、意识模糊、轻度局灶神经症状", severity: "severe" },
		4: { interpretation: "IV 级：昏睡、中-重度偏瘫、去脑强直早期", severity: "critical" },
		5: { interpretation: "V 级：深昏迷、去脑强直、濒死状态", severity: "critical" },
	};
	return map[score] ?? { interpretation: "无效分级", severity: "not-applicable" };
}

function fisherInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	const map: Record<number, { interpretation: string; severity: ScaleScore["severity"] }> = {
		1: { interpretation: "I 级：未见出血，血管痉挛风险低", severity: "normal" },
		2: { interpretation: "II 级：薄层出血 <1mm，血管痉挛风险低", severity: "mild" },
		3: { interpretation: "III 级：薄层出血 >1mm，血管痉挛风险高", severity: "severe" },
		4: { interpretation: "IV 级：脑室积血或厚层出血，血管痉挛风险最高", severity: "critical" },
	};
	return map[score] ?? { interpretation: "无效分级", severity: "not-applicable" };
}

function mrsInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score === 0) return { interpretation: "完全无症状", severity: "normal" };
	if (score <= 2) return { interpretation: "轻度残疾，生活自理", severity: "mild" };
	if (score === 3) return { interpretation: "中度残疾，需部分帮助但可独立行走", severity: "moderate" };
	if (score <= 5) return { interpretation: "重度残疾，需持续照护", severity: "severe" };
	return { interpretation: "死亡", severity: "critical" };
}

function aspectsInterpret(score: number): { interpretation: string; severity: ScaleScore["severity"] } {
	if (score >= 8) return { interpretation: "早期缺血改变范围小（ASPECTS ≥8），适合溶栓/取栓评估", severity: "mild" };
	if (score >= 5) return { interpretation: "中等范围早期缺血改变（ASPECTS 5-7），需结合临床综合评估", severity: "moderate" };
	return { interpretation: "大范围早期缺血改变（ASPECTS <5），预后差，需谨慎评估再灌注治疗", severity: "critical" };
}

function calculateScale(input: ScaleInput, definitions: ReadonlyArray<{ id: string; label: string; options: readonly string[]; scores: readonly number[] }>, interpreter: (score: number) => { interpretation: string; severity: ScaleScore["severity"] }, maxScore: number): ScaleScore {
	let total = 0;
	const scored: ScaleItem[] = [];
	for (const item of input.items) {
		const definition = definitions.find((d) => d.id === item.id);
		if (!definition) throw new Error(`未知评分项: ${item.id}`);
		const scoreIndex = Math.max(0, Math.min(item.value, definition.scores.length - 1));
		total += definition.scores[scoreIndex];
		scored.push({ ...item, selection: definition.options[scoreIndex] ?? item.selection, value: scoreIndex });
	}
	const { interpretation, severity } = interpreter(total);
	return { scaleId: input.scaleId, totalScore: total, maxScore, interpretation, severity, items: scored, disclaimer: SCALE_DISCLAIMER };
}

export function scoreClinicalScale(input: ScaleInput): ScaleScore {
	switch (input.scaleId) {
		case "nihss": return calculateScale(input, NIHSS_ITEMS, nihssInterpret, 42);
		case "gcs": return calculateScale(input, GCS_ITEMS, gcsInterpret, 15);
		case "hunt_hess": return calculateScale(input, HUNT_HESS_ITEMS, huntHessInterpret, 5);
		case "fisher_ct": return calculateScale(input, FISHER_CT_ITEMS, fisherInterpret, 4);
		case "mrs": return calculateScale(input, MRS_ITEMS, mrsInterpret, 6);
		case "aspects": return calculateScale(input, ASPECTS_ITEMS, aspectsInterpret, 10);
		default: throw new Error(`不支持的评分量表: ${input.scaleId}`);
	}
}
