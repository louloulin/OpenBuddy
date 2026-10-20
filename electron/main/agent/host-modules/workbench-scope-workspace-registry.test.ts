/**
 * workspace registry 的"短暂缺席"容忍度 —— 2026-10-11 真网关冒烟实测。
 *
 * profile reload / cordis 重建期间,context 上的 `workspaceRegistry` 会被注销
 * 再重新 provide。撞在这个窗口里的 `workspace:rename` 曾报 workspace-not-found,
 * 而同一工作区其实就在 dsh-workspaces.json 里(重启后 100% 正常)—— 也就是说
 * 失败的不是"工作区",是"服务暂时不在"。
 *
 * 这条断言是可 mutation 杀的:把 waitForWorkspaceRegistry 换回直接
 * workspaceRegistry(),下面的 rename 立刻抛 WorkspaceOrderInvalidError。
 */
import { describe, expect, it } from "vitest";

import { createDefaultAgentHostState } from "./_default-state";
import { installWorkbenchScope, renameWorkspace } from "./workbench-scope";

const WORKSPACE_ID = "ws-1";

function registryStub() {
	const workspace = {
		id: WORKSPACE_ID,
		path: "/tmp/ws-fixture",
		title: "原标题",
		sessionIds: [],
		createdAt: "2026-10-11T00:00:00.000Z",
		updatedAt: "2026-10-11T00:00:00.000Z",
		setTitle: async (title: string) => {
			workspace.title = title;
			return workspace;
		},
	};
	return {
		ready: async () => {},
		create: async () => workspace,
		get: (id: unknown) => (String(id) === WORKSPACE_ID ? workspace : undefined),
		list: () => [workspace],
		resolveByPath: async () => workspace,
		delete: async () => true,
		insertBefore: async () => [],
		archiveSession: async () => [],
		archivedSessionIds: [],
	};
}

describe("workbench scope / workspace registry", () => {
	it("registry 在 reload 窗口里短暂缺席时,rename 仍能落到同一个工作区", async () => {
		const registry = registryStub();
		const state = createDefaultAgentHostState();
		let lookups = 0;
		// 前两次查不到(注销 → 重新 provide 的窗口),之后恢复。
		(state as { context?: unknown }).context = {
			get: (key: string) => {
				if (key !== "workspaceRegistry") return undefined;
				lookups += 1;
				return lookups > 2 ? registry : undefined;
			},
		};
		installWorkbenchScope({ state, listAllPiSessions: async () => [] });

		const renamed = await renameWorkspace(WORKSPACE_ID, "新标题");

		expect(renamed.title).toBe("新标题");
		expect(lookups).toBeGreaterThan(2);
	});

	it("registry 在场但 id 确实不存在时照常抛错(不吞真错误)", async () => {
		const state = createDefaultAgentHostState();
		(state as { context?: unknown }).context = { get: () => registryStub() };
		installWorkbenchScope({ state, listAllPiSessions: async () => [] });

		await expect(renameWorkspace("ws-不存在", "新标题")).rejects.toThrow(/workspace-not-found|cannot reorder unknown workspace/);
	});
});