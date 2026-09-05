/**
 * IPC surface — harness domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { agentHost, bindRendererEventEmitter } from "./agent-host-proxy";
import { getActiveHarnessServer, getHarnessServerAddress } from "../harness/harness-server";
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

export function registerHarnessIpc(getWindow: () => BrowserWindow | null): void {
		ipcMain.handle("harness:address", () => getHarnessServerAddress());
		ipcMain.handle("harness:session-cursors", async () => agentHost.getHarnessSessionCursors());
		ipcMain.handle("harness:session-cursors-set", async (_e, args: unknown) => agentHost.setHarnessSessionCursors(args));
		ipcMain.handle("harness:resume-token", async () => agentHost.getHarnessResumeToken());
		ipcMain.handle("harness:resume-token-set", async (_e, args: unknown) => {
			const token = args && typeof args === "object" && !Array.isArray(args) && "token" in args
				? (args as { token?: unknown }).token
				: args;
			return agentHost.setHarnessResumeToken(token);
		});
		ipcMain.handle("harness:recovery-status", async () => {
			const server = getActiveHarnessServer();
			return server ? server.recoveryStatus() : { pending: 0, uncertain: 0, byMethod: {} };
		});
		ipcMain.handle("harness:recovery-list", async () => runRecoveryMethod("recovery.list", {}));
		ipcMain.handle("harness:recovery-claim", async (_e, args: unknown) => {
			const payload = recordValue(args, "recovery.claim payload") as Record<string, unknown>;
			return runRecoveryMethod("recovery.claim", payload);
		});
		ipcMain.handle("harness:recovery-resolve", async (_e, args: unknown) => {
			const payload = recordValue(args, "recovery.resolve payload") as Record<string, unknown>;
			return runRecoveryMethod("recovery.resolve", payload);
		});
		async function runRecoveryMethod(method: "recovery.list" | "recovery.claim" | "recovery.resolve", payload: Record<string, unknown> = {}): Promise<unknown> {
			const server = getActiveHarnessServer();
			if (!server) throw Object.assign(new Error("harness server is not active"), { code: "service-unavailable" });
			const result = await server.dispatchRecoveryMethod(method, payload, { authority: "loopback", caller: "openbuddy-ui" });
			if (result && typeof result === "object" && "ok" in result) {
				if ((result as { ok: boolean }).ok) return (result as { value: unknown }).value;
				const error = (result as { error: { code: string; message: string; details?: unknown } }).error;
				throw Object.assign(new Error(error.message), { code: error.code, details: error.details });
			}
			return result;
		}
}
