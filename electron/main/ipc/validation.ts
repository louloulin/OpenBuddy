/**
 * IPC payload validation helpers — extracted from `ipc.ts` (P0 modularization).
 *
 * Pure functions + workspace error normalization used by the renderer-facing
 * RPC dispatch and `registerIpc` handler registrations. No side effects; unit
 * testable in isolation.
 */
import { isAbsolute, resolve } from "node:path";
import * as resources from "../agent/pi-resources";
import {
	WorkspaceInvalidPathError,
	WorkspaceMoveInvalidError,
	WorkspaceNameConflictError,
	WorkspaceOrderInvalidError,
	WorkspaceTitleInvalidError,
	WorkspaceUnknownSessionError,
} from "../deepseek/deepseek-runtime";

export type RecordValue = Record<string, unknown>;
export type PublicPermissionMode = (typeof permissionModes)[number];
export type WorkspaceIpcError = Error & { code?: string; details?: Record<string, unknown> };
export const permissionModes = ["default", "acceptEdits", "dontAsk", "plan", "bypassPermissions"] as const;


export function throwWorkspaceIpcError(error: unknown, details: Record<string, unknown> = {}): never {
	const source = error instanceof Error ? error : new Error(String(error));
	const normalized = source as WorkspaceIpcError;
	if (error instanceof WorkspaceInvalidPathError) {
		normalized.code = "workspace-invalid-path";
		normalized.details = { path: error.path };
	} else if (error instanceof WorkspaceNameConflictError) {
		normalized.code = "workspace-name-conflict";
		normalized.details = { name: error.workspaceName };
	} else if (error instanceof WorkspaceTitleInvalidError) {
		normalized.code = "bad-request";
		normalized.details = {};
	} else if (error instanceof WorkspaceUnknownSessionError) {
		normalized.code = "session-not-found";
		normalized.details = { sessionId: error.sessionId };
	} else if (error instanceof WorkspaceMoveInvalidError) {
		normalized.code = "workspace-move-invalid";
		normalized.details = details;
	} else if (error instanceof WorkspaceOrderInvalidError) {
		normalized.code = "workspace-not-found";
		normalized.details = { workspaceId: error.workspaceId };
	} else {
		normalized.code ??= "internal";
		normalized.details ??= details;
	}
	normalized.name = `OpenBuddyWorkspaceError:${normalized.code}`;
	throw normalized;
}

export function recordValue(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value as RecordValue;
}

export function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
	return value.trim();
}

export function stringValue(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

export function numberValue(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
	return value;
}

export function normalizePromptContent(value: unknown): Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }> {
	if (!Array.isArray(value) || value.length === 0) throw new Error("action.content must be a non-empty array");
	return value.map((part, index) => {
		const entry = recordValue(part, `action.content[${index}]`);
		const type = enumValue(entry.type, `action.content[${index}].type`, ["text", "image"] as const);
		if (type === "text") return { type, text: requiredString(entry.text, `action.content[${index}].text`) };
		return {
			type,
			mediaType: requiredString(entry.mediaType, `action.content[${index}].mediaType`),
			data: requiredString(entry.data, `action.content[${index}].data`),
			...(entry.name === undefined ? {} : { name: requiredString(entry.name, `action.content[${index}].name`) }),
		};
	});
}

export function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	return requiredString(value, label);
}

export function requiredBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
	return value;
}

export function optionalFiniteInteger(value: unknown, label: string, fallback: number, min: number, max: number): number {
	if (value === undefined || value === null) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
		throw new Error(`${label} must be an integer between ${min} and ${max}`);
	}
	return value;
}

export function emailRuleSchedule(value: unknown): { intervalMinutes: number; nextRunAt?: string } {
	const input = recordValue(value, "email rule schedule");
	const intervalMinutes = optionalFiniteInteger(input.intervalMinutes, "email rule schedule intervalMinutes", 60, 15, 7 * 24 * 60);
	if (input.nextRunAt === undefined || input.nextRunAt === null) return { intervalMinutes };
	const nextRunAt = requiredString(input.nextRunAt, "email rule schedule nextRunAt");
	if (!Number.isFinite(Date.parse(nextRunAt))) throw new Error("email rule schedule nextRunAt must be a valid date");
	return { intervalMinutes, nextRunAt };
}

export function optionalNonNegativeIntegerArray(value: unknown, label: string): number[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value.map((entry, index) => optionalFiniteInteger(entry, `${label}[${index}]`, 0, 0, Number.MAX_SAFE_INTEGER));
}

export function optionalFiniteNumber(value: unknown, label: string, fallback: number, min: number, max: number): number {
	if (value === undefined || value === null) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
		throw new Error(`${label} must be a number between ${min} and ${max}`);
	}
	return value;
}

export function absolutePath(value: unknown, label: string): string {
	const result = requiredString(value, label);
	if (!isAbsolute(result)) throw new Error(`${label} must be an absolute path`);
	return result;
}

export function enumValue<T extends string>(value: unknown, label: string, values: readonly T[]): T {
	if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${label} is invalid`);
	return value as T;
}

function optionalEnumValue<T extends string>(value: unknown, label: string, values: readonly T[]): T | undefined {
	if (value === undefined || value === null) return undefined;
	return enumValue(value, label, values);
}

function optionalAbsolutePath(value: unknown, label: string, fallback?: string): string {
	if (value === undefined || value === null) return requiredString(fallback ?? "/", label);
	return absolutePath(value, label);
}

export function optionalStringArray(value: unknown, label: string): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
}

export function requiredStringArray(value: unknown, label: string): string[] {
	const result = optionalStringArray(value, label);
	if (!result || result.length === 0) throw new Error(`${label} must contain at least one value`);
	return result;
}

function emailAddressValue(value: unknown, label: string): { address: string; name?: string } {
	const input = recordValue(value, label);
	const address = requiredString(input.address ?? input.email, `${label}.address`);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error(`${label}.address must be a valid email address`);
	return { address, ...(input.name === undefined ? {} : { name: requiredString(input.name, `${label}.name`) }) };
}

function emailAddressArray(value: unknown, label: string, required = false): Array<{ address: string; name?: string }> {
	if (value === undefined || value === null) {
		if (required) throw new Error(`${label} must be an array`);
		return [];
	}
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value.map((entry, index) => emailAddressValue(entry, `${label}[${index}]`));
}

export function emailSearchPayload(value: unknown): Record<string, unknown> {
	const input = recordValue(value, "email threads payload");
	const result: Record<string, unknown> = {};
	if (input.accountId !== undefined) result.accountId = requiredString(input.accountId, "accountId");
	if (input.query !== undefined) result.query = stringValue(input.query, "query");
	if (input.folder !== undefined) result.folder = enumValue(input.folder, "folder", ["inbox", "sent", "drafts", "archive", "trash", "spam", "starred", "important", "snoozed", "custom"] as const);
	if (input.labelId !== undefined) result.labelId = requiredString(input.labelId, "labelId");
	if (input.tags !== undefined) result.tags = requiredStringArray(input.tags, "tags");
	if (input.tagMatch !== undefined) result.tagMatch = enumValue(input.tagMatch, "tagMatch", ["any", "all"] as const);
	if (input.from !== undefined) result.from = requiredString(input.from, "from");
	if (input.to !== undefined) result.to = requiredString(input.to, "to");
	if (input.unread !== undefined) result.unread = requiredBoolean(input.unread, "unread");
	if (input.hasAttachment !== undefined) result.hasAttachment = requiredBoolean(input.hasAttachment, "hasAttachment");
	if (input.since !== undefined) result.since = requiredString(input.since, "since");
	if (input.until !== undefined) result.until = requiredString(input.until, "until");
	if (input.limit !== undefined) result.limit = optionalFiniteInteger(input.limit, "limit", 50, 1, 200);
	if (input.cursor !== undefined) result.cursor = requiredString(input.cursor, "cursor");
	return result;
}

export function emailTagMutationPayload(value: unknown): Record<string, unknown> {
	const input = recordValue(value, "email workspace-tags payload");
	return {
		accountId: requiredString(input.accountId, "accountId"),
		threadId: requiredString(input.threadId, "threadId"),
		tagNames: requiredStringArray(input.tagNames, "tagNames"),
		...(input.mode === undefined ? {} : { mode: enumValue(input.mode, "mode", ["add", "remove", "replace"] as const) }),
	};
}

export function emailMutationPayload(value: unknown): Record<string, unknown> {
	const input = recordValue(value, "email update payload");
	return {
		accountId: requiredString(input.accountId, "accountId"),
		threadId: requiredString(input.threadId, "threadId"),
		kind: enumValue(input.kind, "kind", ["mark-read", "mark-unread", "archive", "restore", "label", "star", "trash", "spam", "snooze"] as const),
		...(input.labelId === undefined ? {} : { labelId: requiredString(input.labelId, "labelId") }),
		...(input.threadIds === undefined ? {} : { threadIds: requiredStringArray(input.threadIds, "threadIds") }),
		...(input.value === undefined ? {} : { value: requiredBoolean(input.value, "value") }),
		...(input.dryRun === undefined ? {} : { dryRun: requiredBoolean(input.dryRun, "dryRun") }),
		...(input.sampleLimit === undefined ? {} : { sampleLimit: optionalFiniteInteger(input.sampleLimit, "sampleLimit", 5, 1, 20) }),
		...(input.confirmed === undefined ? {} : { confirmed: requiredBoolean(input.confirmed, "confirmed") }),
		...(input.snoozeUntil === undefined ? {} : { snoozeUntil: requiredString(input.snoozeUntil, "snoozeUntil") }),
	};
}

export function emailComposePayload(value: unknown): Record<string, unknown> {
	const input = recordValue(value, "email draft payload");
	const attachments = optionalStringArray(input.attachments, "attachments") ?? [];
	if (attachments.length > 20) throw new Error("attachments must contain at most 20 paths");
	for (const attachment of attachments) absolutePath(attachment, "attachments[]");
	return {
		accountId: requiredString(input.accountId, "accountId"),
		...(input.draftId === undefined ? {} : { draftId: requiredString(input.draftId, "draftId") }),
		to: emailAddressArray(input.to, "to", true),
		cc: emailAddressArray(input.cc, "cc"),
		bcc: emailAddressArray(input.bcc, "bcc"),
		replyTo: emailAddressArray(input.replyTo, "replyTo"),
		subject: requiredString(input.subject, "subject"),
		body: stringValue(input.body, "body"),
		...(input.bodyHtml === undefined ? {} : { bodyHtml: stringValue(input.bodyHtml, "bodyHtml") }),
		attachments,
		...(input.threadId === undefined ? {} : { threadId: requiredString(input.threadId, "threadId") }),
		...(input.messageId === undefined ? {} : { messageId: requiredString(input.messageId, "messageId") }),
	};
}

export async function assertPolicyModelAllowed(modelId: string): Promise<void> {
	const policy = await resources.readPolicyConfig();
	const rules = policy.rules.filter((rule) => rule.type === "model-whitelist").sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
	const whitelist = rules[0]?.value;
	if (!Array.isArray(whitelist) || whitelist.length === 0) return;
	const shortId = modelId.split("/").pop() ?? modelId;
	if (!whitelist.includes(modelId) && !whitelist.includes(shortId)) {
		throw new Error(`策略禁止使用模型: ${modelId}`);
	}
}

export async function assertPolicySkillUploadAllowed(): Promise<void> {
	const policy = await resources.readPolicyConfig();
	const rules = policy.rules.filter((rule) => rule.type === "skill-upload").sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
	if (rules[0]?.value === false) throw new Error("策略禁止上传技能");
}

export function writeAllowedRoot(root: string): string {
	const resolved = resolve(root);
	if (resolved === resolve(resolved, "..")) throw new Error("workspaceRoot cannot be the filesystem root");
	return resolved;
}

export function providerId(value: unknown, label = "provider id"): string {
	const id = requiredString(value, label);
	if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) throw new Error(`${label} must be 1-64 chars of [a-zA-Z0-9._-]`);
	return id;
}

export function modelId(value: unknown, label = "model id"): string {
	const id = requiredString(value, label);
	if (id.length > 256 || /[\u0000\r\n]/.test(id)) throw new Error(`${label} must be at most 256 characters`);
	return id;
}

export function httpUrl(value: unknown, label: string): string {
	const text = requiredString(value, label);
	let parsed: URL;
	try { parsed = new URL(text); } catch { throw new Error(`${label} must be a valid http(s) URL`); }
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${label} must be a valid http(s) URL`);
	return text;
}

function dialogFilters(value: unknown): Electron.FileFilter[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error("filters must be an array");
	return value.map((entry, index) => {
		const filter = recordValue(entry, `filters[${index}]`);
		const name = requiredString(filter.name, `filters[${index}].name`);
		if (!Array.isArray(filter.extensions) || filter.extensions.length === 0) throw new Error(`filters[${index}].extensions must be a non-empty array`);
		return { name, extensions: filter.extensions.map((extension, extensionIndex) => requiredString(extension, `filters[${index}].extensions[${extensionIndex}]`).replace(/^\.+/, "")) };
	});
}

export function openDialogOptions(value: unknown): Electron.OpenDialogOptions {
	const input = value === undefined || value === null ? {} : recordValue(value, "open dialog options");
	const properties = input.properties === undefined ? undefined : optionalStringArray(input.properties, "properties") as Electron.OpenDialogOptions["properties"];
	return {
		...(input.title === undefined ? {} : { title: requiredString(input.title, "title") }),
		...(input.defaultPath === undefined ? {} : { defaultPath: absolutePath(input.defaultPath, "defaultPath") }),
		...(input.buttonLabel === undefined ? {} : { buttonLabel: requiredString(input.buttonLabel, "buttonLabel") }),
		...(input.message === undefined ? {} : { message: requiredString(input.message, "message") }),
		...(properties === undefined ? {} : { properties }),
		...(input.filters === undefined ? {} : { filters: dialogFilters(input.filters) }),
	};
}

export function saveDialogOptions(value: unknown): Electron.SaveDialogOptions {
	const input = value === undefined || value === null ? {} : recordValue(value, "save dialog options");
	return {
		...(input.title === undefined ? {} : { title: requiredString(input.title, "title") }),
		...(input.defaultPath === undefined ? {} : { defaultPath: absolutePath(input.defaultPath, "defaultPath") }),
		...(input.buttonLabel === undefined ? {} : { buttonLabel: requiredString(input.buttonLabel, "buttonLabel") }),
		...(input.message === undefined ? {} : { message: requiredString(input.message, "message") }),
		...(input.filters === undefined ? {} : { filters: dialogFilters(input.filters) }),
	};
}

// Public permission modes aligned with Pi native 5档 (default / acceptEdits / dontAsk / plan / bypassPermissions).
// Renderer-side uses these IDs directly; IPC <-> package 1:1 mapping replaces the legacy lossy 3档 (ask/auto/always-approve) shim.

export function publicPermissionMode(value: unknown, label = "permission mode"): PublicPermissionMode {
		return enumValue(value, label, permissionModes);
}

export function toPiPermissionMode(mode: PublicPermissionMode): PublicPermissionMode {
		return mode;
}

export function fromPiPermissionMode(mode: unknown): PublicPermissionMode {
		switch (mode) {
			case "default":
			case "acceptEdits":
			case "dontAsk":
			case "plan":
			case "bypassPermissions":
				return mode as PublicPermissionMode;
			default:
				return "default";
		}
}

export function optionalCwd(input: RecordValue, label = "cwd"): string | undefined {
		return input[label] === undefined || input[label] === null ? undefined : absolutePath(input[label], label);
}

export function memoryScope(value: unknown): "global" | "workspace" {
		return enumValue(value, "scope", ["global", "workspace"] as const);
}

export function permissionRules(value: unknown): Array<{ action: "allow" | "deny" | "ask"; tool: string; pattern?: string }> {
	if (!Array.isArray(value)) throw new Error("permission rules must be an array");
	return value.map((rule, index) => {
		const input = recordValue(rule, `rules[${index}]`);
		return {
			action: enumValue(input.action, `rules[${index}].action`, ["allow", "deny", "ask"] as const),
			tool: requiredString(input.tool, `rules[${index}].tool`),
			...(input.pattern === undefined ? {} : { pattern: stringValue(input.pattern, `rules[${index}].pattern`) }),
		};
	});
}
// ---------- OpenBuddy content (text + image) normalization ----------
// The Composer can attach images (paste / drop / file-picker). Pi's prompt
// pipeline accepts PiPromptContentPart[]; we re-validate the wire format here
// and surface only what we need for IPC. Images cap to a generous 16 MB of
// base64 (~12 MB binary) so the renderer does not accidentally send a raw
// 4K screenshot through the preload bridge in one go.

export const OPENBUDDY_MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export function promptImagePart(
	input: RecordValue,
	label: string,
): { type: "image"; mediaType: string; data: string; name?: string } {
	const mediaType = requiredString(input.mediaType, `${label}.mediaType`);
	if (!/^image\/(png|jpe?g|webp|gif)$/i.test(mediaType)) {
		throw new Error(`${label}.mediaType must be image/png|jpeg|webp|gif`);
	}
	const data = requiredString(input.data, `${label}.data`);
	// base64 length * 3/4 ≈ bytes; refuse oversized payloads early.
	const approxBytes = Math.floor((data.length * 3) / 4);
	if (approxBytes > OPENBUDDY_MAX_IMAGE_BYTES) {
		throw new Error(`${label}.data exceeds ${OPENBUDDY_MAX_IMAGE_BYTES} bytes after decoding`);
	}
	return {
		type: "image",
		mediaType,
		data,
		...(input.name === undefined ? {} : { name: requiredString(input.name, `${label}.name`) }),
	};
}

export function promptContentPart(
	input: RecordValue,
	label: string,
): { type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string } {
	const type = enumValue(input.type, `${label}.type`, ["text", "image"] as const);
	if (type === "text") return { type, text: requiredString(input.text, `${label}.text`) };
	return promptImagePart(input, label);
}

export function promptContent(value: unknown, label = "content"): Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }> {
	if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
	return value.map((part, index) => promptContentPart(recordValue(part, `${label}[${index}]`), `${label}[${index}]`));
}

export function optionalPromptContent(value: unknown, label = "content"): Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }> | undefined {
	if (value === undefined || value === null) return undefined;
	return promptContent(value, label);
}

// ---------- Thinking level / permission mode validation ----------

export type OpenBuddyThinkingLevel = "off" | "low" | "medium" | "high";

export function thinkingLevel(value: unknown, label = "thinking level"): OpenBuddyThinkingLevel {
	return enumValue(value, label, ["off", "low", "medium", "high"] as const);
}

export function optionalThinkingLevel(value: unknown, label = "thinking level"): OpenBuddyThinkingLevel | undefined {
	if (value === undefined || value === null) return undefined;
	return thinkingLevel(value, label);
}
