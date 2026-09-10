/**
 * IPC surface — plugin domain.
 *
 * Phase B.1 round 4 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Extracted
 * from `./agent.ts`. Owns all `agent:plugin-*` + `agent:event-log*` +
 * `agent:transaction-*` + `agent:renderer-plugin-*` + `plugins_list` +
 * `plugins_action` handlers.
 *
 * The plugin registry is the largest single capability group in
 * agent.ts (~17 handlers). The split keeps each handler as a thin
 * 1-2 line facade over the agentHost facade.
 *
 * Round 5 added `plugins_action` (the enable/disable/reload mutator
 * for marketplace-installed plugins) which originally lived in
 * `agent.ts` between `agent:dispose` and `sessions:rename`. The
 * handler does a dynamic `await import("../agent/pi-resources/marketplace")`
 * for `setPluginEnabled` to keep the marketplace module out of the
 * cold-start path (matches `plugins_list`).
 */
import { ipcMain } from "electron";

import {
  optionalFiniteInteger,
  recordValue,
  requiredBoolean,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerPluginIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:plugin-list", async () => {
    await ensureAgentHost();
    return agentHost.listPlugins();
  });
  ipcMain.handle("agent:plugin-inventory", async () => {
    await ensureAgentHost();
    return agentHost.pluginInventory();
  });
  ipcMain.handle("agent:pi-native-inventory", async () => {
    // Phase 7.2 of plan3.0.md — single-call aggregation of the 4
    // PI-native surfaces (builtin extensions, user extensions, marketplace
    // packages, skills + agents) for renderer settings tab / health pill.
    await ensureAgentHost();
    return agentHost.listPiNativeInventory();
  });
  ipcMain.handle("agent:tools-list", async () => {
    await ensureAgentHost();
    // Surface every tool the active pi runtime exposes (G-1d
    // compatibilityAdapter tools + built-in pi tools), tagged with
    // source + piPackageHint so the renderer can group / disable
    // them and the user can tell pi-native from openbuddy-styled.
    //
    // Classifier: a tool is "openbuddy" if any of these match —
    //   (a) G-1d adapter naming: `openbuddy_<verb>`
    //   (b) Cordis capability namespace: `calendar_`, `team_`,
    //       `buddy_`, `email_`, `mcp_` (see capability-plugins.ts)
    // Everything else is treated as a pi built-in / extension tool.
    const openbuddyPrefix = /^(openbuddy_|calendar_|team_|buddy_|email_|mcp_)/;
    const tools = agentHost.listTools();
    return tools.map((tool) => {
      const name = tool.name;
      const isOpenbuddyOrigin = openbuddyPrefix.test(name);
      return {
        name,
        label: tool.label,
        description: tool.description,
        source: isOpenbuddyOrigin ? "openbuddy" : "pi",
        piPackageHint: isOpenbuddyOrigin ? null : name,
      };
    });
  });
  ipcMain.handle("agent:plugin-snapshot", async () => {
    await ensureAgentHost();
    return agentHost.pluginSnapshot();
  });
  ipcMain.handle("agent:plugin-readiness", async () => {
    await ensureAgentHost();
    return agentHost.pluginReadiness();
  });
  ipcMain.handle("agent:plugin-events", async () => {
    await ensureAgentHost();
    return agentHost.pluginEvents();
  });
  ipcMain.handle("agent:transaction-receipt", async (_e, args: unknown) => {
    const input = recordValue(args, "transaction-receipt payload");
    const transactionId = requiredString(input.transactionId, "transactionId");
    const surface = requiredString(input.surface, "surface");
    const details = input.details === undefined ? undefined : recordValue(input.details, "details");
    return agentHost.reportActivePluginTransaction(transactionId, surface, details);
  });
  ipcMain.handle("agent:transaction-list", async () => {
    await ensureAgentHost();
    return agentHost.listActivePluginTransactions();
  });
  ipcMain.handle("agent:event-log", async (_e, args?: unknown) => {
    const input = args === undefined || args === null ? {} : recordValue(args, "event log payload");
    return agentHost.pluginEvents({
      ...(input.sessionId === undefined ? {} : { sessionId: requiredString(input.sessionId, "sessionId") }),
      ...(input.sinceSequence === undefined ? {} : { sinceSequence: optionalFiniteInteger(input.sinceSequence, "sinceSequence", 0, 0, Number.MAX_SAFE_INTEGER) }),
      ...(input.limit === undefined ? {} : { limit: optionalFiniteInteger(input.limit, "limit", 2000, 1, 2000) }),
    });
  });
  ipcMain.handle("agent:event-log-replay", async (_e, args?: unknown) => {
    // Cursor-based replay used after bridge recovery. Returns events
    // from `fromSequence` forward so the renderer can rehydrate
    // stores without a full reload. Gated by
    // OPENBUDDY_REPLAY_ON_SUBSCRIBE.
    const input = args === undefined || args === null ? {} : recordValue(args, "event-log-replay payload");
    const sessionId = requiredString(input.sessionId, "sessionId");
    const fromSequence = input.fromSequence === undefined ? 0 : optionalFiniteInteger(input.fromSequence, "fromSequence", 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = input.limit === undefined ? 500 : optionalFiniteInteger(input.limit, "limit", 500, 1, 2000);
    const entries = await agentHost.pluginEvents({ sessionId, sinceSequence: fromSequence, limit });
    return { sessionId, fromSequence, count: Array.isArray(entries) ? entries.length : 0, entries };
  });
  ipcMain.handle("agent:plugin-enable", async (_e, args: { id: string; enabled: boolean }) => {
    const input = recordValue(args, "plugin-enable payload");
    return agentHost.setPluginEnabled(requiredString(input.id, "plugin id"), requiredBoolean(input.enabled, "enabled"));
  });
  ipcMain.handle("agent:plugin-reload", async (_e, args: { id: string }) => {
    return agentHost.reloadPlugin(requiredString(recordValue(args, "plugin-reload payload").id, "plugin id"));
  });
  ipcMain.handle("agent:extensions-reload", async () => agentHost.reloadPiExtensions());
  ipcMain.handle("agent:plugin-config", async (_e, args: { id: string; config: unknown }) => {
    const input = recordValue(args, "plugin-config payload");
    return agentHost.updatePluginConfig(requiredString(input.id, "plugin id"), input.config);
  });
  ipcMain.handle("agent:plugin-state-get", async () => agentHost.getStoredPluginState());
  ipcMain.handle("agent:plugin-state-reset", async (_e, args: { id: string }) => {
    return agentHost.resetPluginState(requiredString(recordValue(args, "plugin-state-reset payload").id, "plugin id"));
  });
  ipcMain.handle("agent:renderer-plugin-entries", async () => {
    await ensureAgentHost();
    return agentHost.listRendererPluginEntries();
  });
  ipcMain.handle("agent:renderer-plugin-boot", async () => {
    await ensureAgentHost();
    return agentHost.rendererPluginBootGraph();
  });
  ipcMain.handle("agent:renderer-plugin-module", async (_e, args: unknown) => {
    await ensureAgentHost();
    return agentHost.resolveRendererPluginModule(requiredString(recordValue(args, "renderer plugin module payload").moduleKey, "moduleKey"));
  });
  ipcMain.handle("agent:remote-contributions", async () => {
    await ensureAgentHost();
    return agentHost.listProfileRemoteContributions();
  });
  ipcMain.handle("plugins_list", async () => {
    // P2-13: listPlugins lives in the heavy marketplace module.
    const { listPlugins } = await import("../agent/pi-resources/marketplace");
    return { plugins: await listPlugins(agentHost.getCwd()) };
  });
  ipcMain.handle("plugins_action", async (_e, args: unknown) => {
    const input = recordValue(args, "plugins action payload");
    const action = recordValue(input.action, "action");
    const pluginName = requiredString(action.pluginName, "pluginName");
    if (action.type === "enable" || action.type === "disable") {
      // P2-13: same lazy-load as plugins_list.
      const { setPluginEnabled } = await import("../agent/pi-resources/marketplace");
      await setPluginEnabled(pluginName, action.type === "enable");
      return agentHost.setPluginEnabled(pluginName, action.type === "enable");
    }
    if (action.type === "reload") return agentHost.reloadPlugin(pluginName);
    throw new Error(`unsupported plugin action: ${action.type ?? "unknown"}`);
  });
}