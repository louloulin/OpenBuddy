import type { Context } from "@openbuddy/cordis";
import { OpenBuddyService } from "@openbuddy/cordis";
import { redactPhi, type PhiRedactionResult } from "./phi-redactor";
import {
	ClinicalPermissionResolver,
	getClinicalPermissionResolver,
	type ClinicalAction,
	type ClinicalActor,
	type ClinicalPermissionResult,
} from "./clinical-permissions";
import {
	getClinicalAuditStore,
	clinicalAuditFingerprint,
	type ClinicalAuditEntry,
	type ClinicalAuditQuery,
	type ClinicalAuditStore,
} from "./audit-log";
import { scoreClinicalScale, type ScaleInput, type ScaleScore } from "./scoring";
import { checkDifferentialSafety, type DiagnosisGuardResult } from "./diagnosis-guard";
import { getMedicalKnowledgeBase, type MedicalKbQuery, type MedicalKbSearchResult, type DrugRecord, type LabExamRecord, type DiseaseRecord } from "./medical-knowledge-base";

// ============================================================================
// Types
// ============================================================================

export interface DifferentialDiagnosisInput {
	/** De-identified clinical narrative (chief complaint, HPI, exam, imaging). */
	readonly clinicalText: string;
	readonly actor: ClinicalActor;
	readonly reasonForUse: string;
	readonly /** Optional pre-selected specialty context. */
	specialty?: "neurology" | "neurosurgery";
}

export interface DifferentialDiagnosisItem {
	readonly diagnosis: string;
	readonly likelihood: "high" | "medium" | "low";
	readonly supportingFindings: readonly string[];
	readonly conflictingFindings: readonly string[];
	readonly recommendedWorkup: readonly string[];
	readonly guidelineReference?: string;
}

export interface DifferentialDiagnosisResult {
	readonly differentials: readonly DifferentialDiagnosisItem[];
	readonly redactionFingerprint: string;
	readonly disclaimer: string;
	readonly model?: string;
	readonly /** Safety guard check result — always present in differential output. */
	safetyGuard?: DiagnosisGuardResult;
}

export interface ClinicalScoringInput {
	readonly scale: ScaleInput;
	readonly actor: ClinicalActor;
	readonly reasonForUse: string;
}

export const CLINICAL_DISCLAIMER = "本输出仅为鉴别诊断参考，不构成最终诊断。最终诊断和治疗方案以主诊医师意见为准。";

export class ClinicalNeuroError extends Error {
	constructor(readonly code: "permission_denied" | "phi_redaction_failed" | "llm_unavailable" | "invalid_input" | "audit_failed", message: string) {
		super(message);
		this.name = "ClinicalNeuroError";
	}
}

// ============================================================================
// LLM Provider abstraction — swap between token.yueming.xin and hospital models
// ============================================================================

export interface ClinicalLlmProvider {
	/** Generate differential diagnosis from redacted clinical text. */
	generateDifferential(redactedText: string, specialty?: string): Promise<DifferentialDiagnosisItem[]>;
	readonly modelId: string;
}

/**
 * OpenAI-compatible chat completions provider.
 * Works with token.yueming.xin (test), vLLM, Ollama, or hospital internal gateways.
 */
export class OpenAiCompatibleClinicalLlm implements ClinicalLlmProvider {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
		readonly modelId: string,
		private readonly systemPrompt = DEFAULT_DIFFERENTIAL_SYSTEM_PROMPT,
	) {}

	async generateDifferential(redactedText: string, specialty?: string): Promise<DifferentialDiagnosisItem[]> {
		const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.modelId,
				messages: [
					{ role: "system", content: this.systemPrompt },
					{ role: "user", content: `科室: ${specialty ?? "神经内科/神经外科"}\n\n病历摘要(已脱敏):\n${redactedText}` },
				],
				temperature: 0.1,
				max_tokens: 4096,
			}),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new ClinicalNeuroError("llm_unavailable", `LLM 请求失败 (${response.status}): ${detail.slice(0, 200)}`);
		}
		const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
		const message = payload.choices?.[0]?.message;
		const content = message?.content ?? "";
		try {
			const parsed = JSON.parse(content) as { differentials?: DifferentialDiagnosisItem[] };
			if (!Array.isArray(parsed.differentials)) throw new Error("missing differentials array");
			return parsed.differentials;
		} catch {
			throw new ClinicalNeuroError("invalid_input", `LLM 输出无法解析为鉴别诊断 JSON: ${content.slice(0, 200)}`);
		}
	}
}

export const DEFAULT_DIFFERENTIAL_SYSTEM_PROMPT = `你是一位神经内科/神经外科辅助诊断助手。你的任务是根据临床病历摘要生成鉴别诊断列表。

规则:
1. 输出严格 JSON: {"differentials": [{"diagnosis": "...", "likelihood": "high|medium|low", "supportingFindings": ["..."], "conflictingFindings": ["..."], "recommendedWorkup": ["..."], "guidelineReference": "..."}]}
2. 不要给出最终诊断，只提供鉴别诊断列表
3. 按可能性从高到低排序，最多 8 条
4. 每条必须列出支持和不支持的发现
5. 推荐进一步检查时引用具体指南(如有)
6. 危急情况(如脑疝、大面积梗死)必须排在第一位并标注 high
7. 不得编造不存在的检查结果
8. 不得使用患者真实姓名或身份信息`;

// ============================================================================
// Main service
// ============================================================================

export class ClinicalNeuro extends OpenBuddyService {
	static provide = "clinical" as const;

	private llm: ClinicalLlmProvider | null = null;
	private readonly permissionResolver: ClinicalPermissionResolver;
	private readonly audit: ClinicalAuditStore | null;

	constructor(ctx: Context) {
		super(ctx, "clinical");
		this.permissionResolver = getClinicalPermissionResolver();
		this.audit = getClinicalAuditStore();
		try {
			this.llm = ctx.get("clinicalLlmProvider") as ClinicalLlmProvider;
		} catch {
			this.llm = null;
		}
	}

	setLlmProvider(provider: ClinicalLlmProvider): void {
		this.llm = provider;
	}

	/** Check permission and write a deny/allow audit entry. */
	private async authorize(actor: ClinicalActor, action: ClinicalAction, reasonForUse: string, patientRef?: string): Promise<void> {
		const result: ClinicalPermissionResult = this.permissionResolver.check({ actor, action, reasonForUse, patientRef });
		if (this.audit) {
			await this.audit.append({
				at: new Date().toISOString(),
				actorId: actor.id,
				operation: "permission_check",
				status: result.allowed ? "allowed" : "denied",
				inputFingerprint: clinicalAuditFingerprint(`${action}|${reasonForUse}`),
				reasonForUse,
				...(patientRef ? { patientRef } : {}),
				detail: { action, rule: result.rule ?? "", reason: result.reason },
			}).catch(() => undefined);
		}
		if (!result.allowed) throw new ClinicalNeuroError("permission_denied", result.reason);
	}

	async differentialDiagnosis(input: DifferentialDiagnosisInput): Promise<DifferentialDiagnosisResult> {
		if (!input.clinicalText?.trim()) throw new ClinicalNeuroError("invalid_input", "临床文本不能为空");
		await this.authorize(input.actor, "run_differential", input.reasonForUse);

		// PHI redaction — mandatory before LLM.
		const redaction: PhiRedactionResult = redactPhi(input.clinicalText);
		if (redaction.stats.total === 0 && /患者|病人/.test(input.clinicalText)) {
			// If narrative mentions patients but nothing matched, still proceed;
			// pattern matching is best-effort. Log stats for review.
		}

		if (!this.llm) throw new ClinicalNeuroError("llm_unavailable", "未配置临床 LLM provider，请先调用 setLlmProvider 或注入 clinicalLlmProvider");

		const rawDifferentials = await this.llm.generateDifferential(redaction.redacted, input.specialty);

		// Deterministic safety guard — runs on code, cannot be bypassed by prompt.
		const guard = checkDifferentialSafety(input, rawDifferentials);
		const outputFingerprint = clinicalAuditFingerprint(JSON.stringify(guard.differentials));

		if (this.audit) {
			await this.audit.append({
				at: new Date().toISOString(),
				actorId: input.actor.id,
				operation: "differential_diagnosis",
				status: "completed",
				inputFingerprint: redaction.fingerprint,
				outputFingerprint,
				reasonForUse: input.reasonForUse,
				phiRedactionStats: { total: redaction.stats.total },
				detail: { guardSeverity: guard.severity, guardViolations: guard.violations.length },
			}).catch(() => undefined);
		}

		return { differentials: guard.differentials, redactionFingerprint: redaction.fingerprint, disclaimer: CLINICAL_DISCLAIMER, model: this.llm.modelId, safetyGuard: guard };
	}

	async scoreClinical(input: ClinicalScoringInput): Promise<ScaleScore> {
		await this.authorize(input.actor, "run_scoring", input.reasonForUse);
		const result = scoreClinicalScale(input.scale);
		if (this.audit) {
			await this.audit.append({
				at: new Date().toISOString(),
				actorId: input.actor.id,
				operation: "clinical_scoring",
				status: "completed",
				inputFingerprint: clinicalAuditFingerprint(JSON.stringify(input.scale)),
				outputFingerprint: clinicalAuditFingerprint(JSON.stringify(result)),
				reasonForUse: input.reasonForUse,
				detail: { scaleId: input.scale.scaleId, totalScore: result.totalScore },
			}).catch(() => undefined);
		}
		return result;
	}

	async auditTrail(query?: ClinicalAuditQuery): Promise<ClinicalAuditEntry[]> {
		if (!this.audit) return [];
		return this.audit.query(query);
	}

	// === Medical knowledge base ===

	async searchMedicalKb(query: MedicalKbQuery): Promise<MedicalKbSearchResult[]> {
		await this.authorize({ id: "kb-user", role: "attending" }, "search_guideline", "知识库检索用于临床参考");
		return getMedicalKnowledgeBase().search(query);
	}

	async addDrug(input: Omit<DrugRecord, "id" | "updatedAt">): Promise<DrugRecord> {
		await this.authorize({ id: "kb-admin", role: "admin" }, "manage_permissions", "维护药品知识库");
		return getMedicalKnowledgeBase().addDrug(input);
	}

	async addLabExam(input: Omit<LabExamRecord, "id" | "updatedAt">): Promise<LabExamRecord> {
		await this.authorize({ id: "kb-admin", role: "admin" }, "manage_permissions", "维护检查项目知识库");
		return getMedicalKnowledgeBase().addLabExam(input);
	}

	async addDisease(input: Omit<DiseaseRecord, "id" | "updatedAt">): Promise<DiseaseRecord> {
		await this.authorize({ id: "kb-admin", role: "admin" }, "manage_permissions", "维护疾病名目知识库");
		return getMedicalKnowledgeBase().addDisease(input);
	}

	async medicalKbStats(): Promise<{ drugs: number; labs: number; diseases: number; updatedAt: string }> {
		return getMedicalKnowledgeBase().stats();
	}

	/** Redact PHI without calling LLM — exposed as a standalone tool. */
	redact(text: string): PhiRedactionResult {
		return redactPhi(text);
	}
}

declare module "@openbuddy/cordis" {
	interface Context {
		clinical: ClinicalNeuro;
	}
}

// ============================================================================
// IPC handler surface (follows emailHandlers pattern)
// ============================================================================

let serviceRef: ClinicalNeuro | null = null;

export function mountClinicalNeuro(ctx: Context): ClinicalNeuro {
	if (serviceRef) return serviceRef;
	serviceRef = new ClinicalNeuro(ctx);
	ctx.clinical = serviceRef;
	return serviceRef;
}

function service(): ClinicalNeuro {
	if (!serviceRef) throw new Error("ClinicalNeuro not mounted — call mountClinicalNeuro first");
	return serviceRef;
}

export const clinicalHandlers = {
	differentialDiagnosis: (input: DifferentialDiagnosisInput) => service().differentialDiagnosis(input),
	scoreClinical: (input: ClinicalScoringInput) => service().scoreClinical(input),
	auditTrail: (query?: ClinicalAuditQuery) => service().auditTrail(query),
	redact: (text: string) => service().redact(text),
	searchMedicalKb: (query: MedicalKbQuery) => service().searchMedicalKb(query),
	addDrug: (input: Omit<DrugRecord, "id" | "updatedAt">) => service().addDrug(input),
	addLabExam: (input: Omit<LabExamRecord, "id" | "updatedAt">) => service().addLabExam(input),
	addDisease: (input: Omit<DiseaseRecord, "id" | "updatedAt">) => service().addDisease(input),
	medicalKbStats: () => service().medicalKbStats(),
};
