import { COMMANDS } from "@openbuddy/protocol/commands";
import { EVENTS } from "@openbuddy/protocol/events";
import { PROTOCOL_VERSION } from "@openbuddy/protocol/version";
import type { HostCapabilities } from "@openbuddy/protocol/host";
import { buildDiagnostics, sanitizeDiagnostics } from "@openbuddy/services/support/diagnostics";
import { text } from "@openbuddy/services/settings/settings";
import type { HostContext, HostModule } from "../module.js";
/**
 * §5.3 `host` module (20261115-md R1/R4): `host_capabilities` tells a client what this host
 * actually serves, so entry points can be shown or hidden instead of hard-coded. Commands are
 * the ones registered in the host plus those the embedding app serves itself; events are the
 * `agent://*` ones (the only kind the engine and host emit) plus the app's own. Additive only.
 * The renderer reads it once at startup (pii W0.1 `useCapability`); its FeatureRegistry hides
 * entries whose commands are missing. `features` stays empty.
 */
export function hostModule(ctx: HostContext): HostModule {
  return {
    id: "host",
    commands: {
      // 用量统计 (W5.6): per-session cumulative tokens / cost, aggregated by day / model / expert.
      usage_snapshot: () => ctx.engine.usageStats.snapshot(),
      /**
       * 反馈诊断 (W6.5): a local preview only. Optionally asks the current model for a short
       * problem summary (`includeSummary`), then both are sanitised. Nothing is uploaded.
       */
      agent_diagnose: async (p) => {
        const { engine, settings } = ctx;
        const config = settings.config.read();
        const catalog = (() => {
          try {
            return engine.providers.list();
          } catch {
            return { providers: [], models: [] };
          }
        })();
        const id = typeof p.sessionId === "string" && p.sessionId ? p.sessionId : engine.currentSessionId;
        let model: { provider: string; modelId: string } | undefined;
        let messageCount: number | undefined;
        if (id && engine.has(id)) {
          try {
            const state = engine.modelState(id);
            model = { provider: state.providerId, modelId: state.modelId };
          } catch {
            /* a session without a model still gets a report */
          }
          try {
            messageCount = engine.live(id).messages.length;
          } catch {
            /* ignore */
          }
        }
        const diagnostics = buildDiagnostics({
          app: typeof p.app === "string" && p.app ? text(p.app, "app").slice(0, 100) : "OpenBuddy",
          versions: {
            node: process.versions.node,
            electron: process.versions.electron,
            chromium: process.versions.chrome,
          },
          platform: process.platform,
          arch: process.arch,
          providerIds: (catalog.providers ?? []).map((provider: { id: string }) => provider.id),
          model,
          permissionMode: config.permissionMode,
          ruleCount: config.rules.length,
          protectedPaths: config.protectedPaths ?? [],
          extensions: engine.extensionErrors.map((entry) => ({
            name: entry.path.split(/[\\/]/).pop() || entry.path,
            error: entry.error,
          })),
          ...(id ? { sessionId: id, messageCount } : {}),
          ...(typeof p.feedback === "string" && p.feedback.trim() ? { feedback: p.feedback.trim().slice(0, 4000) } : {}),
        });
        let summary: string | undefined;
        if (p.includeSummary === true && id && engine.has(id)) {
          try {
            const generated = await engine.summarizeForBugReport(
              id,
              typeof p.hint === "string" && p.hint.trim() ? p.hint.trim().slice(0, 2000) : undefined,
            );
            summary = sanitizeDiagnostics(generated);
          } catch (error) {
            summary = `摘要生成失败：${error instanceof Error ? error.message : String(error)}`;
          }
        }
        return { diagnostics, ...(summary ? { summary } : {}) };
      },
      host_capabilities: () => {
        const platform = ctx.options.platform;
        const commands = new Set<string>([...ctx.servedCommands(), ...(platform?.commands ?? [])]);
        const events = new Set<string>([...EVENTS.filter((e) => e.startsWith("agent://")), ...(platform?.events ?? [])]);
        return {
          protocolVersion: PROTOCOL_VERSION,
          platform: platform?.kind ?? "unknown",
          commands: COMMANDS.filter((c) => commands.has(c)),
          events: EVENTS.filter((e) => events.has(e)),
          features: [],
        } satisfies HostCapabilities;
      },
    },
  };
}
