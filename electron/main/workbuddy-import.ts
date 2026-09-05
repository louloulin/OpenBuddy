import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 256;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const ALLOWED_AGENT_KEYS = new Set(["name", "description", "avatar", "modelTags"]);
const SENSITIVE_KEY = /(token|secret|password|credential|private[_-]?key|master[_-]?key|oauth|access[_-]?key|refresh[_-]?token)/i;
const SECRET_VALUE = /(bearer\s+[A-Za-z0-9._-]{16,}|sk-[A-Za-z0-9]{16,}|-----BEGIN\s+(?:RSA|OPENSSH|EC)\s+PRIVATE\s+KEY-----)/i;

export type WorkBuddyImportDisposition = "new" | "same" | "upgrade" | "downgrade" | "conflict" | "blocked";

export interface WorkBuddyImportPreview {
	version: 1;
	previewToken: string;
	sourceRoot: string;
	pluginId: string;
	versionName: string;
	disposition: WorkBuddyImportDisposition;
	team: boolean;
	leadAgent?: string;
	members: Array<{ agentId: string; role?: string; lead: boolean }>;
	skills: string[];
	files: Array<{ path: string; kind: "agent" | "skill" | "avatar" | "manifest"; bytes: number; sha256: string }>;
	warnings: string[];
	errors: string[];
	createdAt: number;
}

export interface WorkBuddyImportResult {
	version: 1;
	importId: string;
	pluginId: string;
	status: "installed" | "already-installed" | "rolled-back";
	installedFiles: string[];
	expertRoot: string;
	autoActivated: false;
}

interface ImportJournal {
	version: 1;
	importId: string;
	pluginId: string;
	status: "installed" | "rolled-back";
	files: string[];
	backupPath?: string;
	createdAt: number;
}

const previews = new Map<string, WorkBuddyImportPreview>();

function piRoot(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent");
}

export function workbuddyDefaultRoot(): string {
	return process.env.WORKBUDDY_CONFIG_DIR ?? join(homedir(), ".workbuddy");
}

function importRoot(): string {
	return join(piRoot(), "openbuddy-workbuddy-imports");
}

function safeName(value: string, label: string): string {
	if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") throw new Error(`${label} contains an invalid name`);
	return value;
}

function safePath(root: string, candidate: string): string {
	const target = resolve(root, candidate);
	const rel = relative(resolve(root), target);
	if (rel === "" || (rel !== ".." && !rel.startsWith("..")) && !rel.startsWith("/")) return target;
	throw new Error("source path is outside the selected WorkBuddy root");
}

async function regularFile(root: string, candidate: string): Promise<{ path: string; bytes: number; sha256: string } | undefined> {
	const path = safePath(root, candidate);
	const stat = await lstat(path).catch(() => undefined);
	if (!stat) return undefined;
	if (!stat.isFile()) throw new Error(`resource is not a regular file: ${candidate}`);
	const realRoot = await realpath(root);
	const realPath = await realpath(path);
	if (relative(realRoot, realPath).startsWith("..")) throw new Error(`resource escapes source root: ${candidate}`);
	if (stat.size > MAX_FILE_BYTES) throw new Error(`resource exceeds ${MAX_FILE_BYTES} bytes: ${candidate}`);
	const digest = createHash("sha256").update(await readFile(path)).digest("hex");
	return { path, bytes: stat.size, sha256: digest };
}

async function regularDirectory(root: string, candidate: string): Promise<string | undefined> {
	const path = safePath(root, candidate);
	const stat = await lstat(path).catch(() => undefined);
	if (!stat) return undefined;
	if (!stat.isDirectory()) throw new Error(`resource is not a directory: ${candidate}`);
	const realRoot = await realpath(root);
	const realPath = await realpath(path);
	const rel = relative(realRoot, realPath);
	if (rel.startsWith("..") || rel.startsWith("/")) throw new Error(`resource escapes source root: ${candidate}`);
	return realPath;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
	const raw = await readFile(path, "utf8");
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("manifest must be a JSON object");
	return value as Record<string, unknown>;
}

function manifestFingerprint(manifest: Record<string, unknown>): string {
	const normalized = { ...manifest };
	delete normalized.openbuddyManifestHash;
	return createHash("sha256").update(JSON.stringify(redact(normalized))).digest("hex");
}

function redact(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redact);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, item]) => [key, redact(item)]));
}

function parseFrontmatter(raw: string): Record<string, string> {
	if (!raw.startsWith("---")) return {};
	const end = raw.indexOf("\n---", 3);
	if (end < 0) return {};
	const result: Record<string, string> = {};
	for (const line of raw.slice(3, end).split("\n")) {
		const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*["']?(.+?)["']?\s*$/);
		if (match && ALLOWED_AGENT_KEYS.has(match[1])) result[match[1]] = match[2];
	}
	return result;
}

function versionRank(value: string): number[] {
	return value.split(".").map((part) => Number.parseInt(part, 10)).map((part) => Number.isFinite(part) ? part : 0);
}

function compareVersion(left: string, right: string): number {
	const a = versionRank(left); const b = versionRank(right);
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
	return 0;
}

async function existingManifest(pluginId: string): Promise<Record<string, unknown> | undefined> {
	const path = join(piRoot(), "workbuddy-experts", pluginId, "plugin.json");
	return readFile(path, "utf8").then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => undefined);
}

async function resolvePluginRoot(sourceRoot: string, pluginId: string): Promise<{ root: string; prefix: string }> {
	const hasManifest = async (root: string): Promise<boolean> => (await Promise.all(["plugin.json", ".codebuddy-plugin/plugin.json", ".aily-plugin/plugin.json"].map((name) => stat(join(root, name)).then((stat) => stat.isFile()).catch(() => false)))).some(Boolean);
	const isInsideSource = async (root: string): Promise<boolean> => {
		const source = await realpath(sourceRoot);
		const candidate = await realpath(root);
		const rel = relative(source, candidate);
		return !rel.startsWith("..") && !rel.startsWith("/");
	};
	const direct = safePath(sourceRoot, join("plugins", pluginId));
	if (await hasManifest(direct) && await isInsideSource(direct)) return { root: direct, prefix: join("plugins", pluginId) };
	const marketplaces = safePath(sourceRoot, "plugins/marketplaces");
	for (const marketplace of await readdir(marketplaces, { withFileTypes: true }).catch(() => [])) {
		if (!marketplace.isDirectory()) continue;
		const candidate = safePath(sourceRoot, join("plugins/marketplaces", marketplace.name, "plugins", pluginId));
		if (await hasManifest(candidate) && await isInsideSource(candidate)) return { root: candidate, prefix: join("plugins/marketplaces", marketplace.name, "plugins", pluginId) };
	}
	throw new Error(`WorkBuddy plugin.json not found for ${pluginId}`);
}

export async function previewWorkBuddyImport(sourceRootInput: string, pluginIdInput: string): Promise<WorkBuddyImportPreview> {
	const sourceRoot = resolve(sourceRootInput || workbuddyDefaultRoot());
	const pluginId = safeName(pluginIdInput, "pluginId");
	const plugin = await resolvePluginRoot(sourceRoot, pluginId);
	const pluginRoot = plugin.root;
	const manifestName = (await stat(join(pluginRoot, "plugin.json")).then((stat) => stat.isFile()).catch(() => false)) ? "plugin.json" : (await stat(join(pluginRoot, ".codebuddy-plugin/plugin.json")).then((stat) => stat.isFile()).catch(() => false)) ? ".codebuddy-plugin/plugin.json" : ".aily-plugin/plugin.json";
	const manifestFile = await regularFile(pluginRoot, manifestName);
	if (!manifestFile) throw new Error(`WorkBuddy plugin.json not found for ${pluginId}`);
	const manifest = await readJson(manifestFile.path);
	const errors: string[] = [];
	const warnings: string[] = [];
	if (SECRET_VALUE.test(JSON.stringify(manifest))) errors.push("manifest contains a credential-like value and cannot be imported");
	const versionName = typeof manifest.version === "string" ? manifest.version : "0.0.0";
	const team = manifest.expertType === "team" || Array.isArray(manifest.members) || Boolean(manifest.teamInfo);
	const agentsRoot = await regularDirectory(pluginRoot, "agents");
	if (!agentsRoot) errors.push("plugin is missing agents directory");
	const agentDir = await readdir(agentsRoot ?? pluginRoot, { withFileTypes: true }).catch(() => []);
	const files: WorkBuddyImportPreview["files"] = [{ ...manifestFile, path: join(plugin.prefix, manifestName), kind: "manifest" }];
	const members: WorkBuddyImportPreview["members"] = [];
	let leadAgent: string | undefined;
	for (const entry of agentDir) {
		if (!entry.isFile() || extname(entry.name) !== ".md") continue;
		const agentId = safeName(basename(entry.name, ".md"), "agentId");
		const relativeAgent = join(plugin.prefix, "agents", entry.name);
		const file = await regularFile(sourceRoot, relativeAgent);
		if (!file) continue;
		const raw = await readFile(file.path, "utf8");
		if (SECRET_VALUE.test(raw)) errors.push(`agent ${agentId} contains a credential-like value and cannot be imported`);
		const frontmatter = parseFrontmatter(raw);
		if (frontmatter.name && frontmatter.name !== agentId) errors.push(`agent ${agentId} frontmatter name must match filename`);
		files.push({ ...file, path: relativeAgent, kind: "agent" });
		const isLead = typeof manifest.agentName === "string" && manifest.agentName === agentId;
		if (isLead) leadAgent = agentId;
		if (team && !/sendmessage/i.test(raw)) errors.push(`team agent ${agentId} must declare SendMessage collaboration`);
		members.push({ agentId, lead: isLead, ...(frontmatter.description ? { role: frontmatter.description } : {}) });
	}
	if (team && !leadAgent) errors.push("team manifest must identify an agentName lead");
	const declaredMembers = [
		...(Array.isArray(manifest.members) ? manifest.members : []),
		...(manifest.teamInfo && typeof manifest.teamInfo === "object" && !Array.isArray(manifest.teamInfo) && Array.isArray((manifest.teamInfo as Record<string, unknown>).memberAgents) ? (manifest.teamInfo as Record<string, unknown>).memberAgents as unknown[] : []),
	].map((member) => typeof member === "string" ? member : member && typeof member === "object" && typeof (member as Record<string, unknown>).agentName === "string" ? (member as Record<string, unknown>).agentName as string : undefined).filter((member): member is string => Boolean(member));
	for (const declaredMember of declaredMembers) if (!members.some((member) => member.agentId === declaredMember)) errors.push(`team member agent is missing: ${declaredMember}`);
	const leadPrompt = leadAgent ? await readFile(join(agentsRoot ?? pluginRoot, `${leadAgent}.md`), "utf8").catch(() => "") : "";
	if (team && leadAgent && !/(TeamCreate|team_create|创建团队)/i.test(leadPrompt)) errors.push(`team lead ${leadAgent} must declare team creation/dispatch contract`);
	const skills: string[] = [];
	const skillsRoot = await regularDirectory(pluginRoot, "skills");
	const skillDir = await readdir(skillsRoot ?? pluginRoot, { withFileTypes: true }).catch(() => []);
	for (const entry of skillDir) {
		if (!entry.isDirectory()) continue;
		const skillId = safeName(entry.name, "skillId");
		const relativeSkill = join(plugin.prefix, "skills", skillId, "SKILL.md");
		const file = await regularFile(sourceRoot, relativeSkill);
		if (!file) { errors.push(`skill ${skillId} is missing SKILL.md`); continue; }
		if (SECRET_VALUE.test(await readFile(file.path, "utf8"))) errors.push(`skill ${skillId} contains a credential-like value and cannot be imported`);
		skills.push(skillId);
		files.push({ ...file, path: relativeSkill, kind: "skill" });
	}
	for (const avatarName of [typeof manifest.avatar === "string" ? manifest.avatar : undefined, typeof manifest.avatarLocal === "string" ? manifest.avatarLocal : undefined].filter((value): value is string => Boolean(value))) {
		const avatar = await regularFile(pluginRoot, avatarName);
		if (avatar) files.push({ ...avatar, path: join(plugin.prefix, avatarName), kind: "avatar" });
	}
	const existing = await existingManifest(pluginId);
	const existingVersion = typeof existing?.version === "string" ? existing.version : undefined;
	const manifestHash = manifestFingerprint(manifest);
	const disposition: WorkBuddyImportDisposition = errors.length ? "blocked" : !existing ? "new" : existingHash(existing) === manifestHash ? "same" : existingVersion && compareVersion(versionName, existingVersion) > 0 ? "upgrade" : existingVersion && compareVersion(versionName, existingVersion) < 0 ? "downgrade" : "conflict";
	if (disposition === "downgrade" || disposition === "conflict") warnings.push(`existing import ${existingVersion ?? "unknown"} conflicts with ${versionName}`);
	if (files.length > MAX_FILES) errors.push(`import contains more than ${MAX_FILES} files`);
	const preview: WorkBuddyImportPreview = { version: 1, previewToken: randomUUID(), sourceRoot, pluginId, versionName, disposition: errors.length ? "blocked" : disposition, team, leadAgent, members, skills, files: files.map((file) => ({ ...file, path: file.path.replaceAll("\\", "/") })), warnings: warnings.concat(Object.keys(manifest).filter((key) => SENSITIVE_KEY.test(key)).map((key) => `redacted manifest field: ${key}`)), errors, createdAt: Date.now() };
	previews.set(preview.previewToken, preview);
	return preview;
}

function existingHash(manifest: Record<string, unknown>): string | undefined {
	return typeof manifest.openbuddyManifestHash === "string" ? manifest.openbuddyManifestHash : undefined;
}

async function journalPath(importId: string): Promise<string> { return join(importRoot(), `${importId}.json`); }

function importedRelativePath(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	const match = normalized.match(/^plugins(?:\/marketplaces\/[^/]+)?\/plugins\/[^/]+\/(.+)$/);
	if (!match) throw new Error(`unsupported WorkBuddy resource path: ${path}`);
	const target = match[1];
	if (target.split("/").some((segment) => segment === ".." || segment === "")) throw new Error(`unsafe WorkBuddy resource path: ${path}`);
	return target;
}

export async function confirmWorkBuddyImport(previewToken: string): Promise<WorkBuddyImportResult> {
	const preview = previews.get(previewToken);
	if (!preview || Date.now() - preview.createdAt > PREVIEW_TTL_MS) throw new Error("import preview expired");
	if (preview.errors.length || preview.disposition === "blocked" || preview.disposition === "downgrade" || preview.disposition === "conflict") throw new Error(`import cannot be confirmed: ${preview.disposition}`);
	const importId = `${preview.pluginId}-${preview.versionName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
	const destination = join(piRoot(), "workbuddy-experts", preview.pluginId);
	const journal = await readFile(await journalPath(importId), "utf8").then((raw) => JSON.parse(raw) as ImportJournal).catch(() => undefined);
	if (journal?.status === "installed") return { version: 1, importId, pluginId: preview.pluginId, status: "already-installed", installedFiles: journal.files, expertRoot: destination, autoActivated: false };
	const staging = join(importRoot(), `${importId}.${randomUUID()}.staging`);
	const installed: string[] = [];
	let destinationCommitted = false;
	let backupPath: string | undefined;
	let centerBefore: string | undefined;
	try {
		await mkdir(staging, { recursive: true });
		for (const file of preview.files) {
			const source = safePath(preview.sourceRoot, file.path);
			const target = file.kind === "manifest" ? join(staging, "plugin.json") : join(staging, importedRelativePath(file.path));
			await mkdir(dirname(target), { recursive: true });
			const current = await regularFile(preview.sourceRoot, file.path);
			if (!current || current.sha256 !== file.sha256) throw new Error(`source changed after preview: ${file.path}`);
			if (file.kind === "manifest") {
				const manifest = await readJson(source);
				await writeFile(target, `${JSON.stringify(redact(manifest), null, 2)}\n`, { mode: 0o600 });
			} else {
				await copyFile(source, target);
				const check = await regularFile(staging, importedRelativePath(file.path));
				if (!check || check.sha256 !== file.sha256) throw new Error(`hash changed during import: ${file.path}`);
			}
			installed.push(file.path);
		}
		const manifestPath = join(staging, "plugin.json");
		const manifest = await readJson(manifestPath);
		manifest.openbuddyManifestHash = manifestFingerprint(manifest);
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
		await mkdir(join(staging, ".codebuddy-plugin"), { recursive: true });
		await writeFile(join(staging, ".codebuddy-plugin", "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
		await mkdir(join(staging, "_meta"), { recursive: true });
		await writeFile(join(staging, "_meta", "_expert_center.json"), `${JSON.stringify({
			categories: [{ id: "imported", name: { zh: "已导入", en: "Imported" } }],
			experts: [{ id: preview.pluginId, plugin: preview.pluginId, categoryId: "imported", displayName: preview.pluginId, displayDescription: "从 WorkBuddy 本地配置导入", profession: preview.team ? "专家团" : "专家", expertType: preview.team ? "team" : "agent", agentName: preview.leadAgent ?? preview.members[0]?.agentId }],
		}, null, 2)}\n`, { mode: 0o600 });
		await mkdir(dirname(destination), { recursive: true });
		backupPath = `${destination}.backup-${randomUUID()}`;
		const hadDestination = await stat(destination).then(() => true).catch(() => false);
		if (hadDestination) await rename(destination, backupPath);
		try {
			await rename(staging, destination);
		} catch (error) {
			if (hadDestination) await rename(backupPath, destination).catch(() => undefined);
			throw error;
		}
		destinationCommitted = true;
		const expertRoot = join(piRoot(), "workbuddy-experts");
		const centerPath = join(expertRoot, "_meta", "_expert_center.json");
		centerBefore = await readFile(centerPath, "utf8").catch(() => undefined);
		const center = await readFile(centerPath, "utf8").then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => ({ categories: [], experts: [] }));
		const experts = Array.isArray(center.experts) ? center.experts.filter((item) => !(item && typeof item === "object" && (item as Record<string, unknown>).plugin === preview.pluginId)) : [];
		experts.push({ id: preview.pluginId, plugin: preview.pluginId, categoryId: "imported", displayName: preview.pluginId, displayDescription: "从 WorkBuddy 本地配置导入", profession: preview.team ? "专家团" : "专家", expertType: preview.team ? "team" : "agent", agentName: preview.leadAgent ?? preview.members[0]?.agentId });
		await mkdir(dirname(centerPath), { recursive: true });
		await writeFile(centerPath, `${JSON.stringify({ ...center, categories: [{ id: "imported", name: { zh: "已导入", en: "Imported" } }], experts }, null, 2)}\n`, { mode: 0o600 });
		const record: ImportJournal = { version: 1, importId, pluginId: preview.pluginId, status: "installed", files: installed, ...(hadDestination && backupPath ? { backupPath } : {}), createdAt: Date.now() };
		await mkdir(importRoot(), { recursive: true });
		await writeFile(await journalPath(importId), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
		return { version: 1, importId, pluginId: preview.pluginId, status: "installed", installedFiles: installed, expertRoot: destination, autoActivated: false };
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		if (destinationCommitted) {
			await rm(destination, { recursive: true, force: true });
			if (backupPath) await rename(backupPath, destination).catch(() => undefined);
			const centerPath = join(piRoot(), "workbuddy-experts", "_meta", "_expert_center.json");
			if (centerBefore === undefined) await rm(centerPath, { force: true }).catch(() => undefined);
			else await writeFile(centerPath, centerBefore, { mode: 0o600 }).catch(() => undefined);
		}
		throw error;
	}
}

export async function getWorkBuddyImportStatus(importId: string): Promise<ImportJournal | undefined> {
	return readFile(await journalPath(safeName(importId, "importId")), "utf8").then((raw) => JSON.parse(raw) as ImportJournal).catch(() => undefined);
}

export async function rollbackWorkBuddyImport(importId: string): Promise<WorkBuddyImportResult> {
	const safeImportId = safeName(importId, "importId");
	const journal = await getWorkBuddyImportStatus(safeImportId);
	if (!journal) throw new Error("import journal not found");
	await rm(join(piRoot(), "workbuddy-experts", journal.pluginId), { recursive: true, force: true });
	if (journal.backupPath) await rename(journal.backupPath, join(piRoot(), "workbuddy-experts", journal.pluginId));
	const centerPath = join(piRoot(), "workbuddy-experts", "_meta", "_expert_center.json");
	const center = await readFile(centerPath, "utf8").then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => undefined);
	if (center && Array.isArray(center.experts)) {
		center.experts = center.experts.filter((item) => !(item && typeof item === "object" && (item as Record<string, unknown>).plugin === journal.pluginId));
		await writeFile(centerPath, `${JSON.stringify(center, null, 2)}\n`, { mode: 0o600 });
	}
	const next = { ...journal, status: "rolled-back" as const };
	await writeFile(await journalPath(safeImportId), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
	return { version: 1, importId: safeImportId, pluginId: journal.pluginId, status: "rolled-back", installedFiles: journal.files, expertRoot: join(piRoot(), "workbuddy-experts", journal.pluginId), autoActivated: false };
}
