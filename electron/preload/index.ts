/**
 * OpenBuddy Pi — preload script.
 *
 * Exposes a narrow `window.api` surface to the renderer via contextBridge.
 * The bridge is the only renderer-to-main boundary. Every exposed command is
 * allowlisted and implemented by `electron/main/ipc.ts`.
 */
import { contextBridge, ipcRenderer } from "electron";

const allowedInvokeChannels = new Set([
  // agent-runtime
  "agent:abort", "agent:auth-status", "agent:commands-list", "agent:current-model", "agent:deepseek-cordis-invoke", "agent:deepseek-cordis-snapshot", "agent:deepseek-pi-describe", "agent:dispose",
  "agent:event-log", "agent:event-log-replay", "agent:extensions-reload", "agent:follow-up", "agent:init", "agent:ensure-new-session", "agent:load-session", "agent:new-session", "agent:plugin-config", "agent:plugin-enable",
  "agent:plugin-events", "agent:plugin-inventory", "agent:plugin-list", "agent:plugin-readiness", "agent:plugin-reload", "agent:plugin-snapshot", "agent:plugin-state-get", "agent:plugin-state-reset",
  "agent:preset-current", "agent:preset-default-save", "agent:preset-select", "agent:presets-list", "agent:profile-install", "agent:profile-install-default-pi", "agent:profile-packages", "agent:profile-remove", "agent:prompt",
  "agent:providers-delete-model", "agent:providers-delete-provider", "agent:providers-fetch-models", "agent:providers-list", "agent:providers-save-model", "agent:providers-save-provider", "agent:remote-contributions", "agent:renderer-plugin-boot",
  "agent:renderer-plugin-entries", "agent:renderer-plugin-module", "agent:resolve-permission", "agent:resolve-question", "agent:resource-inventory", "agent:session-messages", "agent:session-info", "agent:session-metadata-clear", "agent:session-usage", "agent:tools-list",
  "agent:prompt-content", "agent:set-thinking-level", "agent:set-permission-mode", "agent:workspace-search",
  "agent:set-model", "agent:steer", "agent:transaction-list", "agent:transaction-receipt", "agents_defaults_get", "agents_defaults_save", "agents_delete", "agents_get",
  "agents_list", "agents_save", "agents_template", "dsh:remote", "dsh:remote-register", "dsh:remote-unregister", "dsh:rpc", "harness:address",
  "harness:recovery-claim", "harness:recovery-list", "harness:recovery-resolve", "harness:recovery-status", "harness:resume-token", "harness:resume-token-set", "harness:session-cursors", "harness:session-cursors-set",
  // casdoor
  "casdoor:ai-capabilities", "casdoor:audit-list", "casdoor:authorize", "casdoor:authorize-decision", "casdoor:authorize-resource", "casdoor:billing-order-create", "casdoor:billing-order-expire", "casdoor:billing-order-refund",
  "casdoor:billing-orders", "casdoor:billing-plan-upsert", "casdoor:billing-plans", "casdoor:billing-subscription", "casdoor:can", "casdoor:capabilities", "casdoor:commercial-model-catalog", "casdoor:config-get",
  "casdoor:config-save", "casdoor:credits-expire", "casdoor:credits-get", "casdoor:credits-grant", "casdoor:credits-ledger", "casdoor:credits-pricing", "casdoor:credits-pricing-update", "casdoor:credits-quote",
  "casdoor:credits-reconciliation", "casdoor:credits-reconciliation-export", "casdoor:credits-release", "casdoor:credits-reserve", "casdoor:credits-settle", "casdoor:credits-welcome", "casdoor:delete-all-sessions", "casdoor:delete-session",
  "casdoor:gateway-health", "casdoor:get-organization", "casdoor:group-add", "casdoor:group-delete", "casdoor:group-update", "casdoor:introspect-token", "casdoor:list-account-linking", "casdoor:list-groups",
  "casdoor:list-organizations", "casdoor:list-permissions", "casdoor:list-roles", "casdoor:list-rules", "casdoor:list-sessions", "casdoor:list-users", "casdoor:login", "casdoor:logout",
  "casdoor:member-revocation", "casdoor:member-revocations", "casdoor:open-management", "casdoor:open-membership-management", "casdoor:organization-add", "casdoor:organization-delete", "casdoor:organization-update", "casdoor:permission-add",
  "casdoor:permission-delete", "casdoor:permission-update", "casdoor:refresh", "casdoor:resource-create", "casdoor:resource-delete", "casdoor:resource-get", "casdoor:resource-list", "casdoor:resource-update",
  "casdoor:role-add", "casdoor:role-delete", "casdoor:role-update", "casdoor:rule-add", "casdoor:rule-delete", "casdoor:rule-update", "casdoor:runtime-policy-get", "casdoor:session-list",
  "casdoor:session-register", "casdoor:session-unregister", "casdoor:status", "casdoor:tenant-audit-list", "casdoor:tenant-health", "casdoor:tenant-policy-get", "casdoor:tenant-policy-update", "casdoor:tenant-select",
  "casdoor:unlink-account", "casdoor:user-add", "casdoor:user-delete", "casdoor:user-invite", "casdoor:user-update", "casdoor:wallet-credits", "casdoor:wallet-ledger", "casdoor:wallet-select",
  "casdoor:wallet-selected", "casdoor:wallets-list", "casdoor:webhook-deliver", "casdoor:webhook-subscription-list", "casdoor:webhook-subscription-update", "casdoor:weknora-token-exchange", "casdoor:workbench-summary",
  // collaboration
  "collaboration:a2a-agent-card", "collaboration:a2a-task-get", "collaboration:a2a-task-submit", "collaboration:ack-inbox", "collaboration:approval-decide", "collaboration:approval-request", "collaboration:delegation-grant", "collaboration:delegation-revoke",
  "collaboration:execute", "collaboration:federated-grant-issue", "collaboration:federated-grant-revoke", "collaboration:federated-grants", "collaboration:identity-get", "collaboration:identity-update", "collaboration:network-agreement-revoke", "collaboration:network-award",
  "collaboration:network-bid", "collaboration:network-negotiate", "collaboration:network-offer", "collaboration:network-peer", "collaboration:network-proposal", "collaboration:network-retry", "collaboration:network-trust", "collaboration:network-trust-root-add",
  "collaboration:network-trust-root-revoke", "collaboration:organization-member", "collaboration:organization-member-remove", "collaboration:propose", "collaboration:propose-task", "collaboration:room-member-add", "collaboration:room-member-remove", "collaboration:side-effect-approve",
  "collaboration:side-effect-cancel", "collaboration:side-effect-complete", "collaboration:side-effect-create", "collaboration:snapshot", "collaboration:task-control", "collaboration:workflow-control", "collaboration:workflow-execute", "collaboration:workflow-propose",
  "collaboration:workflow-status",
  // session
  "prompt_history", "rewind_execute", "rewind_points", "session_fork", "session_search", "sessions:delete", "sessions:list", "sessions:list-workspaces",
  "sessions:rename", "sessions:set-all-archived", "sessions:set-archived", "sessions:set-expert", "sessions:set-pinned", "workspace:archive-session", "workspace:create", "workspace:delete", "workspace:insert-before",
  "workspace:insert-session-before", "workspace:list", "workspace:rename",
  // permissions-memory
  "folder-trust:grant", "folder-trust:is-trusted", "folder-trust:list", "folder-trust:revoke", "folder_trust_respond", "mcp:config-path", "mcp:config-read", "mcp:config-save",
  "mcp:delete", "mcp:list", "mcp:status", "mcp:toggle", "mcp:upsert", "memory:delete", "memory:get", "memory:list",
  "memory:rewrite", "memory:save", "memory_delete", "memory_flush", "memory_get", "memory_list", "memory_rewrite", "memory_save",
  "permission:list", "permission:mode-get", "permission:mode-set", "permission:save", "permission_list", "permission_save", "storage:automation-bootstrap", "storage:collaboration-bootstrap", "storage:metrics", "storage:metrics-history",
  "storage:renderer-list", "storage:renderer-read", "storage:renderer-remove", "storage:renderer-write",
  "storage:task-bootstrap", "storage:workspace-bootstrap", "subagents:get-config", "subagents:set-config", "subagents_config_get", "subagents_config_save", "toggle_plan_mode", "web_search_config_get",
  "web_search_config_save", "websearch:fetch", "websearch:get-config", "websearch:search", "websearch:set-config", "websearch:set-enabled",
  "weknora:ask", "weknora:list-knowledge-bases", "weknora:status",
  // skills
  "skills:add", "skills:list", "skills:remove", "skills:toggle",
  // task-policy
  "calendar:create", "calendar:delete", "calendar:list", "calendar:update", "knowledge-sources:list", "knowledge-sources:save", "notify-channels:list", "notify-channels:save",
  "notify:dispatch", "plan-mode:approve", "plan-mode:get", "plan-mode:reject", "plan-mode:set-enabled", "plan-mode:set-plan", "policy:get", "policy:save",
  "storage-sources:list", "storage-sources:save", "task_kill", "tasks:add", "tasks:clear-completed", "tasks:delete", "tasks:list", "tasks:update",
  "teams:create", "teams:delete", "teams:status",
  // automations-notifications
  "automation_records_archive", "automation_records_delete", "automations:archive", "automations:delete", "automations:run", "automations:save", "automations:set-status", "automations:snapshot",
  "automations_delete", "automations_run", "automations_save", "automations_set_status", "automations_snapshot", "inspiration:list", "inspiration:next", "inspiration_generate",
  "notification_append", "notification_clear", "notification_list", "notification_mark_all_read", "notification_mark_read", "notifications:append", "notifications:clear", "notifications:list",
  "notifications:mark-all-read", "notifications:mark-read",
  // plugins-experts
  "connectors_cli_auth", "connectors_cli_auth_cancel", "connectors_cli_skills_dir", "connectors_cli_status", "connectors_cli_unauth", "connectors_default_root", "connectors_icon", "connectors_list_roots",
  "connectors_load", "connectors_read_mcp_config", "experts_default_root", "experts_image_bytes", "experts_link_agents", "experts_list_roots", "experts_load", "experts_read_agent_prompt",
  "experts_thumbnail", "marketplace_action", "marketplace_list", "pi_clear_session_expert", "pi_set_session_expert", "plugins_action", "plugins_list",
  // filesystem-shell
  "export_text_file", "list_dir", "open_url", "shell:open-external", "shellfs:browse-directory", "shellfs:export-text", "shellfs:import-file", "shellfs:list-dir",
  "shellfs:mkdir", "shellfs:open-path", "shellfs:open-url", "shellfs:read-file-base64", "shellfs:read-text", "shellfs:remove", "shellfs:reveal", "shellfs:stat",
  "shellfs:write-text",
  // ui-window
  "clipboard:read-text", "clipboard:write-text", "debug:force-reload", "debug:info", "debug:reload", "debug:toggle-devtools", "dialog:ask", "dialog:confirm",
  "dialog:message", "dialog:open", "dialog:save", "internal_reload", "window:close", "window:is-maximized", "window:minimize", "window:toggle-maximize",
  // email
  "email:accounts", "email:ack-inbox", "email:action-center-create-reminders", "email:action-center-query", "email:analyses", "email:attachment-download", "email:attachments", "email:audit",
  "email:cancel-pending-send", "email:cancel-processing-plan", "email:cancel-scheduled-send", "email:confirm-processing-plan", "email:contact-projection", "email:create-draft", "email:create-reminder", "email:create-reminders-from-analysis",
  "email:delete-rule", "email:digest", "email:drafts", "email:execute-processing-plan", "email:labels", "email:link-analysis", "email:move-to-project", "email:pending-sends",
  "email:prepare-processing-plan", "email:prepare-schedule-send", "email:prepare-send", "email:processing-plans", "email:project-threads", "email:provider-diagnostics", "email:queue-send", "email:registry-diagnostics",
  "email:registry-list", "email:registry-readiness", "email:registry-reauthorize", "email:registry-register", "email:registry-remove", "email:registry-set-enabled", "email:reply-zero", "email:review-analysis",
  "email:rules", "email:run-rule", "email:run-scheduled-rules", "email:save-analysis", "email:save-rule", "email:schedule-send", "email:scheduled-sends", "email:send-draft",
  "email:sender-policy", "email:share-thread", "email:sync", "email:sync-states", "email:thread", "email:threads", "email:threads-page", "email:triage",
  "email:unsubscribe", "email:update", "email:update-workspace-tags", "email:workspace-tags",
  "email:invalidate-provider",
  // workbuddy
  "workbuddy_import_confirm", "workbuddy_import_preview", "workbuddy_import_rollback", "workbuddy_import_status",
  // other
  "mcp_auth_cancel", "mcp_auth_status", "mcp_auth_trigger", "skills_catalog_default_root", "skills_catalog_list_roots", "skills_catalog_load", "skills_catalog_read_skill", "tasks_list",
]);

const channelAliases: Record<string, string> = {
  open_url: "shell:open-external",
  open_path: "shellfs:open-path",
  reveal_in_folder: "shellfs:reveal",
  browse_directory: "shellfs:browse-directory",
  list_dir: "shellfs:list-dir",
  path_stat: "shellfs:stat",
  read_text_file: "shellfs:read-text",
  write_text_file: "shellfs:write-text",
  export_text_file: "shellfs:export-text",
};

const allowedEventChannels = new Set([
  "connector://cli-auth-url",
  "connector://cli-auth-log",
  "connector://cli-auth-done",
  "openbuddy://window-resized",
  "openbuddy://agent-event",
  "openbuddy://plugin-event",
  "openbuddy://collaboration-update",
  "dsh://rpc",
  "pi://event",
  "pi://update",
  "pi://complete",
  "pi://error",
  "pi://notification",
  "pi://permission",
  "pi://question",
  "pi://summary",
  "pi://turn-error",
  "pi://telemetry",
  "pi://mcp-status",
  "pi://folder-trust",
  "pi://plan-mode",
  "pi://permission-mode",
  "pi://task-update",
  "pi://models-update",
  "pi://thinking-level-update",
  "pi://agent-died",
  "pi://subagent",
  "pi://extension-ui",
  "casdoor://auth",
  "casdoor://lifecycle",
  "openbuddy://workbench-scope",
  "casdoor://member-revocation",
  "casdoor://casdoor-webhook",
]);

// Threshold for real bridge failures. A business error from an
// `ipcMain.handle` (e.g. "Pi session not found", "invalid sessionId",
// "MCP server not found") is *expected* control flow and MUST NOT
// poison the bridge. Only repeat real-bridge errors (main process gone,
// IPC channel missing, webContents destroyed) trip the threshold.
const BRIDGE_FAILURE_THRESHOLD = 3;

const bridgeHealth = {
  available: true,
  consecutiveFailures: 0,
  lastError: null as Error | null,
  lastUpdated: Date.now(),
};

// Bug fix (R7 / chat-session audit): previous version marked the bridge
// unavailable on the FIRST error regardless of cause, so a single
// misclick on a missing session permanently killed all subsequent IPC
// until the renderer reloaded. The new rules:
//   - any error increments `consecutiveFailures` and stores lastError
//   - `available` flips to false ONLY when the error is a real bridge
//     failure (per `isElectronBridgeUnavailable`) AND we have hit the
//     threshold; business errors are tracked but do not poison.
//   - a single successful `invoke` (any channel) recovers the bridge.
function recordBridgeFailure(error: unknown): { available: boolean; lastError: Error | null; poisoned: boolean } {
  bridgeHealth.consecutiveFailures += 1;
  bridgeHealth.lastError = error instanceof Error ? error : new Error(String(error));
  bridgeHealth.lastUpdated = Date.now();
  const poisoned = isElectronBridgeUnavailable(error) && bridgeHealth.consecutiveFailures >= BRIDGE_FAILURE_THRESHOLD;
  if (poisoned) {
    bridgeHealth.available = false;
  }
  return { available: bridgeHealth.available, lastError: bridgeHealth.lastError, poisoned };
}

function recordBridgeSuccess(): void {
  if (bridgeHealth.consecutiveFailures === 0 && bridgeHealth.available) return;
  bridgeHealth.consecutiveFailures = 0;
  bridgeHealth.lastError = null;
  bridgeHealth.lastUpdated = Date.now();
  bridgeHealth.available = true;
}

function isElectronBridgeUnavailable(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  // Electron throws "Error: An object could not be cloned." or "IPC channel is empty"
  // when the main process is gone; "No handler registered for ..." when preload
  // loads before main is ready; "Cannot read properties of null (reading 'send')"
  // when webContents are gone.
  return /An object could not be cloned|could not be cloned|No handler registered|IPC channel is empty|preload script/i.test(message);
}

const api = {
	apiVersion: 1 as const,

  getElectronBridgeStatus: () => ({
    available: bridgeHealth.available,
    consecutiveFailures: bridgeHealth.consecutiveFailures,
    lastErrorMessage: bridgeHealth.lastError?.message ?? null,
    lastUpdated: bridgeHealth.lastUpdated,
  }),
  isElectronBridgeUnavailable: (error: unknown) => isElectronBridgeUnavailable(error),

  listenSafe: (channel: string, handler: (payload: unknown) => void) => {
    let active = true;
    const wrapped = (_event: unknown, payload: unknown) => {
      if (!active) return;
      try {
        handler(payload);
      } catch (error) {
        recordBridgeFailure(error);
        // Swallow handler errors so a misbehaving subscriber can't tear down the IPC channel.
      }
    };
    try {
      ipcRenderer.on(channel, wrapped);
    } catch (error) {
      recordBridgeFailure(error);
      return () => undefined;
    }
    return () => {
      active = false;
      try { ipcRenderer.off(channel, wrapped); } catch { /* best-effort */ }
    };
  },
  invoke: (channel: string, args?: unknown) => {
		const normalized = channelAliases[channel] ?? channel;
		if (!allowedInvokeChannels.has(normalized)) {
			return Promise.reject(new Error(`invalid IPC channel: ${channel}`));
		}
		if (!bridgeHealth.available) {
			return Promise.reject(new Error(`electron bridge unavailable: ${bridgeHealth.lastError?.message ?? "unknown"}`));
		}
		const pending = ipcRenderer.invoke(normalized, args);
		pending.then(
			() => recordBridgeSuccess(),
			(error: unknown) => {
				// Only rewrap as "bridge unavailable" when the bridge is
				// actually dead (per isElectronBridgeUnavailable). Business
				// errors from ipcMain handlers must propagate as-is so the
				// renderer can show them to the user without poisoning the
				// bridge.
				recordBridgeFailure(error);
				if (isElectronBridgeUnavailable(error)) {
					const wrapped = new Error(`electron bridge unavailable: ${error instanceof Error ? error.message : String(error)}`);
					(wrapped as Error & { code?: string }).code = "ELECTRON_BRIDGE_UNAVAILABLE";
					return Promise.reject(wrapped);
				}
			},
		);
		return pending;
	},
  rpc: {
    request: (message: unknown) => ipcRenderer.invoke("dsh:rpc", message),
    onMessage: (handler: (message: unknown) => void) => {
      const wrapped = (_event: unknown, message: unknown) => handler(message);
      ipcRenderer.on("dsh://rpc", wrapped);
      return () => ipcRenderer.off("dsh://rpc", wrapped);
    },
  },
  harness: {
    address: () => ipcRenderer.invoke("harness:address"),
    loadSessionCursors: () => ipcRenderer.invoke("harness:session-cursors"),
    saveSessionCursors: (cursor: unknown) => ipcRenderer.invoke("harness:session-cursors-set", cursor),
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  shell: {
    openExternal(url: string) {
      return ipcRenderer.invoke("shell:open-external", url);
    },
  },

  clipboard: {
    readText: () => ipcRenderer.invoke("clipboard:read-text"),
    writeText: (text: string) => ipcRenderer.invoke("clipboard:write-text", text),
  },

  dialog: {
    open: (options?: unknown) => ipcRenderer.invoke("dialog:open", options),
    save: (options?: unknown) => ipcRenderer.invoke("dialog:save", options),
    ask: (options: { message: string; title?: string; okLabel?: string; cancelLabel?: string }) => ipcRenderer.invoke("dialog:ask", options),
    confirm: (options: { message: string }) => ipcRenderer.invoke("dialog:confirm", options),
    message: (options: { message: string }) => ipcRenderer.invoke("dialog:message", options),
  },

  window: {
    label: () => "main",
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onResized: async (handler: () => void | Promise<void>) => {
      const wrapped = () => { void handler(); };
      ipcRenderer.on("openbuddy://window-resized", wrapped);
      return () => ipcRenderer.off("openbuddy://window-resized", wrapped);
    },
  },

  webview: {
    label: () => "main",
    onDragDropEvent: async (handler: (event: { payload: unknown }) => void) => {
      const wrapped = (event: DragEvent) => {
        const paths = Array.from(event.dataTransfer?.files ?? [])
          .map((file) => (file as File & { path?: string }).path)
          .filter((path): path is string => Boolean(path));
        handler({ payload: { type: event.type, paths } });
      };
      for (const type of ["dragenter", "dragover", "dragleave", "drop"] as const) {
        document.addEventListener(type, wrapped, true);
      }
      return () => {
        for (const type of ["dragenter", "dragover", "dragleave", "drop"] as const) {
          document.removeEventListener(type, wrapped, true);
        }
      };
    },
  },

  debug: {
    enabled: process.env.OPENBUDDY_DEBUG_UI !== "0",
    toggleDevTools: () => ipcRenderer.invoke("debug:toggle-devtools"),
    reload: () => ipcRenderer.invoke("debug:reload"),
    forceReload: () => ipcRenderer.invoke("debug:force-reload"),
    info: () => ipcRenderer.invoke("debug:info"),
  },

  events: {
    onBridgeStatusChange: (handler: (status: { available: boolean; lastErrorMessage: string | null }) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => {
        try { handler(payload as { available: boolean; lastErrorMessage: string | null }); }
        catch { /* swallow */ }
      }
      ipcRenderer.on("electron-bridge-status", wrapped);
      return () => ipcRenderer.off("electron-bridge-status", wrapped);
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      if (!allowedEventChannels.has(channel)) {
        return () => undefined;
      }
      let active = true;
      const wrapped = (_event: unknown, payload: unknown) => {
        if (!active) return;
        try {
          handler(payload);
        } catch (error) {
          recordBridgeFailure(error);
        }
      };
      try {
        ipcRenderer.on(channel, wrapped);
      } catch (error) {
        recordBridgeFailure(error);
        return () => undefined;
      }
      return () => {
        active = false;
        try { ipcRenderer.off(channel, wrapped); } catch { /* best-effort */ }
      };
    },
  },

  agent: {
    init: (cwd?: string, options?: { traceId?: string }) => ipcRenderer.invoke("agent:init", cwd === undefined ? undefined : { cwd, ...(options?.traceId ? { traceId: options.traceId } : {}) }),
    dispose: () => ipcRenderer.invoke("agent:dispose"),
    newSession: (cwd?: string, modelId?: string) => ipcRenderer.invoke("agent:new-session", cwd === undefined && modelId === undefined ? undefined : { ...(cwd !== undefined ? { cwd } : {}), ...(modelId !== undefined ? { modelId } : {}) }),
    prompt: (text: string, sessionId?: string, options?: { traceId?: string }) => {
      const base = sessionId ? { sessionId, text } : { text };
      const payload = options?.traceId ? { ...base, traceId: options.traceId } : base;
      return ipcRenderer.invoke("agent:prompt", payload);
    },
    steer: (text: string, sessionId?: string, options?: { traceId?: string }) => {
      const base = sessionId ? { sessionId, text } : { text };
      const payload = options?.traceId ? { ...base, traceId: options.traceId } : base;
      return ipcRenderer.invoke("agent:steer", payload);
    },
    followUp: (text: string, sessionId?: string, options?: { traceId?: string }) => {
      const base = sessionId ? { sessionId, text } : { text };
      const payload = options?.traceId ? { ...base, traceId: options.traceId } : base;
      return ipcRenderer.invoke("agent:follow-up", payload);
    },
    abort: (sessionId?: string, options?: { traceId?: string }) => {
      if (!sessionId && !options?.traceId) return ipcRenderer.invoke("agent:abort", undefined);
      const body: Record<string, unknown> = {};
      if (sessionId) body.sessionId = sessionId;
      if (options?.traceId) body.traceId = options.traceId;
      return ipcRenderer.invoke("agent:abort", body);
    },
    currentModel: () => ipcRenderer.invoke("agent:current-model"),
    setModel: (modelId: string, sessionId?: string, options?: { traceId?: string }) => {
      const base = sessionId ? { sessionId, modelId } : { modelId };
      const payload = options?.traceId ? { ...base, traceId: options.traceId } : base;
      return ipcRenderer.invoke("agent:set-model", payload);
    },
    listPlugins: () => ipcRenderer.invoke("agent:plugin-list"),
    toolsList: () => ipcRenderer.invoke("agent:tools-list"),
    pluginInventory: () => ipcRenderer.invoke("agent:plugin-inventory"),
    pluginSnapshot: () => ipcRenderer.invoke("agent:plugin-snapshot"),
    pluginReadiness: () => ipcRenderer.invoke("agent:plugin-readiness"),
    deepSeekCordisSnapshot: () => ipcRenderer.invoke("agent:deepseek-cordis-snapshot"),
    deepSeekPiDescribe: () => ipcRenderer.invoke("agent:deepseek-pi-describe"),
    listPresets: (cwd?: string) => ipcRenderer.invoke("agent:presets-list", cwd),
    currentPreset: () => ipcRenderer.invoke("agent:preset-current"),
    selectPreset: (id: string) => ipcRenderer.invoke("agent:preset-select", { id }),
    savePresetDefault: (id?: string) => ipcRenderer.invoke("agent:preset-default-save", id === undefined ? undefined : { id }),
    deepSeekCordisInvoke: (request: { service: string; method: string; args?: readonly unknown[] | Record<string, unknown>; parameters?: readonly string[] }) => ipcRenderer.invoke("agent:deepseek-cordis-invoke", request),
    pluginEvents: () => ipcRenderer.invoke("agent:plugin-events"),
    eventLog: (query?: { sessionId?: string; sinceSequence?: number; limit?: number }) => ipcRenderer.invoke("agent:event-log", query),
    setPluginEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke("agent:plugin-enable", { id, enabled }),
    reloadPlugin: (id: string) =>
      ipcRenderer.invoke("agent:plugin-reload", { id }),
    updatePluginConfig: (id: string, config: unknown) =>
      ipcRenderer.invoke("agent:plugin-config", { id, config }),
    getStoredPluginState: () => ipcRenderer.invoke("agent:plugin-state-get"),
    resetPluginState: (id: string) =>
      ipcRenderer.invoke("agent:plugin-state-reset", { id }),
    profilePackages: () => ipcRenderer.invoke("agent:profile-packages"),
    installProfilePackage: (source: string) => ipcRenderer.invoke("agent:profile-install", { source }),
    installDefaultPiPackages: (options?: { force?: boolean }) => ipcRenderer.invoke("agent:profile-install-default-pi", options ?? {}),
    removeProfilePackage: (name: string) => ipcRenderer.invoke("agent:profile-remove", { name }),
    rendererPluginEntries: () => ipcRenderer.invoke("agent:renderer-plugin-entries"),
    onEvent: (handler: (event: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => {
        try {
          handler(payload);
        } catch (error) {
          // R6.8 — handler 同步抛错不能让 IPC 通道死亡;否则后续 pi://update
          // 全部丢失,streamingMessageId 永远不归零,Composer 锁死。
          recordBridgeFailure(error);
        }
      };
      ipcRenderer.on("pi://event", wrapped);
      return () => ipcRenderer.off("pi://event", wrapped);
    },
    onAgentEvent: (handler: (event: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => {
        try {
          handler(payload);
        } catch (error) {
          recordBridgeFailure(error);
        }
      };
      ipcRenderer.on("openbuddy://agent-event", wrapped);
      return () => ipcRenderer.off("openbuddy://agent-event", wrapped);
    },
    onPluginEvent: (handler: (event: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => {
        try {
          handler(payload);
        } catch (error) {
          recordBridgeFailure(error);
        }
      };
      ipcRenderer.on("openbuddy://plugin-event", wrapped);
      return () => ipcRenderer.off("openbuddy://plugin-event", wrapped);
    },
    onPiTelemetryEvent: (handler: (event: unknown) => void) => {
      // Pi spans flow from main → renderer so the renderer can funnel them
      // through OpenBuddy's existing `reportEvent(...)` providers. Keep this
      // best-effort: a dropped event must not crash the IPC listener.
      const wrapped = (_event: unknown, payload: unknown) => {
        try {
          handler(payload);
        } catch (error) {
          recordBridgeFailure(error);
        }
      };
      ipcRenderer.on("pi://telemetry", wrapped);
      return () => ipcRenderer.off("pi://telemetry", wrapped);
    },
  },

} as const;

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
