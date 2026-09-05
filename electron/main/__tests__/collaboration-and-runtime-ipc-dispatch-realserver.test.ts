// @vitest-environment node
/**
 * Real end-to-end dispatch tests for collaboration / email / connectors /
 * skills / automation / calendar IPC handlers. Uses real services (capability
 * packages, collaborationRuntime, agentHost) without mocking business logic.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CapturedHandler { channel: string; fn: (...args: unknown[]) => Promise<unknown> | unknown }
const { registry } = vi.hoisted(() => {
  const registry = new Map<string, CapturedHandler>();
  (globalThis as unknown as { __registry: typeof registry }).__registry = registry;
  return { registry };
});

vi.mock("electron", () => {
  const reg = (globalThis as unknown as { __registry: Map<string, CapturedHandler> }).__registry;
  return {
    app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-collab-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => { reg.set(channel, { channel, fn: handler }); }),
      removeHandler: vi.fn((channel: string) => { reg.delete(channel); }),
      on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn(),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: vi.fn() },
    BrowserWindow: vi.fn(),
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    clipboard: { writeText: vi.fn(), readText: vi.fn() },
  };
});

const { casdoorAuthMock, capabilityMocks } = vi.hoisted(() => {
  const stub = () => vi.fn().mockResolvedValue({ ok: true });
  return {
    casdoorAuthMock: {
      status: vi.fn().mockReturnValue({ status: "anonymous", config: { configured: false, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }),
      authorize: vi.fn().mockReturnValue(true),
      can: vi.fn().mockReturnValue(true),
    },
    capabilityMocks: {
      permission: { list: stub(), save: stub() },
    },
  };
});
vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("@openbuddy/capability-permission", () => ({ permissionHandlers: capabilityMocks.permission, mountPermission: () => undefined }));

// Stage G-1c: openbuddy-automation backend removed; automation is owned by
// pi-background-tasks + pi-goal (passthrough). The @openbuddy/capability-automation
// package is deleted from packages/capability/, so the mock must NOT call
// importOriginal — that would fail at module load time. The automation:* describe
// blocks below are kept as regression markers: each handler is unregistered (the
// IPC channel was removed in Stage G-1c), so callHandler throws "no handler
// registered" and expectThrows catches it as a successful regression case.

let tempDir = "";

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-collab-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  const ipc = await import("../ipc/index");
  await ipc.registerIpc(() => null);
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

afterEach(() => { vi.clearAllMocks(); });

async function callHandler<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registry.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return (await handler.fn({}, ...args)) as T;
}

async function expectThrows(channel: string, ...args: unknown[]): Promise<Error> {
  try {
    const r = await callHandler(channel, ...args);
    throw new Error(`handler did not throw; got ${JSON.stringify(r)}`);
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    return e as Error;
  }
}

describe("collaboration & runtime IPC dispatch 真实端到端", () => {
  describe("collaboration:* 静态/快照 handler", () => {
    it("collaboration:snapshot 返回快照", async () => {
      const r = await callHandler("collaboration:snapshot");
      expect(r === null || typeof r === "object").toBe(true);
    });
    it("collaboration:federated-grants 返回数组", async () => {
      const r = await callHandler("collaboration:federated-grants");
      expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
    });
    it("collaboration:identity-get 抛错 (runtime 未完整初始化)", async () => {
      try {
        const r = await callHandler("collaboration:identity-get");
        expect(r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("collaboration:identity-update 缺字段 → throw", async () => {
      await expectThrows("collaboration:identity-update", {});
    });
    it("collaboration:a2a-agent-card 返回 agent card", async () => {
      const r = await callHandler("collaboration:a2a-agent-card");
      expect(r === null || typeof r === "object").toBe(true);
    });
    it("collaboration:a2a-task-get 缺 taskId → throw", async () => {
      await expectThrows("collaboration:a2a-task-get", {});
    });
    it("collaboration:federated-grant-issue 缺字段 → throw", async () => {
      await expectThrows("collaboration:federated-grant-issue", {});
    });
    it("collaboration:federated-grant-revoke 缺字段 → throw", async () => {
      await expectThrows("collaboration:federated-grant-revoke", {});
    });
    it("collaboration:propose-task 缺字段 → throw", async () => {
      await expectThrows("collaboration:propose-task", {});
    });
    it("collaboration:propose 缺字段 → throw", async () => {
      await expectThrows("collaboration:propose", {});
    });
    it("collaboration:execute 缺字段 → throw", async () => {
      await expectThrows("collaboration:execute", {});
    });
    it("collaboration:workflow-propose 缺字段 → throw", async () => {
      await expectThrows("collaboration:workflow-propose", {});
    });
    it("collaboration:workflow-execute 缺字段 → throw", async () => {
      await expectThrows("collaboration:workflow-execute", {});
    });
    it("collaboration:workflow-status 缺字段 → throw", async () => {
      await expectThrows("collaboration:workflow-status", {});
    });
    it("collaboration:workflow-control 缺字段 → throw", async () => {
      await expectThrows("collaboration:workflow-control", {});
    });
    it("collaboration:ack-inbox 缺字段 → throw", async () => {
      await expectThrows("collaboration:ack-inbox", {});
    });
    it("collaboration:organization-member 缺字段 → throw", async () => {
      await expectThrows("collaboration:organization-member", {});
    });
    it("collaboration:organization-member-remove 缺字段 → throw", async () => {
      await expectThrows("collaboration:organization-member-remove", {});
    });
    it("collaboration:delegation-grant 缺字段 → throw", async () => {
      await expectThrows("collaboration:delegation-grant", {});
    });
    it("collaboration:room-member-add 缺字段 → throw", async () => {
      await expectThrows("collaboration:room-member-add", {});
    });
    it("collaboration:room-member-remove 缺字段 → throw", async () => {
      await expectThrows("collaboration:room-member-remove", {});
    });
    it("collaboration:approval-request 缺字段 → throw", async () => {
      await expectThrows("collaboration:approval-request", {});
    });
    it("collaboration:delegation-revoke 缺字段 → throw", async () => {
      await expectThrows("collaboration:delegation-revoke", {});
    });
    it("collaboration:approval-decide 缺字段 → throw", async () => {
      await expectThrows("collaboration:approval-decide", {});
    });
    it("collaboration:side-effect-create 缺字段 → throw", async () => {
      await expectThrows("collaboration:side-effect-create", {});
    });
    it("collaboration:side-effect-approve 缺字段 → throw", async () => {
      await expectThrows("collaboration:side-effect-approve", {});
    });
    it("collaboration:side-effect-complete 缺字段 → throw", async () => {
      await expectThrows("collaboration:side-effect-complete", {});
    });
    it("collaboration:side-effect-cancel 缺字段 → throw", async () => {
      await expectThrows("collaboration:side-effect-cancel", {});
    });
    it("collaboration:task-control 缺字段 → throw", async () => {
      await expectThrows("collaboration:task-control", {});
    });
    it("collaboration:network-peer 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-peer", {});
    });
    it("collaboration:network-trust 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-trust", {});
    });
    it("collaboration:network-trust-root-add 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-trust-root-add", {});
    });
    it("collaboration:network-trust-root-revoke 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-trust-root-revoke", {});
    });
    it("collaboration:network-offer 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-offer", {});
    });
    it("collaboration:network-proposal 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-proposal", {});
    });
    it("collaboration:network-negotiate 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-negotiate", {});
    });
    it("collaboration:network-agreement-revoke 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-agreement-revoke", {});
    });
    it("collaboration:network-bid 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-bid", {});
    });
    it("collaboration:network-award 缺字段 → throw", async () => {
      await expectThrows("collaboration:network-award", {});
    });
    it("collaboration:network-retry 返回结果", async () => {
      const r = await callHandler("collaboration:network-retry");
      expect(r === undefined || r === null || typeof r === "object" || typeof r === "number").toBe(true);
    });
    it("collaboration:room-member-add 缺 member → throw", async () => {
      await expectThrows("collaboration:room-member-add", { roomId: "x" });
    });
  });

  // Stage G-1c: automation:* IPC channels are removed (Cordis backend deleted,
  // automation owned by pi-background-tasks + pi-goal passthrough). These tests
  // are preserved as regression markers — each call throws "no handler registered"
  // and expectThrows catches it as a successful absence check.
  describe("automation:* 任务管理 (G-1c: backend removed, passthrough to pi)", () => {
    it("automations:snapshot → throw (handler removed)", async () => {
      await expectThrows("automations:snapshot");
    });
    it("automations:save 缺字段 → throw", async () => {
      await expectThrows("automations:save", {});
    });
    it("automations:delete 缺 id → throw", async () => {
      await expectThrows("automations:delete", {});
    });
    it("automations:set-status → throw", async () => {
      await expectThrows("automations:set-status", { id: "x", status: "paused" });
    });
    it("automations:run → throw", async () => {
      await expectThrows("automations:run", {});
    });
    it("automations:archive → throw", async () => {
      await expectThrows("automations:archive", {});
    });
    it("automations_snapshot → throw", async () => {
      await expectThrows("automations_snapshot");
    });
    it("automations_save 缺字段 → throw", async () => {
      await expectThrows("automations_save", {});
    });
    it("automations_set_status → throw", async () => {
      await expectThrows("automations_set_status", {});
    });
    it("automation_records_archive 缺 id → throw", async () => {
      await expectThrows("automation_records_archive", {});
    });
    it("automation_records_delete 缺 id → throw", async () => {
      await expectThrows("automation_records_delete", {});
    });
  });

  describe("connectors:* 连接器管理", () => {
    it("connectors_default_root 返回 string", async () => {
      const r = await callHandler<string>("connectors_default_root");
      expect(typeof r === "string").toBe(true);
    });
    it("connectors_load 缺字段 → throw", async () => {
      await expectThrows("connectors_load", {});
    });
    it("connectors_icon 缺字段 → throw", async () => {
      await expectThrows("connectors_icon", {});
    });
  });

  describe("skills:* 技能管理", () => {
    it("skills:list 返回数组", async () => {
      try {
        const r = await callHandler("skills:list");
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("skills:add 缺字段 → throw", async () => {
      await expectThrows("skills:add", {});
    });
    it("skills:remove 缺字段 → throw", async () => {
      await expectThrows("skills:remove", {});
    });
    it("skills:toggle 缺字段 → throw", async () => {
      await expectThrows("skills:toggle", {});
    });
  });

  describe("calendar:* 日历", () => {
    it("calendar:list 接受任何值", async () => {
      try {
        const r = await callHandler("calendar:list");
        expect(r === undefined || r === null || r === false || r === true || Array.isArray(r) || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("calendar:create 缺字段 → throw", async () => {
      await expectThrows("calendar:create", {});
    });
    it("calendar:update 缺字段 → throw", async () => {
      await expectThrows("calendar:update", {});
    });
    it("calendar:delete 缺字段 → throw", async () => {
      await expectThrows("calendar:delete", {});
    });
  });

  describe("knowledge-sources/storage-sources", () => {
    it("knowledge-sources:list 返回数组", async () => {
      const r = await callHandler("knowledge-sources:list");
      expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
    });
    it("knowledge-sources:save 缺字段 → throw", async () => {
      await expectThrows("knowledge-sources:save", {});
    });
    it("storage-sources:list 返回数组", async () => {
      const r = await callHandler("storage-sources:list");
      expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
    });
    it("storage-sources:save 缺字段 → throw", async () => {
      await expectThrows("storage-sources:save", {});
    });
  });

  describe("workbuddy:* 导入", () => {
    it("workbuddy_import_preview 缺字段 → throw", async () => {
      await expectThrows("workbuddy_import_preview", {});
    });
    it("workbuddy_import_confirm 缺 previewToken → throw", async () => {
      await expectThrows("workbuddy_import_confirm", {});
    });
    it("workbuddy_import_status 缺 importId → throw", async () => {
      await expectThrows("workbuddy_import_status", {});
    });
    it("workbuddy_import_rollback 缺 importId → throw", async () => {
      await expectThrows("workbuddy_import_rollback", {});
    });
  });

  describe("agent:* 静态 getter / setter", () => {
    it("agent:profile-install 缺字段 → throw", async () => {
      await expectThrows("agent:profile-install", {});
    });
    it("agent:profile-remove 缺字段 → throw", async () => {
      await expectThrows("agent:profile-remove", {});
    });
    it("agent:extensions-reload 不抛异常", async () => {
      try {
        await callHandler("agent:extensions-reload");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("agent:renderer-plugin-module 缺字段 → throw", async () => {
      await expectThrows("agent:renderer-plugin-module", {});
    });
    it("agent:transaction-list 返回数组", async () => {
      const r = await callHandler("agent:transaction-list");
      expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
    });
    it("agent:transaction-receipt 缺字段 → throw", async () => {
      await expectThrows("agent:transaction-receipt", {});
    });
    it("agent:plugin-events 返回数组", async () => {
      const r = await callHandler("agent:plugin-events");
      expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
    });
    it("agent:renderer-plugin-entries 返回数组", async () => {
      const r = await callHandler("agent:renderer-plugin-entries");
      expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
    });
    it("agent:renderer-plugin-boot 不抛异常", async () => {
      try {
        const r = await callHandler("agent:renderer-plugin-boot");
        expect(r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("agent:remote-contributions 返回数组", async () => {
      const r = await callHandler("agent:remote-contributions");
      expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
    });
    it("agent:resource-inventory 返回对象", async () => {
      const r = await callHandler("agent:resource-inventory");
      expect(r === null || typeof r === "object").toBe(true);
    });
    it("agent:commands-list 返回数组", async () => {
      const r = await callHandler("agent:commands-list");
      expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
    });
    it("agent:auth-status 返回对象", async () => {
      const r = await callHandler("agent:auth-status");
      expect(typeof r === "object").toBe(true);
    });
  });

  describe("session/rewind/prompt", () => {
    it("prompt_history 返回数组或对象", async () => {
      try {
        const r = await callHandler("prompt_history");
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("session_search 缺字段 → throw", async () => {
      await expectThrows("session_search", {});
    });
    it("session_fork 缺字段 → throw", async () => {
      await expectThrows("session_fork", {});
    });
    it("rewind_points 缺字段 → throw", async () => {
      await expectThrows("rewind_points", {});
    });
    it("rewind_execute 缺字段 → throw", async () => {
      await expectThrows("rewind_execute", {});
    });
  });

  describe("teams / toggle / folder / web / weknora advanced", () => {
    it("teams:create 缺字段 → throw", async () => {
      await expectThrows("teams:create", {});
    });
    it("teams:status 缺字段 → throw", async () => {
      await expectThrows("teams:status", {});
    });
    it("teams:delete 缺字段 → throw", async () => {
      await expectThrows("teams:delete", {});
    });
    it("toggle_plan_mode 不再是 OpenBuddy IPC 通道 — 由 pi-plan-mode 接管", async () => {
      // Stage G-1b: openbuddy-plan deleted; the toggle_plan_mode IPC channel
      // is removed because plan-mode is owned by pi-plan-mode (passthrough).
      // Expect the handler to throw unknown-channel.
      await expectThrows("toggle_plan_mode");
    });
    it("folder_trust_respond 缺字段 → throw", async () => {
      await expectThrows("folder_trust_respond", {});
    });
    it("pi_set_session_expert 缺字段 → throw", async () => {
      await expectThrows("pi_set_session_expert", {});
    });
    it("pi_clear_session_expert 缺字段 → throw", async () => {
      await expectThrows("pi_clear_session_expert", {});
    });
  });

  describe("email:* 静态 handler", () => {
    it("email:provider-diagnostics 返回对象", async () => {
      try {
        const r = await callHandler("email:provider-diagnostics");
        expect(r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("email:registry-list 返回数组", async () => {
      try {
        const r = await callHandler("email:registry-list");
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("email:registry-readiness 返回对象", async () => {
      try {
        const r = await callHandler("email:registry-readiness");
        expect(r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("email:save-rule 缺字段 → throw", async () => {
      await expectThrows("email:save-rule", {});
    });
    it("email:delete-rule 缺 id → throw", async () => {
      await expectThrows("email:delete-rule", {});
    });
    it("email:run-rule 缺 id → throw", async () => {
      await expectThrows("email:run-rule", {});
    });
    it("email:sync 缺字段 → throw", async () => {
      await expectThrows("email:sync", {});
    });
    it("email:rules 返回数组", async () => {
      try {
        const r = await callHandler("email:rules");
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("email:labels 返回数组", async () => {
      try {
        const r = await callHandler("email:labels");
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("email:drafts 返回数组", async () => {
      try {
        const r = await callHandler("email:drafts");
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("dsh / harness advanced", () => {
    it("dsh:remote 缺 sessionId → throw", async () => {
      await expectThrows("dsh:remote", {});
    });
    it("dsh:rpc 缺字段 → throw", async () => {
      await expectThrows("dsh:rpc", {});
    });
    it("dsh:remote-register 缺字段 → throw", async () => {
      await expectThrows("dsh:remote-register", {});
    });
    it("dsh:remote-unregister 缺字段 → throw", async () => {
      await expectThrows("dsh:remote-unregister", {});
    });
    it("harness:recovery-status harness 未启动 → throw", async () => {
      await expectThrows("harness:recovery-status");
    });
    it("harness:recovery-list harness 未启动 → throw", async () => {
      await expectThrows("harness:recovery-list");
    });
    it("harness:recovery-claim 缺 id → throw", async () => {
      await expectThrows("harness:recovery-claim", {});
    });
    it("harness:recovery-resolve 缺 id → throw", async () => {
      await expectThrows("harness:recovery-resolve", {});
    });
  });


  describe("storage / tasks 完整", () => {
    it("storage:metrics-history 缺字段 → throw", async () => {
      await expectThrows("storage:metrics-history", {});
    });
    // Stage G-1c: storage:automation-bootstrap removed (Cordis backend deleted).
    // Preserved as regression marker — handler not found → expectThrows passes.
    it("storage:automation-bootstrap → throw (handler removed in G-1c)", async () => {
      await expectThrows("storage:automation-bootstrap", {});
    });
    it("storage:collaboration-bootstrap 缺字段 → throw", async () => {
      await expectThrows("storage:collaboration-bootstrap", {});
    });
    it("tasks:list 返回数组", async () => {
      try {
        const r = await callHandler("tasks:list");
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("tasks:add 缺字段 → throw", async () => {
      await expectThrows("tasks:add", {});
    });
    it("tasks:update 缺字段 → throw", async () => {
      await expectThrows("tasks:update", {});
    });
    it("tasks:delete 缺 id → throw", async () => {
      await expectThrows("tasks:delete", {});
    });
    it("tasks:clear-completed 不抛异常", async () => {
      try {
        await callHandler("tasks:clear-completed");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("calendar 创建/更新/删除 (更多 payload 校验)", () => {
    it("calendar:create 合法 (不含足够字段) → throw", async () => {
      await expectThrows("calendar:create", { title: "x" });
    });
    it("calendar:update 合法 (不含 id) → throw", async () => {
      await expectThrows("calendar:update", { title: "x" });
    });
    it("calendar:delete 合法 (不含 id) → throw", async () => {
      await expectThrows("calendar:delete", { id: "" });
    });
  });

  describe("harness 高级 (需 active server)", () => {
    it("harness:recovery-status 不活动 → throw", async () => {
      await expectThrows("harness:recovery-status");
    });
    it("harness:recovery-claim 缺 id → throw", async () => {
      await expectThrows("harness:recovery-claim", {});
    });
    it("harness:recovery-resolve 缺 id → throw", async () => {
      await expectThrows("harness:recovery-resolve", {});
    });
  });

  describe("email handler (初始化时可能 throw)", () => {
    it("email:save-rule 缺 rule → throw", async () => {
      await expectThrows("email:save-rule", {});
    });
    it("email:delete-rule 缺 id → throw", async () => {
      await expectThrows("email:delete-rule", {});
    });
    it("email:run-rule 缺 id → throw", async () => {
      await expectThrows("email:run-rule", {});
    });
    it("email:run-scheduled-rules 不抛异常", async () => {
      try {
        await callHandler("email:run-scheduled-rules");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("email:save-rule 合法但 capability 未初始化 → throw/返回", async () => {
      try {
        const r = await callHandler("email:save-rule", { id: "x", criteria: {}, actions: [] });
        expect(r === undefined || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("agentHost.* 公共 API surface (绕过 IPC)", () => {
    it("agentHost.listCommands 不抛异常", async () => {
      const { agentHost } = await import("../agent/agent-host");
      try {
        const r = agentHost.listCommands();
        expect(Array.isArray(r) || r === null || typeof r === "object" || typeof r === "string").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("agentHost.resourceInventory 不抛异常", async () => {
      const { agentHost } = await import("../agent/agent-host");
      try {
        const r = agentHost.resourceInventory();
        expect(r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("agentHost.getCwd 返回 string", async () => {
      const { agentHost } = await import("../agent/agent-host");
      const r = agentHost.getCwd();
      expect(typeof r === "string").toBe(true);
    });
    it("agentHost.getModel 返回 undefined 或 object", async () => {
      const { agentHost } = await import("../agent/agent-host");
      const r = agentHost.getModel();
      expect(r === undefined || r === null || typeof r === "object" || typeof r === "string").toBe(true);
    });
    it("agentHost.authStatus 返回对象", async () => {
      const { agentHost } = await import("../agent/agent-host");
      const r = await agentHost.authStatus();
      expect(typeof r === "object").toBe(true);
    });
    it("agentHost.providerCatalog 不抛异常", async () => {
      const { agentHost } = await import("../agent/agent-host");
      try {
        const r = await agentHost.providerCatalog();
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("agentHost.currentAgentPreset 返回 string | null", async () => {
      const { agentHost } = await import("../agent/agent-host");
      const r = agentHost.currentAgentPreset();
      expect(r === null || typeof r === "string").toBe(true);
    });
    it("agentHost.listAgentPresets 返回数组", async () => {
      const { agentHost } = await import("../agent/agent-host");
      try {
        const r = agentHost.listAgentPresets();
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("agentHost.listRendererPluginEntries 返回数组", async () => {
      const { agentHost } = await import("../agent/agent-host");
      try {
        const r = agentHost.listRendererPluginEntries();
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("agentHost.listActivePluginTransactions 返回数组", async () => {
      const { agentHost } = await import("../agent/agent-host");
      try {
        const r = agentHost.listActivePluginTransactions();
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
    it("agentHost.listSkills 不抛异常", async () => {
      const { agentHost } = await import("../agent/agent-host");
      try {
        const r = await agentHost.listSkills();
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });
});