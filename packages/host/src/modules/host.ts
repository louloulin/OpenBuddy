import { COMMANDS } from "@openbuddy/protocol/commands";
import { EVENTS } from "@openbuddy/protocol/events";
import { PROTOCOL_VERSION } from "@openbuddy/protocol/version";
import type { HostCapabilities } from "@openbuddy/protocol/host";
import { buildDiagnostics, sanitizeDiagnostics } from "@openbuddy/services/support/diagnostics";
import {
  bundledAppsCheck, crashLogCheck, diskSpaceCheck, formatSelfCheckReport, runSelfCheck, saveSelfCheckReport,
  systemInfoCheck, writableCheck, type SelfCheckItem,
} from "@openbuddy/services/support/self-check";
import { readBundleMarker } from "@openbuddy/services/apps/manifest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
      usage_provider_quota: async (p) => {
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
      /**
       * 启动自检 (20261127-upup §1.18): local checks only. `probeModel` additionally sends one
       * tiny request ("Reply with: OK") to the default model; `save` writes the redacted report
       * to <userData>/diagnostics (latest 10 kept). Nothing is uploaded.
       */
      agent_self_check: async (p) => {
        const { engine, options } = ctx;
        const dataDir = options.userDataDir;
        const items: SelfCheckItem[] = [
          diskSpaceCheck(dataDir),
          writableCheck(dataDir),
          bundledAppsCheck((options.bundledApps ?? []).map((dir) => resolve(dir)), (dir) => {
            const marker = readBundleMarker(dir);
            let version: string | undefined;
            try { version = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string }).version; } catch { /* missing */ }
            return marker ? { ...marker, ...(version ? { version } : {}) } : undefined;
          }),
          crashLogCheck(join(dataDir, "logs")),
          {
            id: "model.config", title: "模型配置",
            async run() {
              const auth = await engine.providers.authStatus();
              if (!auth.ready) return { status: "fail", summary: auth.reason ?? "没有可用的模型", advice: "到「设置 → 模型」添加模型并填写 API Key" };
              const entry = engine.providers.entry();
              return { status: "pass", summary: `可用模型 ${auth.providers.length} 个${entry ? `，默认 ${entry.providerId}/${entry.modelId}` : ""}` };
            },
          },
          {
            id: "extensions.load", title: "扩展加载",
            async run() {
              const errors = engine.extensionErrors;
              if (errors.length === 0) return { status: "pass", summary: "没有加载失败的扩展" };
              return {
                status: "warning", summary: `${errors.length} 个扩展加载失败`,
                detail: errors.slice(0, 5).map((e) => `${e.path.split(/[\\/]/).pop() || e.path}：${e.error.slice(0, 200)}`).join("\n"),
                advice: "到「扩展中心」停用或重装失败的扩展",
              };
            },
          },
          systemInfoCheck({ node: process.versions.node, electron: process.versions.electron, ...(options.appVersion ? { app: options.appVersion } : {}) }),
        ];
        if (p.probeModel === true) {
          items.push({
            id: "model.reachable", title: "模型连通", timeoutMs: 70_000,
            async run() {
              const entry = engine.providers.entry();
              if (!entry) return { status: "fail", summary: "没有默认模型可测" };
              try {
                const result = await engine.providers.test({ providerId: entry.providerId, modelId: entry.modelId }) as { ok: boolean; latencyMs: number; reply?: string; error?: string };
                if (!result.ok) return { status: "fail", summary: `${entry.modelId} 请求失败：${(result.error ?? "").slice(0, 200)}`, advice: "检查网络、API Key 与服务商地址" };
                return { status: "pass", summary: `${entry.modelId} 正常，${result.latencyMs} ms${result.reply ? `，回复「${result.reply.slice(0, 40)}」` : ""}` };
              } catch (error) {
                return { status: "fail", summary: `${entry.modelId}：${error instanceof Error ? error.message : String(error)}`, advice: "检查网络、API Key 与服务商地址" };
              }
            },
          });
        }
        const report = await runSelfCheck(items);
        const text = formatSelfCheckReport(report, options.appVersion ? `OpenBuddy ${options.appVersion}` : "OpenBuddy");
        const results = report.results.map((r) => ({
          ...r, summary: sanitizeDiagnostics(r.summary),
          ...(r.detail ? { detail: sanitizeDiagnostics(r.detail) } : {}),
        }));
        const file = p.save === true ? await saveSelfCheckReport(join(dataDir, "diagnostics"), text) : undefined;
        return { ...report, results, report: text, ...(file ? { file } : {}) };
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
