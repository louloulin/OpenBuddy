import type { DifferentialDiagnosisItem, DifferentialDiagnosisInput } from "./index";

export type DiagnosisGuardSeverity = "pass" | "warn" | "block";

export interface DiagnosisGuardResult {
	readonly severity: DiagnosisGuardSeverity;
	readonly violations: readonly DiagnosisGuardViolation[];
	readonly /** Filtered/annotated differentials safe to show. */
	differentials: readonly DifferentialDiagnosisItem[];
	readonly /** Mandatory safety banner appended to output. */
	safetyBanner: string;
}

export interface DiagnosisGuardViolation {
	readonly rule: DiagnosisGuardRule;
	readonly severity: DiagnosisGuardSeverity;
	readonly message: string;
	readonly /** Index of the affected differential, if applicable. */
	index?: number;
}

export type DiagnosisGuardRule =
	| "minimum_differentials"
	| "no_single_diagnosis_language"
	| "no_definitive_conclusion"
	| "require_conflicting_findings"
	| "require_recommended_workup"
	| "red_flag_emergency_check"
	| "confidence_cap_missing_data"
	| "no_fabricated_findings";

/** Patterns that indicate the LLM is giving a definitive diagnosis. */
const DEFINITIVE_DIAGNOSIS_PATTERNS: ReadonlyArray<{ pattern: RegExp; message: string }> = [
	{ pattern: /确诊为|诊断为|最终诊断[:：]/u, message: "输出包含确定性诊断语言(如'确诊为/诊断为')" },
	{ pattern: /可以确定|明确诊断|诊断成立/u, message: "输出包含过度确定性表述" },
	{ pattern: /排除(?!了?其他)(?:所有|全部)其他(?:可能|诊断)/u, message: "输出排除了所有其他可能性,违反鉴别诊断原则" },
	{ pattern: /无需(?:进一步|再)(?:检查|鉴别)/u, message: "输出建议不再进一步检查,可能漏诊" },
];

/** Clinical red flags that must be prioritized in differentials. */
const RED_FLAG_PATTERNS: ReadonlyArray<{ pattern: RegExp; emergency: string }> = [
	{ pattern: /突发剧烈头痛|霹雳样头痛|雷击样头痛/u, emergency: "蛛网膜下腔出血" },
	{ pattern: /意识障碍|昏迷|瞳孔不等|瞳孔散大/u, emergency: "脑疝/颅内压增高" },
	{ pattern: /胸痛.*放射|压榨性胸痛|撕裂样胸痛|胸背部疼痛/u, emergency: "急性冠脉综合征/主动脉夹层" },
	{ pattern: /呼吸困难.*突然|咯血|晕厥/u, emergency: "肺栓塞" },
	{ pattern: /肢体无力.*突然|偏瘫|面瘫.*肢体/u, emergency: "急性脑卒中" },
	{ pattern: /脊柱外伤.*麻木|大小便失禁|鞍区麻木/u, emergency: "脊髓压迫/脊髓损伤" },
	{ pattern: /发热.*颈部僵硬|颈项强直/u, emergency: "颅内感染" },
	{ pattern: /血压.*(?:200|220|180)\/(?:120|130|110)/u, emergency: "高血压急症" },
	{ pattern: /进行性呼吸困难|端坐呼吸|粉红色泡沫痰/u, emergency: "急性心衰/肺水肿" },
];

/** Critical data points that, if missing, cap confidence at medium. */
const CRITICAL_DATA_FIELDS: ReadonlyArray<{ pattern: RegExp; field: string }> = [
	{ pattern: /生命体征|血压|心率|呼吸|体温/u, field: "生命体征" },
	{ pattern: /意识|GCS|瞳孔/u, field: "意识状态" },
	{ pattern: /影像|CT|MRI|X光|超声/u, field: "影像检查" },
	{ pattern: /化验|血常规|生化|肌钙蛋白|血糖/u, field: "实验室检查" },
	{ pattern: /过敏史|既往史|用药史/u, field: "既往病史" },
];

export function checkDifferentialSafety(
	input: DifferentialDiagnosisInput,
	rawDifferentials: readonly DifferentialDiagnosisItem[],
): DiagnosisGuardResult {
	const violations: DiagnosisGuardViolation[] = [];
	let differentials = [...rawDifferentials];

	// Rule 1: Minimum 3 differentials (unless it's a truly obvious emergency).
	if (differentials.length < 3 && differentials.length > 0) {
		violations.push({
			rule: "minimum_differentials",
			severity: "warn",
			message: `鉴别诊断列表只有 ${differentials.length} 条,建议至少 3 条以降低漏诊风险`,
		});
	}

	// Rule 2: No definitive diagnosis language.
	const allText = JSON.stringify(differentials);
	for (const { pattern, message } of DEFINITIVE_DIAGNOSIS_PATTERNS) {
		if (pattern.test(allText)) {
			violations.push({ rule: "no_definitive_conclusion", severity: "block", message });
			differentials = differentials.map((d) => ({
				...d,
				diagnosis: d.diagnosis.replace(new RegExp(pattern.source, "gu"), "[已移除确定性表述]"),
			}));
		}
	}

	// Rule 3: Each differential must have conflicting findings (or explicitly "无").
	differentials.forEach((d, index) => {
		if (!d.conflictingFindings || d.conflictingFindings.length === 0) {
			violations.push({
				rule: "require_conflicting_findings",
				severity: "warn",
				index,
				message: `第 ${index + 1} 条「${d.diagnosis}」缺少不支持该诊断的发现,无法评估诊断不确定性`,
			});
		}
	});

	// Rule 4: Each differential must recommend further workup (never "no further testing").
	differentials.forEach((d, index) => {
		if (!d.recommendedWorkup || d.recommendedWorkup.length === 0) {
			violations.push({
				rule: "require_recommended_workup",
				severity: "warn",
				index,
				message: `第 ${index + 1} 条「${d.diagnosis}」未建议进一步检查,可能导致漏诊`,
			});
		}
	});

	// Rule 5: Red flag emergency screening — if input matches emergency pattern
	// but first differential is not the emergency, promote it or warn.
	const detectedEmergencies: string[] = [];
	for (const { pattern, emergency } of RED_FLAG_PATTERNS) {
		if (pattern.test(input.clinicalText)) detectedEmergencies.push(emergency);
	}
	if (detectedEmergencies.length > 0) {
		const firstDiff = differentials[0];
		const emergencyCovered = detectedEmergencies.some((emergency) =>
			firstDiff?.diagnosis?.includes(emergency.split("/")[0]) || firstDiff?.likelihood === "high",
		);
		if (!emergencyCovered) {
			violations.push({
				rule: "red_flag_emergency_check",
				severity: "warn",
				message: `输入文本提示危急情况(${detectedEmergencies.join("、")}),但鉴别列表第一条未覆盖该危急诊断,已自动置顶提示`,
			});
			differentials.unshift({
				diagnosis: `⚠️ 需优先排除: ${detectedEmergencies.join(" / ")}`,
				likelihood: "high",
				supportingFindings: ["临床文本中检测到危急征象"],
				conflictingFindings: ["需结合完整评估判断"],
				recommendedWorkup: ["立即评估生命体征", "完善紧急影像/实验室检查", "通知上级医师"],
				guidelineReference: "系统自动安全护栏",
			});
		}
	}

	// Rule 6: Confidence cap — if critical data is missing, cap likelihood at medium.
	const missingFields = CRITICAL_DATA_FIELDS.filter(({ pattern }) => !pattern.test(input.clinicalText)).map(({ field }) => field);
	if (missingFields.length >= 2) {
		differentials = differentials.map((d) => d.likelihood === "high" ? { ...d, likelihood: "medium" as const } : d);
		violations.push({
			rule: "confidence_cap_missing_data",
			severity: "warn",
			message: `缺少 ${missingFields.length} 项关键数据(${missingFields.join("、")}),已将所有 high 置信度降为 medium`,
		});
	}

	// Rule 7: Fabricated findings check — differential diagnoses reference findings not in input.
	// This is a heuristic: flag diagnoses whose supporting findings are all absent from input text.
	differentials.forEach((d, index) => {
		if (d.supportingFindings.length > 0) {
			const hasMatch = d.supportingFindings.some((finding) => {
				const keywords = finding.replace(/[(),，、;；\s]/gu, "").slice(0, 20);
				return keywords.length > 3 && input.clinicalText.includes(keywords.slice(0, 8));
			});
			if (!hasMatch && index > 0) {
				violations.push({
					rule: "no_fabricated_findings",
					severity: "warn",
					index,
					message: `第 ${index + 1} 条「${d.diagnosis}」的支持发现未在输入文本中找到,可能为模型推断,需人工核实`,
				});
			}
		}
	});

	const hasBlock = violations.some((v) => v.severity === "block");
	const hasWarn = violations.some((v) => v.severity === "warn");
	const severity: DiagnosisGuardSeverity = hasBlock ? "block" : hasWarn ? "warn" : "pass";

	const warningList = violations.filter((v) => v.severity !== "pass").map((v) => `• ${v.message}`).join("\n");
	const safetyBanner = violations.length === 0
		? "✅ 安全检查通过:鉴别列表满足最低要求,未检测到确定性诊断语言。"
		: `${hasBlock ? "🚫" : "⚠️"} 安全护栏触发 ${violations.length} 项:\n${warningList}\n\n请主诊医师核实上述提示后再做临床决策。`;

	return { severity, violations, differentials, safetyBanner };
}
