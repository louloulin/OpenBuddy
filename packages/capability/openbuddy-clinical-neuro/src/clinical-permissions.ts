export type ClinicalRole = "attending" | "resident" | "fellow" | "nurse" | "consultant" | "admin";

export type ClinicalAction =
	| "read_ehr"
	| "read_imaging"
	| "run_differential"
	| "run_scoring"
	| "search_guideline"
	| "summarize_encounter"
	| "export_report"
	| "manage_permissions";

export interface ClinicalActor {
	readonly id: string;
	readonly role: ClinicalRole;
	readonly /** Ward / department scope, e.g. "neurosurgery-icu". */
	ward?: string;
	readonly displayName?: string;
}

export interface ClinicalPermissionRequest {
	readonly actor: ClinicalActor;
	readonly action: ClinicalAction;
	readonly /** HIPAA / PIPL minimum-necessary justification — mandatory. */
	reasonForUse: string;
	readonly patientRef?: string;
	readonly ward?: string;
}

export interface ClinicalPermissionResult {
	readonly allowed: boolean;
	readonly reason: string;
	readonly /** Which rule granted or denied the request. */
	rule?: string;
}

export interface ClinicalPermissionRule {
	readonly id: string;
	readonly roles: readonly ClinicalRole[];
	readonly actions: readonly ClinicalAction[];
	readonly wards?: readonly string[];
	readonly effect: "allow" | "deny";
	readonly priority: number;
}

const MIN_REASON_LENGTH = 8;

const DEFAULT_RULES: readonly ClinicalPermissionRule[] = [
	{ id: "default-deny-fallback", roles: ["attending", "resident", "fellow", "nurse", "consultant", "admin"], actions: ["read_ehr", "read_imaging", "run_differential", "run_scoring", "search_guideline", "summarize_encounter", "export_report", "manage_permissions"], effect: "deny", priority: 0 },
	{ id: "admin-all", roles: ["admin"], actions: ["read_ehr", "read_imaging", "run_differential", "run_scoring", "search_guideline", "summarize_encounter", "export_report", "manage_permissions"], effect: "allow", priority: 50 },
	{ id: "attending-clinical", roles: ["attending", "consultant"], actions: ["read_ehr", "read_imaging", "run_differential", "run_scoring", "search_guideline", "summarize_encounter", "export_report"], effect: "allow", priority: 40 },
	{ id: "fellow-clinical", roles: ["fellow"], actions: ["read_ehr", "read_imaging", "run_differential", "run_scoring", "search_guideline", "summarize_encounter"], effect: "allow", priority: 30 },
	{ id: "resident-limited", roles: ["resident"], actions: ["read_ehr", "read_imaging", "run_differential", "run_scoring", "search_guideline", "summarize_encounter"], effect: "allow", priority: 25 },
	{ id: "nurse-read-only", roles: ["nurse"], actions: ["read_ehr", "read_imaging", "run_scoring", "search_guideline"], effect: "allow", priority: 20 },
];

export class ClinicalPermissionResolver {
	private rules: ClinicalPermissionRule[];

	constructor(rules?: readonly ClinicalPermissionRule[]) {
		this.rules = rules ? [...rules] : [...DEFAULT_RULES];
	}

	setRules(rules: readonly ClinicalPermissionRule[]): void {
		this.rules = [...rules];
	}

	check(request: ClinicalPermissionRequest): ClinicalPermissionResult {
		// 1. Mandatory reason-for-use check — deny if missing or too short.
		if (!request.reasonForUse || request.reasonForUse.trim().length < MIN_REASON_LENGTH) {
			return { allowed: false, reason: `访问临床数据必须提供不少于 ${MIN_REASON_LENGTH} 个字符的用途说明（HIPAA 最小必要原则）`, rule: "require-reason" };
		}

		// 2. Actor must have a valid role.
		const hasValidRole = ["attending", "resident", "fellow", "nurse", "consultant", "admin"].includes(request.actor.role);
		if (!hasValidRole) {
			return { allowed: false, reason: `未知临床角色: ${request.actor.role}`, rule: "require-valid-role" };
		}

		// 3. Evaluate rules by descending priority; first match wins.
		const sorted = [...this.rules].sort((a, b) => b.priority - a.priority);
		for (const rule of sorted) {
			if (!rule.roles.includes(request.actor.role)) continue;
			if (!rule.actions.includes(request.action)) continue;
			if (rule.wards && request.ward && !rule.wards.includes(request.ward)) continue;
			return {
				allowed: rule.effect === "allow",
				reason: rule.effect === "allow" ? `规则 ${rule.id} 允许 ${request.actor.role} 执行 ${request.action}` : `规则 ${rule.id} 拒绝 ${request.actor.role} 执行 ${request.action}`,
				rule: rule.id,
			};
		}

		return { allowed: false, reason: `没有匹配规则允许 ${request.actor.role} 执行 ${request.action}，默认拒绝`, rule: "default-deny" };
	}
}

let resolver: ClinicalPermissionResolver | null = null;

export function getClinicalPermissionResolver(): ClinicalPermissionResolver {
	if (!resolver) resolver = new ClinicalPermissionResolver();
	return resolver;
}

export function setClinicalPermissionResolver(instance: ClinicalPermissionResolver): void {
	resolver = instance;
}
