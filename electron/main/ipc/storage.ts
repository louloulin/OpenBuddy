/**
 * IPC surface — storage domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { confirmDangerousAction } from "./native-confirm";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readStorageSources, writeStorageSources } from "../agent/pi-resources";
import {
  rendererList,
  rendererRead,
  rendererRemove,
  rendererWriteVersioned,
} from "../storage/renderer-storage";
import { loadCollaborationBootstrap, loadTaskBootstrap, loadWorkspaceBootstrap, recentStorageMetrics } from "../storage/workspace-bootstrap";
import { closeStorage, openStorage, agentHome } from "@openbuddy/storage";
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
		// P0.8/P1(2026-10-19 生产评审 数据§7):用户可见的备份/恢复入口。
		// driver.backup()(VACUUM INTO)与 restoreStorageBackup() 早已存在但
		// 此前零调用方。恢复不直接换文件 —— stage + 标记,重启后由
		// SessionMetadataStore 开库前生效(见 pending-restore.ts)。
		ipcMain.handle("storage:backup-create", async () => {
			const { createStorageBackup } = await import("@openbuddy/storage");
			return createStorageBackup(join(agentHome(), "openbuddy.sqlite"));
		});
		ipcMain.handle("storage:backup-restore", async (_e, args: unknown) => {
			const input = recordValue(args ?? {}, "storage:backup-restore payload");
			const backupPath = absolutePath(input.backupPath, "backupPath");
			const { basename } = await import("node:path");
			const { existsSync, statSync } = await import("node:fs");
			if (!existsSync(backupPath)) throw new Error(`备份文件不存在: ${backupPath}`);
			if (!statSync(backupPath).isFile()) throw new Error(`备份路径不是文件: ${backupPath}`);
			await confirmDangerousAction({
				window: getWindow(),
				title: "恢复备份",
				message: "应用请求用备份覆盖当前数据",
				detail: `备份文件:${basename(backupPath)}\n当前数据将挪到 .pre-restore-<时间戳> 保留,应用重启后生效。`,
				confirmLabel: "允许恢复",
			});
			const { stageStorageRestore } = await import("@openbuddy/storage");
			const staged = await stageStorageRestore({
				backupPath,
				databasePath: join(agentHome(), "openbuddy.sqlite"),
			});
			return { ok: true, stagedPath: staged.stagedPath, schemaVersion: staged.schemaVersion, requiresRestart: true };
		});
		ipcMain.handle("storage-sources:list", async () => readStorageSources());
		ipcMain.handle("storage-sources:save", async (_e, args: unknown) => {
			const input = recordValue(args, "storage sources save payload");
			if (!Array.isArray(input.sources)) throw new Error("sources must be an array");
			// writeAllowedRoot rejects the filesystem root, preventing a
			// "register / as workspace" bypass of shellfs write containment.
			const sources = input.sources.map((source, index) => writeAllowedRoot(absolutePath(source, `sources[${index}]`)));
			return writeStorageSources([...new Set(sources)]);
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
			const path = join(agentHome(), "openbuddy.sqlite");
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
