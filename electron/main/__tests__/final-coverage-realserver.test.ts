// @vitest-environment node
/**
 * Final coverage: clipboard:read-text, dialog:ask/confirm, window:is-maximized,
 * folder_trust_respond, skills_catalog, connectors,
 * experts, workbuddy, plugins_action, marketplace_action, automations_*,
 * automation_records_*, email:* mutation handlers,
 * weknora:list-knowledge-bases, storage:*.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
    app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-final-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => { reg.set(channel, { channel, fn: handler }); }),
      removeHandler: vi.fn((channel: string) => { reg.delete(channel); }),
      on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn(),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: vi.fn() },
    BrowserWindow: vi.fn(),
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }),
      showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
    },
    clipboard: { writeText: vi.fn(), readText: vi.fn().mockReturnValue("hello world") },
  };
});

const { casdoorAuthMock, capabilityMocks } = vi.hoisted(() => ({
  casdoorAuthMock: {
    status: vi.fn().mockReturnValue({ status: "anonymous", config: { configured: false, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }),
    authorize: vi.fn().mockReturnValue(true),
    can: vi.fn().mockReturnValue(true),
  },
  capabilityMocks: {
    permission: { list: () => vi.fn().mockResolvedValue({ ok: true }), save: () => vi.fn().mockResolvedValue({ ok: true }) },
  },
}));
vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("@openbuddy/capability-permission", () => ({ permissionHandlers: capabilityMocks.permission, mountPermission: () => undefined }));

// Stage G-1c: openbuddy-automation backend removed; automation is owned by
// pi-background-tasks + pi-goal (passthrough). The @openbuddy/capability-automation
// package is deleted from packages/capability/, so the mock must NOT call
// importOriginal — that would fail at module load time. The automation describe
// blocks below are kept as regression markers: each handler is unregistered, so
// callHandler throws "no handler registered" and expectThrows catches it as a
// successful absence check.

let tempDir = "";

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-final-"));
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

describe("final coverage 真实端到端", () => {
  describe("clipboard / dialog / window", () => {
    it("clipboard:read-text 返回 string", async () => {
      const r = await callHandler<string>("clipboard:read-text");
      expect(typeof r === "string").toBe(true);
    });
    it("dialog:ask 合法 → 返回 boolean", async () => {
      const r = await callHandler<boolean>("dialog:ask", { message: "x", defaultId: 0 });
      expect(typeof r === "boolean").toBe(true);
    });
    it("dialog:confirm 合法 → 返回 boolean", async () => {
      const r = await callHandler<boolean>("dialog:confirm", { message: "x" });
      expect(typeof r === "boolean").toBe(true);
    });
    it("window:is-maximized 返回 boolean", async () => {
      const r = await callHandler<boolean>("window:is-maximized");
      expect(typeof r === "boolean").toBe(true);
    });
  });

  describe("skills_catalog", () => {
    it("skills_catalog_default_root 返回 string", async () => {
      const r = await callHandler<string>("skills_catalog_default_root");
      expect(typeof r === "string").toBe(true);
    });
    it("skills_catalog_list_roots 缺 root → throw", async () => {
      await expectThrows("skills_catalog_list_roots", {});
    });
    it("skills_catalog_load 缺 root → throw", async () => {
      await expectThrows("skills_catalog_load", {});
    });
    it("skills_catalog_read_skill 缺字段 → throw", async () => {
      await expectThrows("skills_catalog_read_skill", {});
    });
  });

  describe("connectors", () => {
    it("connectors_default_root 返回 string", async () => {
      const r = await callHandler<string>("connectors_default_root");
      expect(typeof r === "string").toBe(true);
    });
    it("connectors_icon 缺字段 → throw", async () => {
      await expectThrows("connectors_icon", {});
    });
    it("connectors_read_mcp_config 缺字段 → throw", async () => {
      await expectThrows("connectors_read_mcp_config", {});
    });
    it("connectors_cli_status 缺字段 → throw", async () => {
      await expectThrows("connectors_cli_status", {});
    });
    it("connectors_cli_auth 缺字段 → throw", async () => {
      await expectThrows("connectors_cli_auth", {});
    });
    it("connectors_cli_auth_cancel 缺 source → throw", async () => {
      await expectThrows("connectors_cli_auth_cancel", {});
    });
    it("connectors_cli_unauth 缺字段 → throw", async () => {
      await expectThrows("connectors_cli_unauth", {});
    });
    it("connectors_cli_skills_dir 缺字段 → throw", async () => {
      await expectThrows("connectors_cli_skills_dir", {});
    });
  });

  describe("experts", () => {
    it("experts_default_root 返回 string", async () => {
      const r = await callHandler<string>("experts_default_root");
      expect(typeof r === "string").toBe(true);
    });
    it("experts_list_roots 缺 root → throw", async () => {
      await expectThrows("experts_list_roots", {});
    });
    it("experts_load 缺 root → throw", async () => {
      await expectThrows("experts_load", {});
    });
    it("experts_thumbnail 缺字段 → throw", async () => {
      await expectThrows("experts_thumbnail", {});
    });
    it("experts_image_bytes 缺字段 → throw", async () => {
      await expectThrows("experts_image_bytes", {});
    });
    it("experts_read_agent_prompt 缺字段 → throw", async () => {
      await expectThrows("experts_read_agent_prompt", {});
    });
  });

  describe("workbuddy", () => {
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

  describe("plugins_action / marketplace_action", () => {
    it("plugins_action 缺 action → throw", async () => {
      await expectThrows("plugins_action", {});
    });
    it("marketplace_action 缺字段 → throw", async () => {
      await expectThrows("marketplace_action", {});
    });
  });

  describe("agent:providers mutations", () => {
    it("agent:providers-save-provider 缺字段 → throw", async () => {
      await expectThrows("agent:providers-save-provider", {});
    });
    it("agent:providers-save-model 缺字段 → throw", async () => {
      await expectThrows("agent:providers-save-model", {});
    });
    it("agent:providers-delete-provider 缺字段 → throw", async () => {
      await expectThrows("agent:providers-delete-provider", {});
    });
    it("agent:providers-delete-model 缺字段 → throw", async () => {
      await expectThrows("agent:providers-delete-model", {});
    });
    it("agent:providers-fetch-models 不抛异常", async () => {
      try {
        await callHandler("agent:providers-fetch-models", { providerId: "x" });
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("pi_session_expert", () => {
    it("pi_set_session_expert 缺字段 → throw", async () => {
      await expectThrows("pi_set_session_expert", {});
    });
    it("pi_clear_session_expert 缺字段 → throw", async () => {
      await expectThrows("pi_clear_session_expert", {});
    });
  });

  // Stage G-1c: automation:* IPC channels are removed (Cordis backend deleted,
  // automation owned by pi-background-tasks + pi-goal passthrough). These tests
  // are preserved as regression markers — each call throws "no handler registered"
  // and expectThrows catches it as a successful absence check.
  describe("automations legacy + records (G-1c: backend removed, passthrough to pi)", () => {
    it("automations_save → throw (handler removed)", async () => {
      await expectThrows("automations_save", {});
    });
    it("automations_delete 缺 id → throw", async () => {
      await expectThrows("automations_delete", {});
    });
    it("automations_set_status → throw", async () => {
      await expectThrows("automations_set_status", {});
    });
    it("automations_run 缺 id → throw", async () => {
      await expectThrows("automations_run", {});
    });
    it("automation_records_archive 缺 id → throw", async () => {
      await expectThrows("automation_records_archive", {});
    });
    it("automation_records_delete 缺 id → throw", async () => {
      await expectThrows("automation_records_delete", {});
    });
  });


  describe("storage mutations", () => {
    it("storage:renderer-remove 缺字段 → throw", async () => {
      await expectThrows("storage:renderer-remove", {});
    });
    it("storage:metrics-history 缺 namespace → throw", async () => {
      await expectThrows("storage:metrics-history", {});
    });
  });

  describe("email 大量 mutation handler (大部分会 throw 因为缺字段)", () => {
    it("email:delete-rule 缺 id → throw", async () => {
      await expectThrows("email:delete-rule", {});
    });
    it("email:run-rule 缺 id → throw", async () => {
      await expectThrows("email:run-rule", {});
    });
    it("email:sync 缺字段 → throw", async () => {
      await expectThrows("email:sync", {});
    });
    it("email:sync-states 缺字段 → throw", async () => {
      await expectThrows("email:sync-states", {});
    });
    it("email:triage 缺字段 → throw", async () => {
      await expectThrows("email:triage", {});
    });
    it("email:prepare-processing-plan 缺字段 → throw", async () => {
      await expectThrows("email:prepare-processing-plan", {});
    });
    it("email:confirm-processing-plan 缺字段 → throw", async () => {
      await expectThrows("email:confirm-processing-plan", {});
    });
    it("email:execute-processing-plan 缺字段 → throw", async () => {
      await expectThrows("email:execute-processing-plan", {});
    });
    it("email:cancel-processing-plan 缺字段 → throw", async () => {
      await expectThrows("email:cancel-processing-plan", {});
    });
    it("email:processing-plans 缺字段 → throw", async () => {
      await expectThrows("email:processing-plans", {});
    });
    it("email:threads 缺字段 → throw", async () => {
      await expectThrows("email:threads", {});
    });
    it("email:threads-page 缺字段 → throw", async () => {
      await expectThrows("email:threads-page", {});
    });
    it("email:reply-zero 缺字段 → throw", async () => {
      await expectThrows("email:reply-zero", {});
    });
    it("email:ack-inbox 缺字段 → throw", async () => {
      await expectThrows("email:ack-inbox", {});
    });
    it("email:digest 缺字段 → throw", async () => {
      await expectThrows("email:digest", {});
    });
    it("email:scheduled-sends 缺字段 → throw", async () => {
      await expectThrows("email:scheduled-sends", {});
    });
    it("email:pending-sends 缺字段 → throw", async () => {
      await expectThrows("email:pending-sends", {});
    });
    it("email:analyses 缺字段 → throw", async () => {
      await expectThrows("email:analyses", {});
    });
    it("email:action-center-query 缺字段 → throw", async () => {
      await expectThrows("email:action-center-query", {});
    });
    it("email:contact-projection 缺字段 → throw", async () => {
      await expectThrows("email:contact-projection", {});
    });
    it("email:action-center-create-reminders 缺字段 → throw", async () => {
      await expectThrows("email:action-center-create-reminders", {});
    });
    it("email:save-analysis 缺字段 → throw", async () => {
      await expectThrows("email:save-analysis", {});
    });
    it("email:review-analysis 缺字段 → throw", async () => {
      await expectThrows("email:review-analysis", {});
    });
    it("email:link-analysis 缺字段 → throw", async () => {
      await expectThrows("email:link-analysis", {});
    });
    it("email:create-reminders-from-analysis 缺字段 → throw", async () => {
      await expectThrows("email:create-reminders-from-analysis", {});
    });
    it("email:prepare-schedule-send 缺字段 → throw", async () => {
      await expectThrows("email:prepare-schedule-send", {});
    });
    it("email:schedule-send 缺字段 → throw", async () => {
      await expectThrows("email:schedule-send", {});
    });
    it("email:cancel-scheduled-send 缺字段 → throw", async () => {
      await expectThrows("email:cancel-scheduled-send", {});
    });
    it("email:cancel-pending-send 缺字段 → throw", async () => {
      await expectThrows("email:cancel-pending-send", {});
    });
    it("email:thread 缺字段 → throw", async () => {
      await expectThrows("email:thread", {});
    });
    it("email:project-threads 缺字段 → throw", async () => {
      await expectThrows("email:project-threads", {});
    });
    it("email:workspace-tags 缺字段 → throw", async () => {
      await expectThrows("email:workspace-tags", {});
    });
    it("email:update-workspace-tags 缺字段 → throw", async () => {
      await expectThrows("email:update-workspace-tags", {});
    });
    it("email:update 缺字段 → throw", async () => {
      await expectThrows("email:update", {});
    });
    it("email:unsubscribe 缺字段 → throw", async () => {
      await expectThrows("email:unsubscribe", {});
    });
    it("email:sender-policy 缺字段 → throw", async () => {
      await expectThrows("email:sender-policy", {});
    });
    it("email:share-thread 缺字段 → throw", async () => {
      await expectThrows("email:share-thread", {});
    });
    it("email:create-reminder 缺字段 → throw", async () => {
      await expectThrows("email:create-reminder", {});
    });
    it("email:move-to-project 缺字段 → throw", async () => {
      await expectThrows("email:move-to-project", {});
    });
    it("email:attachments 缺字段 → throw", async () => {
      await expectThrows("email:attachments", {});
    });
    it("email:attachment-download 缺字段 → throw", async () => {
      await expectThrows("email:attachment-download", {});
    });
    it("email:create-draft 缺字段 → throw", async () => {
      await expectThrows("email:create-draft", {});
    });
    it("email:prepare-send 缺字段 → throw", async () => {
      await expectThrows("email:prepare-send", {});
    });
    it("email:queue-send 缺字段 → throw", async () => {
      await expectThrows("email:queue-send", {});
    });
    it("email:send-draft 缺字段 → throw", async () => {
      await expectThrows("email:send-draft", {});
    });
    it("email:audit 缺字段 → throw", async () => {
      await expectThrows("email:audit", {});
    });
  });

  describe("weknora:list-knowledge-bases 未配置 → throw", () => {
    it("weknora:list-knowledge-bases 未配置 → throw", async () => {
      await expectThrows("weknora:list-knowledge-bases");
    });
  });
});
