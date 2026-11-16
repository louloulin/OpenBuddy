import { COMMANDS } from "@openbuddy/protocol/commands";
import { EVENTS } from "@openbuddy/protocol/events";
import { PROTOCOL_VERSION } from "@openbuddy/protocol/version";
import type { HostCapabilities } from "@openbuddy/protocol/host";
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
