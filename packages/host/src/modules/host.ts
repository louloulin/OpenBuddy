import { COMMANDS } from "@openbuddy/protocol/commands";
import { EVENTS } from "@openbuddy/protocol/events";
import { PROTOCOL_VERSION } from "@openbuddy/protocol/version";
import type { HostCapabilities } from "@openbuddy/protocol/host";
import type { ProviderQuotaResponse } from "@openbuddy/protocol/usage";
import { buildDiagnostics, sanitizeDiagnostics } from "@openbuddy/services/support/diagnostics";
import { text } from "@openbuddy/services/settings/settings";
import { getQuotaProviderForProvider } from "@openbuddy/services/usage/quota";
import { QuotaUnavailableError } from "@openbuddy/services/usage/quota";
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
       * 权威余额 (compute use): read the provider's own billing endpoint (Vercel AI Gateway's
       * `GET /v1/credits`). Failures come back as a reason, not an exception: a refused key
       * (`unauthorized`) and a dead network (`network`) need different wording.
       */
      usage_provider_quota: async (p): Promise<ProviderQuotaResponse> => {
        const providerId = text(p.providerId, "providerId");
        const catalog = ctx.engine.providers.list();
        const provider = catalog.providers.find((entry) => entry.id === providerId);
        if (!provider) return { status: "unavailable", reason: "unsupported-provider" };
        const adapter = getQuotaProviderForProvider(provider.providerKind, providerId);
        if (!adapter) return { status: "unavailable", reason: "unsupported-provider" };
        const apiKey = ctx.settings.secrets.get(`provider:${providerId}`);
        if (!apiKey) return { status: "unavailable", reason: "missing-credentials" };
        try {
          const reading = await adapter.fetchQuota({ kind: "api_key", apiKey }, { fetchImpl: ctx.options.fetchImpl });
          return { status: "ok", reading: { ...reading, providerId } };
        } catch (error) {
          if (error instanceof QuotaUnavailableError) return { status: "unavailable", reason: error.reason };
          throw error;
        }
      },
      /** 预算 (compute use): per-provider daily / monthly spend limits and what was spent. */
      usage_budgets: () => ctx.engine.budgets.list(providerNames(ctx)),
      usage_budget_save: (p) => {
        ctx.engine.budgets.set(text(p.providerId, "providerId"), {
          limitDailyUsd: Number(p.limitDailyUsd ?? 0),
          limitMonthlyUsd: Number(p.limitMonthlyUsd ?? 0),
        });
        return ctx.engine.budgets.list(providerNames(ctx));
      },
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

/** providerId → 展示名（预算列表里用；没有 label 时回退到厂商种类）。 */
function providerNames(ctx: HostContext): Record<string, string> {
  const names: Record<string, string> = {};
  try {
    for (const provider of ctx.engine.providers.list().providers)
      names[provider.id] = provider.label || provider.providerKind || provider.id;
  } catch {
    /* 没有目录也不该让预算列表失败 */
  }
  return names;
}
