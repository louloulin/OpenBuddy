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
import { progressSnapshot, cancelProgress, retryProgress } from "../agent/progress-runs";
import { MultiSurfaceSessionRegistry } from "../agent/multi-surface-session";
import { pluginEventLogCursor } from "../agent/plugin-event-log-cursor";




import {
  optionalFiniteInteger,
  recordValue,
  requiredBoolean,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";
import { getNeedsReviewGate } from "../agent/host-modules/needs-review-singleton";
import { summarizeNeedsReviewState } from "../agent/host-modules/needs-review-gate";
import * as resources from "../agent/pi-resources";

export function registerPluginIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;
  const multiSurfaceSessions = new MultiSurfaceSessionRegistry((sessionId, generation) => {
    pluginEventLogCursor.disposeOwner(sessionId);
    return undefined;
  });

  ipcMain.handle("agent:session-surface-acquire", async (_e, args: unknown) => {
    await ensureAgentHost();
    const input = recordValue(args, "session surface acquire payload");
    const lease = multiSurfaceSessions.acquire(requiredString(input.sessionId, "sessionId"), requiredString(input.surfaceId, "surfaceId"));
    if (!lease.ok) return lease;
    return { sessionId: lease.sessionId, surfaceId: lease.surfaceId, generation: lease.generation, shared: (multiSurfaceSessions.snapshot(lease.sessionId)[0]?.refCount ?? 0) > 1 };

  });
  ipcMain.handle("agent:session-surface-release", async (_e, args: unknown) => {
    const input = recordValue(args, "session surface release payload");
    return multiSurfaceSessions.release(
      requiredString(input.sessionId, "sessionId"),
      requiredString(input.surfaceId, "surfaceId"),
      input.generation === undefined ? undefined : optionalFiniteInteger(input.generation, "generation", 0, 0, Number.MAX_SAFE_INTEGER),
      () => {
        pluginEventLogCursor.disposeOwner(requiredString(input.sessionId, "sessionId"));
        return agentHost.dispose();
      },
    );
  });
  ipcMain.handle("agent:session-surface-list", async (_e, args?: unknown) => {
    const input = args === undefined || args === null ? {} : recordValue(args, "session surface list payload");
    return multiSurfaceSessions.snapshot(input.sessionId === undefined ? undefined : requiredString(input.sessionId, "sessionId"));
  });

  ipcMain.handle("progress:list", async () => progressSnapshot());
  ipcMain.handle("progress:cancel", async (_e, args: unknown) => cancelProgress(String((args as { runId?: unknown })?.runId ?? "")));
  ipcMain.handle("progress:retry", async (_e, args: unknown) => retryProgress(String((args as { runId?: unknown })?.runId ?? "")));

  ipcMain.handle("agent:plugin-list", async () => {
    await ensureAgentHost();
    return agentHost.listPlugins();
  });
  ipcMain.handle("agent:plugin-inventory", async () => {
    await ensureAgentHost();
    return agentHost.pluginInventory();
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
  ipcMain.handle("agent:event-log-surface-attach", async (_e, args: unknown) => {
    const input = recordValue(args, "event log surface attach payload");
    return pluginEventLogCursor.attachSurface(requiredString(input.sessionId, "sessionId"), requiredString(input.surfaceId, "surfaceId"));
  });
  ipcMain.handle("agent:event-log-surface-detach", async (_e, args: unknown) => {
    const input = recordValue(args, "event log surface detach payload");
    return pluginEventLogCursor.detachSurface(requiredString(input.sessionId, "sessionId"), requiredString(input.surfaceId, "surfaceId"));
  });

    // Cursor-based replay used after bridge recovery. Returns events
    // from `fromSequence` forward so the renderer can rehydrate
    // stores without a full reload. The `cursor` payload reports
    // the bridge's earliest available sequence + current generation
    // so the renderer can detect ring-buffer evictions and decide
    // whether to fall back to `agent:session-messages`.
    const input = args === undefined || args === null ? {} : recordValue(args, "event-log-replay payload");
    const sessionId = requiredString(input.sessionId, "sessionId");
    const surfaceId = requiredString(input.surfaceId, "surfaceId");
    const attached = pluginEventLogCursor.attachSurface(sessionId, surfaceId);
    if (!attached.ok) return attached;
    const replay = pluginEventLogCursor.readSince(sessionId, surfaceId, input.sinceEventId === undefined ? undefined : requiredString(input.sinceEventId, "sinceEventId"), input.limit === undefined ? 2000 : optionalFiniteInteger(input.limit, "limit", 2000, 1, 2000));
    return replay;
  });
  ipcMain.handle("agent:plugin-enable", async (_e, args: { id: string; enabled: boolean }) => {
    const input = recordValue(args, "plugin-enable payload");
    return agentHost.setPluginEnabled(requiredString(input.id, "plugin id"), requiredBoolean(input.enabled, "enabled"));
  });
  ipcMain.handle("agent:plugin-reload", async (_e, args: { id: string }) => {
    return agentHost.reloadPlugin(requiredString(recordValue(args, "plugin-reload payload").id, "plugin id"));
  });
  ipcMain.handle("agent:extensions-reload", async () => agentHost.reloadPiExtensions());
  ipcMain.handle("agent:extension-policy-reload", async (_e, args: unknown) => {
    const input = recordValue(args, "extension policy payload");
    const allowlist = Array.isArray(input.allowlistPackageNames) ? input.allowlistPackageNames : [];
    const denylist = Array.isArray(input.denylistPackageNames) ? input.denylistPackageNames : [];
    return agentHost.updateExtensionPolicy({ allowlistPackageNames: allowlist, denylistPackageNames: denylist });
  });
  ipcMain.handle("agent:extension-policy-get", async () => resources.readExtensionPolicyConfig());
  ipcMain.handle("agent:extension-policy-save", async (_e, args: unknown) => {
    const input = recordValue(args, "extension policy save payload");
    const config = await resources.writeExtensionPolicyConfig({
      allowlistPackageNames: Array.isArray(input.allowlistPackageNames) ? input.allowlistPackageNames.filter((entry): entry is string => typeof entry === "string") : [],
      denylistPackageNames: Array.isArray(input.denylistPackageNames) ? input.denylistPackageNames.filter((entry): entry is string => typeof entry === "string") : [],
    });
    return agentHost.updateExtensionPolicy(config);
  });
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

  // plan4.5 §B — needs-review approval gate. The gate is a process-wide
  // singleton; the resolver consults it during `configurePiExtensions`
  // (host-modules/pi-extension-configure.ts) so a `pending` verdict
  // drops the factory from `factories` and pushes a `blocked` diagnostic.
  // The renderer pops a modal off `pi/extension-needs-review-pending`
  // (also emitted by the resolver) and replies through these three
  // channels. After every approve / reject we call `reloadPiExtensions`
  // so the next agent loop sees the new factory set.
  ipcMain.handle("extension:needs-review-state", async () => {
    return summarizeNeedsReviewState(getNeedsReviewGate().snapshot());
  });
  ipcMain.handle("extension:approve-needs-review", async (_e, args: unknown) => {
    const input = recordValue(args, "needs-review approve payload");
    const id = requiredString(input.id, "id");
    const gate = getNeedsReviewGate();
    if (gate.gate({ id }) !== "pending") {
      // Idempotent: an already-approved / rejected / unknown id is
      // not an error — the renderer's optimistic UI may have already
      // applied the change. Return the current summary so the modal
      // can reconcile without a second round-trip.
      return { ok: true, id, state: gate.gate({ id }), summary: summarizeNeedsReviewState(gate.snapshot()) };
    }
    gate.approve(id);
    await agentHost.reloadPiExtensions();
    return { ok: true, id, state: "allow", summary: summarizeNeedsReviewState(gate.snapshot()) };
  });
  ipcMain.handle("extension:reject-needs-review", async (_e, args: unknown) => {
    const input = recordValue(args, "needs-review reject payload");
    const id = requiredString(input.id, "id");
    const gate = getNeedsReviewGate();
    if (gate.gate({ id }) !== "pending") {
      return { ok: true, id, state: gate.gate({ id }), summary: summarizeNeedsReviewState(gate.snapshot()) };
    }
    gate.reject(id);
    await agentHost.reloadPiExtensions();
    return { ok: true, id, state: "deny", summary: summarizeNeedsReviewState(gate.snapshot()) };
  });
}