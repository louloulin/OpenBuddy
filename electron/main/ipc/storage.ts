/**
 * IPC surface — storage domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as resources from "../agent/pi-resources";
import {
  rendererList,
  rendererRead,
  rendererRemove,
  rendererWriteVersioned,
} from "../storage/renderer-storage";
import { loadCollaborationBootstrap, loadTaskBootstrap, loadWorkspaceBootstrap, recentStorageMetrics } from "../storage/workspace-bootstrap";
import { closeStorage, openStorage } from "@openbuddy/storage";
import {
	absolutePath,
	assertPolicyModelAllowed,
	assertPolicySkillUploadAllowed,
	emailComposePayload,
	emailMutationPayload,
	emailRuleSchedule,
	emailSearchPayload,
	emailTagMutationPayload,
	enumValue,
	fromPiPermissionMode,
	httpUrl,
	memoryScope,
	modelId,
	normalizePromptContent,
	numberValue,
	openDialogOptions,
	optionalCwd,
	optionalFiniteInteger,
	optionalFiniteNumber,
	optionalNonNegativeIntegerArray,
	optionalString,
	optionalStringArray,
	permissionRules,
	providerId,
	publicPermissionMode,
	recordValue,
	requiredBoolean,
	requiredString,
	requiredStringArray,
	saveDialogOptions,
	stringValue,
	throwWorkspaceIpcError,
	toPiPermissionMode,
	writeAllowedRoot,
	type RecordValue,
} from "./validation";

export function registerStorageIpc(getWindow: () => BrowserWindow | null): void {
		ipcMain.handle("storage-sources:list", async () => resources.readStorageSources());
		ipcMain.handle("storage-sources:save", async (_e, args: unknown) => {
			const input = recordValue(args, "storage sources save payload");
			if (!Array.isArray(input.sources)) throw new Error("sources must be an array");
			const sources = input.sources.map((source, index) => absolutePath(source, `sources[${index}]`));
			return resources.writeStorageSources([...new Set(sources)]);
		});
		ipcMain.handle("storage:renderer-read", async (_e, args: unknown) => {
			const payload = recordValue(args ?? {}, "storage:renderer-read payload");
			return rendererRead({ namespace: requiredString(payload.namespace, "namespace"), key: requiredString(payload.key, "key") });
		});
		ipcMain.handle("storage:renderer-list", async (_e, args: unknown) => {
			const payload = recordValue(args ?? {}, "storage:renderer-list payload");
			return rendererList({ namespace: requiredString(payload.namespace, "namespace") });
		});
		ipcMain.handle("storage:renderer-write", async (_e, args: unknown) => {
			const payload = recordValue(args ?? {}, "storage:renderer-write payload");
			const version = payload.version === undefined ? 1 : numberValue(payload.version, "version");
			const expectedVersion = payload.expectedVersion === undefined ? undefined : numberValue(payload.expectedVersion, "expectedVersion");
			return rendererWriteVersioned({
				namespace: requiredString(payload.namespace, "namespace"),
				key: requiredString(payload.key, "key"),
				value: payload.value,
				version,
				expectedVersion,
			});
		});
		ipcMain.handle("storage:renderer-remove", async (_e, args: unknown) => {
			const payload = recordValue(args ?? {}, "storage:renderer-remove payload");
			return rendererRemove({ namespace: requiredString(payload.namespace, "namespace"), key: requiredString(payload.key, "key") });
		});
		ipcMain.handle("storage:metrics", async () => {
			const path = join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent"), "openbuddy.sqlite");
			try {
				const opened = await openStorage({ filePath: path, appVersion: "openbuddy-ipc-metrics" });
				try {
					return { ok: true, snapshot: opened.driver.healthSnapshot() };
				} finally {
					await closeStorage(Promise.resolve(opened));
				}
			} catch (error) {
				return { ok: false, error: String(error instanceof Error ? error.message : error) };
			}
		});
		ipcMain.handle("storage:metrics-history", async (_e, args: unknown) => {
			const limit = args && typeof args === "object" && "limit" in args && typeof (args as { limit?: unknown }).limit === "number"
				? Math.max(0, Math.min(64, Math.floor((args as { limit: number }).limit)))
				: 8;
			return { ok: true, history: recentStorageMetrics(limit) };
		});
		ipcMain.handle("storage:workspace-bootstrap", async () => {
			try {
				return { ok: true, snapshot: await loadWorkspaceBootstrap() };
			} catch (error) {
				return { ok: false, error: String(error instanceof Error ? error.message : error) };
			}
		});
		ipcMain.handle("storage:task-bootstrap", async (_e, args: unknown) => {
			const payload = recordValue(args ?? {}, "storage:task-bootstrap payload");
			const sessionId = requiredString(payload.sessionId, "sessionId");
			try {
				return { ok: true, snapshot: await loadTaskBootstrap(sessionId) };
			} catch (error) {
				return { ok: false, error: String(error instanceof Error ? error.message : error) };
			}
		});
		// Stage G-1c: storage:automation-bootstrap removed; automation is
		// owned by pi-background-tasks + pi-goal (passthrough). Renderer
		// callers should reach the pi-native tool surface directly.
		ipcMain.handle("storage:collaboration-bootstrap", async () => {
			try {
				return { ok: true, snapshot: loadCollaborationBootstrap() };
			} catch (error) {
				return { ok: false, error: String(error instanceof Error ? error.message : error) };
			}
		});
}
