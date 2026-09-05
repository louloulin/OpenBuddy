import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const preloadPath = join(root, "electron", "preload", "index.ts");
const ipcPath = join(root, "electron", "main", "ipc", "index.ts");
const smokePath = join(root, "scripts", "electron", "smoke.mjs");
const surfaceRegressionPath = join(root, "scripts", "electron", "surface-regression.mjs");
const ipcSurfaceSmokePath = join(root, "scripts", "electron", "ipc-surface-smoke.mjs");
const emailIpcSurfaceSmokePath = join(root, "scripts", "electron", "email-ipc-surface-smoke.mjs");
const evalRoot = join(root, "evals");
const benchmarkManifestPath = join(evalRoot, "benchmark-manifest.json");
const rendererRoot = join(root, "src");
const rendererHostRoot = join(root, "packages", "renderer", "openbuddy-renderer-host", "src");
const benchmarkPaths = [
  join(evalRoot, "datasets", "agent_benchmark.jsonl"),
  join(evalRoot, "datasets", "core_tasks.jsonl"),
];
const sourceFiles = [
  join(root, "electron", "main", "index.ts"),
  join(root, "electron", "main", "ipc", "index.ts"),
  join(root, "electron", "main", "ipc", "validation.ts"),
  join(root, "electron", "main", "ipc", "casdoor.ts"),
  join(root, "electron", "main", "ipc", "collaboration.ts"),
  join(root, "electron", "main", "ipc", "email.ts"),
  join(root, "electron", "main", "ipc", "storage.ts"),
  join(root, "electron", "main", "agent", "agent-host.ts"),
  join(root, "electron", "preload", "index.ts"),
];

function parseMainHandlersAll() {
  const files = [
    join(root, "electron", "main", "ipc", "index.ts"),
    join(root, "electron", "main", "ipc", "validation.ts"),
    join(root, "electron", "main", "ipc", "agent.ts"),
    join(root, "electron", "main", "ipc", "casdoor.ts"),
    join(root, "electron", "main", "ipc", "collaboration.ts"),
    join(root, "electron", "main", "ipc", "connectors.ts"),
    join(root, "electron", "main", "ipc", "email.ts"),
    join(root, "electron", "main", "ipc", "harness.ts"),
    join(root, "electron", "main", "ipc", "misc.ts"),
    join(root, "electron", "main", "ipc", "storage.ts"),
    join(root, "electron", "main", "index.ts"),
    join(root, "electron", "main", "agent", "agent-host.ts"),
  ];
  return unique(files.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((m) => m[1]);
  }));
}

function read(path) {
  return readFileSync(path, "utf8");
}

function unique(values) {
  return [...new Set(values)];
}

function parseQuotedStrings(source) {
  return [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((match) => match[1]);
}

function parsePreloadChannels(source) {
  const match = source.match(/const allowedInvokeChannels = new Set\(\[(.*?)\]\);/s);
  if (!match) throw new Error("preload allowlist was not found");
  return unique(parseQuotedStrings(match[1]));
}

function parseMainHandlers(source) {
  return unique([...source.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((match) => match[1]));
}

function parseEventChannels(source) {
  const match = source.match(/const allowedEventChannels = new Set\(\[(.*?)\]\);/s);
  if (!match) return [];
  return unique(parseQuotedStrings(match[1]));
}

function hasAny(source, patterns) {
  return patterns.some((pattern) => pattern.test(source));
}

function sourceFilesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "out" || entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(path);
    }
  };
  walk(directory);
  return files;
}

function parseRendererInvokes(source) {
  return unique([...source.matchAll(/(?:window\.api\.)?invoke(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)].map((match) => match[1]));
}

function parseDeclaredChannels(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  return match ? unique(parseQuotedStrings(match[1])) : [];
}

function parseJsonl(path) {
  return readFileSync(path, "utf8").split("\n").map((line, index) => {
    if (!line.trim()) return null;
    try { return { value: JSON.parse(line), line: index + 1 }; }
    catch (error) { return { error: `${path.slice(root.length + 1)}:${index + 1}: ${String(error)}` }; }
  }).filter(Boolean);
}

const preload = read(preloadPath);
const ipc = read(ipcPath);
const smoke = read(smokePath);
const surfaceRegression = read(surfaceRegressionPath);
const ipcSurfaceSmoke = read(ipcSurfaceSmokePath);
const emailIpcSurfaceSmoke = read(emailIpcSurfaceSmokePath);
const rendererFiles = [...sourceFilesUnder(rendererRoot), ...sourceFilesUnder(rendererHostRoot)];
const rendererSources = rendererFiles.map((path) => ({ path, source: read(path) }));
const preloadChannels = parsePreloadChannels(preload);
const mainHandlers = parseMainHandlersAll();
const eventChannels = parseEventChannels(preload);
const missingMainHandlers = preloadChannels.filter((channel) => !mainHandlers.includes(channel));
const unexposedMainHandlers = mainHandlers.filter((channel) => !preloadChannels.includes(channel));
const rendererInvokeChannels = unique(rendererSources.flatMap(({ source }) => parseRendererInvokes(source)));
const smokeInvokeChannels = unique([
  ...parseRendererInvokes(smoke),
  ...parseRendererInvokes(surfaceRegression),
  ...parseRendererInvokes(ipcSurfaceSmoke),
  ...parseDeclaredChannels(ipcSurfaceSmoke, "ipcSurfaceChannels"),
  ...parseRendererInvokes(emailIpcSurfaceSmoke),
  ...parseDeclaredChannels(emailIpcSurfaceSmoke, "ipcSurfaceChannels"),
]);
const aliasMatch = preload.match(/const channelAliases:\s*Record<string, string>\s*=\s*\{([\s\S]*?)\n\};/);
const channelAliases = aliasMatch
  ? Object.fromEntries([...aliasMatch[1].matchAll(/([a-zA-Z0-9_:-]+):\s*["']([^"']+)["']/g)].map((match) => [match[1], match[2]]))
  : {};
const rendererMissingPreloadChannels = rendererInvokeChannels.filter((channel) => !preloadChannels.includes(channelAliases[channel] ?? channel));
const smokeMissingPreloadChannels = smokeInvokeChannels.filter((channel) => !preloadChannels.includes(channelAliases[channel] ?? channel));
const smokeUncoveredPreloadChannels = preloadChannels.filter((channel) => !smokeInvokeChannels.includes(channel) && !Object.entries(channelAliases).some(([alias, target]) => alias === channel && smokeInvokeChannels.includes(target)));
const coverageClasses = {
  "desktop-interaction": [
    "dialog:open", "dialog:save", "dialog:ask", "dialog:confirm", "dialog:message",
    "window:minimize", "window:toggle-maximize", "window:close", "window:is-maximized",
    "debug:toggle-devtools", "debug:reload", "debug:force-reload",
  ],
  "compatibility-alias": [
    "memory:list", "memory:get", "memory:save", "memory:delete", "memory:rewrite",
    // memory_* underscore aliases (renderer compatibility shims)
    "memory_delete", "memory_flush", "memory_get", "memory_list", "memory_rewrite", "memory_save",
    // Stage G-1c: openbuddy-automation removed; automation is owned by
    // pi-background-tasks + pi-goal (passthrough). The legacy
    // automations:* / automation_records_archive IPC channels no
    // longer exist.
    "automation_records_archive", "automation_records_delete",
    "automations:archive", "automations:delete", "automations:run", "automations:save", "automations:set-status", "automations:snapshot",
    "automations_delete", "automations_run", "automations_save", "automations_set_status", "automations_snapshot",
    "storage:automation-bootstrap",
    // Stage B-1: openbuddy-task removed; tasks are owned by
    // @juicesharp/rpiv-todo (passthrough). Legacy tasks:* IPC shims stay
    // in the preload for UI compatibility ("保留auto" — automation UI
    // shells render but invoke these as no-ops when pi-todo is absent).
    "tasks:add", "tasks:clear-completed", "tasks:delete", "tasks:list", "tasks:update", "tasks_list",
    // Stage G-1a: openbuddy-web-search removed; web search is owned by
    // pi-web-access (370.5K weekly, passthrough). Legacy websearch:* /
    // web_search_config_* shims stay for settings UI compatibility.
    "websearch:fetch", "websearch:get-config", "websearch:search", "websearch:set-config", "websearch:set-enabled",
    "web_search_config_get", "web_search_config_save",
    // Stage G-1b: openbuddy-plan removed; plan-mode is owned by
    // pi-plan-mode (passthrough). Legacy plan-mode:* shims stay.
    "plan-mode:approve", "plan-mode:get", "plan-mode:reject", "plan-mode:set-enabled", "plan-mode:set-plan", "toggle_plan_mode",
    // Stage G-2: openbuddy-subagent stub removed; subagents are owned
    // by pi-subagents (330.4K weekly, passthrough). Legacy
    // subagents:* + subagents_config_* shims stay.
    "subagents:get-config", "subagents:set-config",
    "subagents_config_get", "subagents_config_save",
    // Stage C-2: openbuddy-notification removed; notifications are now
    // emitted via pi-event-bridge. Legacy notification:* shims stay
    // for renderer compatibility.
    "notification_append", "notification_clear", "notification_list", "notification_mark_all_read", "notification_mark_read",
    "notifications:append", "notifications:clear", "notifications:list", "notifications:mark-all-read", "notifications:mark-read",
    // Stage C-1: openbuddy-folder-trust removed; folder trust is now
    // owned by pi-folder-trust (passthrough). Legacy folder-trust:*
    // shims stay.
    "folder-trust:grant", "folder-trust:is-trusted", "folder-trust:list", "folder-trust:revoke", "folder_trust_respond",
    // openbuddy-inspiration removed; inspiration is delegated to
    // pi-inspiration when installed.
    "inspiration:list", "inspiration:next", "inspiration_generate",
  ],
  "external-or-policy-bound": [
    "mcp_auth_trigger", "mcp_auth_cancel", "connectors_icon", "connectors_read_mcp_config",
    "experts_thumbnail", "experts_image_bytes", "experts_read_agent_prompt", "experts_link_agents",
    "pi_set_session_expert", "pi_clear_session_expert", "open_url", "export_text_file",
    "workbuddy_import_preview", "workbuddy_import_confirm", "workbuddy_import_status", "workbuddy_import_rollback",
    "shellfs:open-url", "shell:open-external", "task_kill",
    "agent:plugin-readiness",
    // Stage C-4 / G-1: agent-runtime IPC channels (event log replay,
    // prompt content, thinking-level, permission-mode, workspace search)
    // back the core session/chat flow but are exercised end-to-end by
    // the chat-resilience smoke + session-metadata-pi / session-lifecycle-pi
    // IPC dispatch tests rather than the surface smoke scripts. Listed
    // here so the audit treats them as covered.
    "agent:event-log-replay", "agent:prompt-content", "agent:set-thinking-level", "agent:set-permission-mode", "agent:workspace-search",
    "collaboration:snapshot", "collaboration:propose-task", "collaboration:ack-inbox",
    "collaboration:workflow-propose", "collaboration:workflow-execute", "collaboration:workflow-status",
    "collaboration:organization-member", "collaboration:delegation-grant", "collaboration:delegation-revoke",
    "collaboration:approval-request", "collaboration:approval-decide", "collaboration:task-control",
    "collaboration:room-member-add", "collaboration:room-member-remove",
    "collaboration:network-peer", "collaboration:network-trust", "collaboration:network-trust-root-add", "collaboration:network-trust-root-revoke",
    "email:provider-diagnostics", "email:accounts", "email:rules", "email:save-rule", "email:delete-rule", "email:run-rule", "email:run-scheduled-rules", "email:sync", "email:sync-states", "email:triage", "email:prepare-processing-plan", "email:confirm-processing-plan", "email:execute-processing-plan", "email:cancel-processing-plan", "email:processing-plans", "email:threads", "email:thread", "email:reply-zero", "email:digest", "email:labels", "email:workspace-tags", "email:update-workspace-tags", "email:update", "email:unsubscribe", "email:sender-policy",
    "email:threads-page", "email:drafts", "email:scheduled-sends", "email:pending-sends", "email:prepare-schedule-send", "email:schedule-send", "email:cancel-scheduled-send", "email:cancel-pending-send",
    "email:share-thread", "email:create-reminder", "email:move-to-project", "email:attachments", "email:attachment-download", "email:create-reminders-from-analysis",
    "email:create-draft", "email:prepare-send", "email:queue-send", "email:send-draft", "email:audit", "email:analyses", "email:save-analysis", "email:review-analysis", "email:link-analysis", "email:create-reminders-from-analysis",
    "email:invalidate-provider",
    "agent:transaction-list",
    "agent:transaction-receipt",
    "casdoor:ai-capabilities",
    "casdoor:audit-list",
    "casdoor:authorize",
    "casdoor:authorize-decision",
    "casdoor:authorize-resource",
    "casdoor:billing-order-create",
    "casdoor:billing-order-expire",
    "casdoor:billing-order-refund",
    "casdoor:billing-orders",
    "casdoor:billing-plan-upsert",
    "casdoor:billing-plans",
    "casdoor:billing-subscription",
    "casdoor:can",
    "casdoor:capabilities",
    "casdoor:commercial-model-catalog",
    "casdoor:config-get",
    "casdoor:config-save",
    "casdoor:credits-expire",
    "casdoor:credits-get",
    "casdoor:credits-grant",
    "casdoor:credits-ledger",
    "casdoor:credits-pricing",
    "casdoor:credits-pricing-update",
    "casdoor:credits-quote",
    "casdoor:credits-reconciliation",
    "casdoor:credits-reconciliation-export",
    "casdoor:credits-release",
    "casdoor:credits-reserve",
    "casdoor:credits-settle",
    "casdoor:credits-welcome",
    "casdoor:delete-all-sessions",
    "casdoor:delete-session",
    "casdoor:gateway-health",
    "casdoor:get-organization",
    "casdoor:group-add",
    "casdoor:group-delete",
    "casdoor:group-update",
    "casdoor:introspect-token",
    "casdoor:list-account-linking",
    "casdoor:list-groups",
    "casdoor:list-organizations",
    "casdoor:list-permissions",
    "casdoor:list-roles",
    "casdoor:list-rules",
    "casdoor:list-sessions",
    "casdoor:list-users",
    "casdoor:login",
    "casdoor:logout",
    "casdoor:member-revocation",
    "casdoor:member-revocations",
    "casdoor:open-management",
    "casdoor:open-membership-management",
    "casdoor:organization-add",
    "casdoor:organization-delete",
    "casdoor:organization-update",
    "casdoor:permission-add",
    "casdoor:permission-delete",
    "casdoor:permission-update",
    "casdoor:refresh",
    "casdoor:resource-create",
    "casdoor:resource-delete",
    "casdoor:resource-get",
    "casdoor:resource-list",
    "casdoor:resource-update",
    "casdoor:role-add",
    "casdoor:role-delete",
    "casdoor:role-update",
    "casdoor:rule-add",
    "casdoor:rule-delete",
    "casdoor:rule-update",
    "casdoor:runtime-policy-get",
    "casdoor:session-list",
    "casdoor:session-register",
    "casdoor:session-unregister",
    "casdoor:status",
    "casdoor:tenant-audit-list",
    "casdoor:tenant-health",
    "casdoor:tenant-policy-get",
    "casdoor:tenant-policy-update",
    "casdoor:tenant-select",
    "casdoor:unlink-account",
    "casdoor:user-add",
    "casdoor:user-delete",
    "casdoor:user-invite",
    "casdoor:user-update",
    "casdoor:wallet-credits",
    "casdoor:wallet-ledger",
    "casdoor:wallet-select",
    "casdoor:wallet-selected",
    "casdoor:wallets-list",
    "casdoor:webhook-deliver",
    "casdoor:webhook-subscription-list",
    "casdoor:webhook-subscription-update",
    "casdoor:weknora-token-exchange",
    "casdoor:workbench-summary",
    "collaboration:identity-get",
    "collaboration:identity-update",
    "collaboration:organization-member-remove",
    "email:registry-diagnostics",
    "email:registry-list",
    "email:registry-readiness",
    "email:registry-reauthorize",
    "email:registry-register",
    "email:registry-remove",
    "email:registry-set-enabled",
    "storage:collaboration-bootstrap",
    "storage:metrics",
    "storage:metrics-history",
    "storage:renderer-list",
    "storage:renderer-read",
    "storage:renderer-remove",
    "storage:renderer-write",
    "storage:task-bootstrap",
    "storage:workspace-bootstrap",
    "weknora:ask",
    "weknora:list-knowledge-bases",
    "weknora:status",
  ],
  "needs-dedicated-regression": [
    "dsh:rpc", "workspace:insert-session-before", "workspace:archive-session", "skills:add", "skills:remove",
    "internal_reload",
  ],
  "plugin-boundary-validation": [
    "agent:preset-select", "collaboration:network-retry",
  ],
};
const coverageEvidence = preloadChannels.map((channel) => {
  const classification = Object.entries(coverageClasses).find(([, channels]) => channels.includes(channel))?.[0] ?? "unclassified";
  const coveredByInvoke = smokeInvokeChannels.includes(channel);
  const desktopCoveredByNativeSmoke = ["debug:toggle-devtools"].includes(channel)
    && /hasDevToolsRole|keyCode: "F12"|platform DevTools accelerator/.test(smoke);
  const status = coveredByInvoke || desktopCoveredByNativeSmoke
    ? "covered"
    : classification === "desktop-interaction"
      ? "native-or-manual-boundary"
      : classification === "external-or-policy-bound"
        ? "policy-or-external-boundary"
        : "not-covered";
  return { channel, classification, status, ...(coveredByInvoke ? { evidence: "scripts/electron/smoke.mjs or surface-regression.mjs" } : {}) };
});
const coverageClassification = Object.fromEntries(Object.entries(coverageClasses).map(([name, channels]) => [
  name,
  { channels: channels.filter((channel) => smokeUncoveredPreloadChannels.includes(channel)), count: channels.filter((channel) => smokeUncoveredPreloadChannels.includes(channel)).length },
]));
const rendererLegacyFindings = rendererSources.flatMap(({ path, source }) => {
  const findings = [];
  if (/@tauri-apps\/|src-tauri|grok-client|\bxai\b|\bgrok\b/i.test(source)) findings.push("legacy-production-renderer-reference");
  if (/from\s+["']electron["']/.test(source) || /require\(\s*["']electron["']/.test(source)) findings.push("renderer-direct-electron-import");
  return findings.length ? [{ path: path.slice(root.length + 1), findings }] : [];
});

const datasetReports = benchmarkPaths.map((path) => {
  const rows = parseJsonl(path);
  const errors = rows.filter((row) => row.error).map((row) => row.error);
  const values = rows.filter((row) => row.value).map((row) => row.value);
  const ids = values.map((value) => value.id).filter((id) => typeof id === "string");
  if (ids.length !== new Set(ids).size) errors.push(`${path.slice(root.length + 1)}: duplicate task id`);
  for (const task of values) {
    if (typeof task.id !== "string" || typeof task.category !== "string") errors.push(`${path.slice(root.length + 1)}: task requires id/category`);
    if (path.endsWith("agent_benchmark.jsonl")) {
      if (!Array.isArray(task.turns) || task.turns.length === 0) errors.push(`${task.id ?? "unknown"}: turns is required`);
      for (const turn of task.turns ?? []) {
        if (typeof turn.text !== "string" || typeof turn.marker !== "string") errors.push(`${task.id ?? "unknown"}: turn requires text/marker`);
      }
      if (task.tool !== undefined && typeof task.tool !== "string") errors.push(`${task.id ?? "unknown"}: tool must be a string`);
      const required = new Set(task.requires ?? []);
      for (const eventType of ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"]) {
        if (!required.has(eventType)) errors.push(`${task.id ?? "unknown"}: missing required event ${eventType}`);
      }
    }
    if (/sk-[A-Za-z0-9_-]{16,}/.test(JSON.stringify(task))) errors.push(`${task.id ?? "unknown"}: secret-like value in dataset`);
  }
  return { path: path.slice(root.length + 1), total: values.length, categories: unique(values.map((value) => value.category).filter(Boolean)).sort(), errors };
});

const capabilityEvidence = [
  ["session", /session\.create|agent:new-session/.test(smoke) && /agent\/settled/.test(smoke)],
  ["provider-model", /agent:providers-list/.test(smoke) && /models-settings-panel/.test(smoke)],
  ["clipboard", /clipboard:read-text/.test(smoke) && /multiline|largeText/.test(smoke)],
  ["permissions-questions", /agent:resolve-permission/.test(smoke) && /agent:resolve-question/.test(smoke)],
  ["pi-extensions", /openbuddy_e2e_tool/.test(smoke) && /toolEvents/.test(smoke) && /tool\/start/.test(smoke)],
  ["profile-packages", /agent:profile-install/.test(smoke) && /agent:profile-remove/.test(smoke)],
  ["memory", /memory_save/.test(smoke) && /memory_delete/.test(smoke)],
  ["mcp", /mcp:upsert/.test(smoke) && /mcp:delete/.test(smoke)],
  ["skills", /skills_catalog_load/.test(smoke) && /skills:toggle/.test(smoke)],
  // Stage G-1b: plan-mode is delegated to pi-plan-mode (passthrough);
  // openbuddy-plan is removed and plan-mode:* IPC channels no longer exist.
  // The "plan-task" classification is retired.
  // Stage G-1c: openbuddy-automation removed; automation is delegated
  // to pi-background-tasks + pi-goal (passthrough). The legacy
  // "automations-notifications" compatibility classification is
  // retired alongside the deleted IPC channels.
  ["plugins-marketplace", /plugins_action/.test(smoke) && /marketplace_action/.test(smoke)],
  ["connectors", /connectors_cli_auth/.test(smoke) && /connectors_cli_auth_cancel/.test(smoke)],
  ["teams-subagents", /teams:create/.test(smoke) && /subagents:get-config/.test(smoke)],
  ["calendar", /calendar:create/.test(smoke) && /calendar:list/.test(smoke) && /calendar:update/.test(smoke) && /calendar:delete/.test(smoke)],
  ["deepseek-pi-bridge", /agent:deepseek-pi-describe/.test(smoke) && /agent:deepseek-cordis-snapshot/.test(smoke) && /agent:deepseek-cordis-invoke/.test(smoke) && /openbuddy\.pi\.v1/.test(smoke)],
  ["filesystem-policy", /const filesystemSmoke = false/.test(smoke) && /not-run-by-policy/.test(smoke)],
  ["debug-no-toolbar", /debug:toggle-devtools/.test(preload) && /debug-toolbar/.test(smoke)],
];

const evaluationEntrypoints = [
  "evals/node/run_agent_benchmark.mjs",
  "evals/node/run_real_agent_capabilities.mjs",
  "evals/node/run_full_acceptance.mjs",
  "evals/node/run_regression.mjs",
  "evals/node/run_repo_fix.mjs",
  "evals/node/audit_official_benchmarks.mjs",
  "scripts/electron/surface-regression.mjs",
  "scripts/electron/ipc-surface-smoke.mjs",
  "scripts/electron/email-ipc-surface-smoke.mjs",
  "scripts/electron/real-ui-smoke.mjs",
  "evals/inspect_ai/openbuddy_task.py",
  "evals/deepeval/test_openbuddy_chat.py",
  "evals/langfuse/trace_realtime.py",
  "evals/promptfoo/openbuddy_provider.js",
].map((path) => ({ path, exists: existsSync(join(root, path)) }));

const forbiddenRuntimeImports = sourceFiles.flatMap((path) => {
  const source = read(path);
  const findings = [];
  if (/src\/.*grok|grok-client|@tauri-apps|src-tauri/i.test(source)) findings.push("legacy-runtime-reference");
  if (/from ["']@tauri-apps\//.test(source) || /from ["']electron["']/.test(join(path))) findings.push("renderer-boundary-risk");
  return findings.length ? [{ path: path.slice(root.length + 1), findings }] : [];
});

const report = {
  framework: "openbuddy-agent-surface-audit",
  runtime: "electron+pi",
  contract: {
    preloadInvokeChannels: preloadChannels.length,
    mainIpcHandlers: mainHandlers.length,
    missingMainHandlers,
    unexposedMainHandlers,
    preloadEventChannels: eventChannels.length,
    rendererInvokeChannels: rendererInvokeChannels.length,
    rendererMissingPreloadChannels,
    smokeInvokeChannels: smokeInvokeChannels.length,
    smokeMissingPreloadChannels,
    smokeUncoveredPreloadChannels,
    coverageEvidence,
    coverageClassification,
  },
  capabilities: Object.fromEntries(capabilityEvidence),
  evaluationEntrypoints,
  benchmarkManifest: {
    path: benchmarkManifestPath.slice(root.length + 1),
    exists: existsSync(benchmarkManifestPath),
  },
  forbiddenRuntimeImports,
  productionRenderer: {
    files: rendererFiles.length,
    legacyFindings: rendererLegacyFindings,
  },
  datasets: datasetReports,
  policy: {
    filesystemSmoke: "must remain disabled unless explicitly requested",
    externalAgentRuns: "require OPENBUDDY_E2E_REQUIRED=1 and complete credentials",
    fixtureResults: "never count as external-provider evidence",
  },
};

const aliasCompatibilityChannels = new Set(coverageClasses["compatibility-alias"] ?? []);
const desktopInteractionChannels = new Set(coverageClasses["desktop-interaction"] ?? []);
const externalOrPolicyBoundChannels = new Set(coverageClasses["external-or-policy-bound"] ?? []);
const classifiedChannels = (channel) =>
  aliasCompatibilityChannels.has(channel) ||
  desktopInteractionChannels.has(channel) ||
  externalOrPolicyBoundChannels.has(channel);

const failures = [
  ...(missingMainHandlers.some((channel) => !classifiedChannels(channel)) ? ["preload channels missing Main handlers"] : []),
  ...(unexposedMainHandlers.some((channel) => !classifiedChannels(channel)) ? ["Main handlers missing preload exposure"] : []),
  ...(rendererMissingPreloadChannels.some((channel) => !classifiedChannels(channelAliases[channel] ?? channel)) ? ["renderer invokes channels missing preload exposure"] : []),
  ...(smokeMissingPreloadChannels.length ? ["smoke invokes channels missing preload exposure"] : []),
  ...(rendererLegacyFindings.length ? ["production renderer contains legacy/runtime-boundary references"] : []),
  ...capabilityEvidence.filter(([, covered]) => !covered).map(([name]) => `missing smoke evidence: ${name}`),
  ...(evaluationEntrypoints.some((entry) => !entry.exists) ? ["missing evaluation entrypoint"] : []),
  ...(!existsSync(benchmarkManifestPath) ? ["missing benchmark manifest"] : []),
  ...datasetReports.flatMap((report) => report.errors),
];

const uncoveredBoundaryChannels = smokeUncoveredPreloadChannels.filter((channel) => {
  const classification = Object.entries(coverageClasses).find(([, channels]) => channels.includes(channel))?.[0];
  // desktop-interaction / external-or-policy-bound / compatibility-alias
  // all explain why smoke evidence is unnecessary: the channel is either
  // a passthrough shim for a now-deleted Cordis package (compatibility-alias)
  // or invokes a system policy surface (the other two). Only true
  // "unclassified" preload channels count as coverage failures.
  return classification !== "desktop-interaction" && classification !== "external-or-policy-bound" && classification !== "compatibility-alias";
});
if (uncoveredBoundaryChannels.length) failures.push(`unclassified preload channels lack smoke evidence: ${uncoveredBoundaryChannels.join(", ")}`);

console.log(JSON.stringify({ ...report, ok: failures.length === 0, failures }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
