import { ipcMain, net } from "electron";
import { Context } from "@openbuddy/cordis";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface RecordValue {
	[key: string]: unknown;
}

function recordValue(input: unknown, context: string): RecordValue {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`Invalid ${context} payload`);
	return input as RecordValue;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Field ${field} must be a non-empty string`);
	return value;
}

export function registerClinicalIpc(): void {
	let clinicalModule: Promise<typeof import("@openbuddy/capability-clinical-neuro")> | null = null;
	const handlers = async () => clinicalModule ??= initializeClinicalModule();
	const importer = async () => await import("@openbuddy/capability-clinical-neuro/src/universal-import");

	ipcMain.handle("clinical:import-templates", async (_e, args: unknown) => {
		const input = args ? recordValue(args, "import templates") : {};
		const { getUniversalImportEngine } = await importer();
		const engine = getUniversalImportEngine();
		const templates = engine.listTemplates(input.domain ? String(input.domain) : undefined);
		return templates.map((t) => ({ id: t.id, name: t.name, description: t.description, domain: t.domain, icon: t.icon }));
	});

	ipcMain.handle("clinical:import-detect-template", async (_e, args: unknown) => {
		const input = recordValue(args, "detect template");
		const { getUniversalImportEngine, detectImportFormat } = await importer();
		const engine = getUniversalImportEngine();
		const file = { fileName: requiredString(input.fileName, "fileName"), content: requiredString(input.content, "content"), format: detectImportFormat(String(input.fileName)) };
		return engine.detectTemplate(file);
	});

	ipcMain.handle("clinical:import-preview", async (_e, args: unknown) => {
		const input = recordValue(args, "import preview");
		const { getUniversalImportEngine, detectImportFormat } = await importer();
		const engine = getUniversalImportEngine();
		const file = { fileName: requiredString(input.fileName, "fileName"), content: requiredString(input.content, "content"), format: detectImportFormat(String(input.fileName)) };
		return engine.preview(file, requiredString(input.templateId, "templateId"));
	});

	ipcMain.handle("clinical:differential-diagnosis", async (_e, args: unknown) => {
		const input = recordValue(args, "differential diagnosis");
		const { clinicalHandlers } = await handlers();
		return clinicalHandlers.differentialDiagnosis({
			clinicalText: requiredString(input.clinicalText, "clinicalText"),
			actor: recordValue(input.actor, "actor") as never,
			reasonForUse: requiredString(input.reasonForUse, "reasonForUse"),
			...(input.specialty ? { specialty: input.specialty as never } : {}),
		});
	});

	ipcMain.handle("clinical:score", async (_e, args: unknown) => {
		const input = recordValue(args, "clinical scoring");
		const { clinicalHandlers } = await handlers();
		return clinicalHandlers.scoreClinical({
			scale: recordValue(input.scale, "scale") as never,
			actor: recordValue(input.actor, "actor") as never,
			reasonForUse: requiredString(input.reasonForUse, "reasonForUse"),
		});
	});

	ipcMain.handle("clinical:redact", async (_e, args: unknown) => {
		const input = recordValue(args, "phi redact");
		const { clinicalHandlers } = await handlers();
		return clinicalHandlers.redact(requiredString(input.text, "text"));
	});

	ipcMain.handle("clinical:audit-trail", async (_e, args: unknown) => {
		const { clinicalHandlers } = await handlers();
		return clinicalHandlers.auditTrail(args as never);
	});

	ipcMain.handle("clinical:kb-search", async (_e, args: unknown) => {
		const input = recordValue(args, "kb search");
		const { clinicalHandlers } = await handlers();
		return clinicalHandlers.searchMedicalKb({
			keyword: requiredString(input.keyword, "keyword"),
			...(input.type ? { type: input.type as never } : {}),
			...(input.category ? { category: requiredString(input.category, "category") } : {}),
			...(input.limit ? { limit: Number(input.limit) } : {}),
		});
	});

	ipcMain.handle("clinical:kb-add-drug", async (_e, args: unknown) => {
		const input = recordValue(args, "kb add drug");
		const { clinicalHandlers } = await handlers();
		return clinicalHandlers.addDrug(recordValue(input.drug, "drug") as never);
	});

	ipcMain.handle("clinical:kb-add-lab", async (_e, args: unknown) => {
		const input = recordValue(args, "kb add lab");
		const { clinicalHandlers } = await handlers();
		return clinicalHandlers.addLabExam(recordValue(input.lab, "lab") as never);
	});

	ipcMain.handle("clinical:kb-stats", async () => {
		const { clinicalHandlers } = await handlers();
		return clinicalHandlers.medicalKbStats();
	});
}

async function initializeClinicalModule(): Promise<typeof import("@openbuddy/capability-clinical-neuro")> {
	const module = await import("@openbuddy/capability-clinical-neuro");
	const agentHome = process.env.PI_CODING_AGENT_DIR
		?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent");
	const auditDir = join(homedir(), ".openbuddy");
	await mkdir(auditDir, { recursive: true });
	module.mountClinicalAuditLog(join(auditDir, "clinical-audit.json"));
	const service = module.mountClinicalNeuro(new Context());
	await configureClinicalLlm(module, service, agentHome);
	return module;
}

async function configureClinicalLlm(
	module: typeof import("@openbuddy/capability-clinical-neuro"),
	service: import("@openbuddy/capability-clinical-neuro").ClinicalNeuro,
	agentHome: string,
): Promise<void> {
	const providerId = process.env.OPENBUDDY_CLINICAL_PROVIDER_ID ?? "yueming-token";
	try {
		const modelsConfig = JSON.parse(await readFile(join(agentHome, "models.json"), "utf8")) as {
			providers?: Record<string, { baseUrl?: string; models?: Array<{ id?: string }> }>;
		};
		const authConfig = JSON.parse(await readFile(join(agentHome, "auth.json"), "utf8")) as Record<string, unknown>;
		const provider = modelsConfig.providers?.[providerId];
		const auth = authConfig[providerId];
		const apiKey = typeof auth === "string" ? auth : typeof auth === "object" && auth !== null
			? String((auth as { key?: unknown }).key ?? "")
			: "";
		const baseUrl = provider?.baseUrl;
		const modelId = process.env.OPENBUDDY_CLINICAL_MODEL_ID ?? provider?.models?.[0]?.id;
		if (!baseUrl || !apiKey || !modelId) return;
		const electronFetch = (input: string, init?: RequestInit) => net.fetch(input, init);
		service.setLlmProvider(new module.OpenAiCompatibleClinicalLlm(baseUrl, apiKey, modelId, undefined, electronFetch));
	} catch {
		// Clinical deterministic scoring and knowledge search remain available when the LLM config is absent.
	}
}
