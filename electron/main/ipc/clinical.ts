import { ipcMain } from "electron";

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
	const handlers = async () => await import("@openbuddy/capability-clinical-neuro");
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
