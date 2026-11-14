import { COMMANDS } from "@openbuddy/protocol/commands";
import { EVENTS } from "@openbuddy/protocol/events";
import { PROTOCOL_VERSION } from "@openbuddy/protocol/version";
import type { HostContext, HostModule } from "../module.js";
/**
 * §5.3 `host` module (20261115-md R1/R4): `host_capabilities` tells a client what this host
 * speaks, so entry points can be shown or hidden instead of hard-coded. Additive only; the
 * renderer does not consume it yet. `features` stays empty until the R8 FeatureRegistry
 * names optional features.
 */
export function hostModule(ctx: HostContext): HostModule {
  return {
    id: "host",
    commands: {
      host_capabilities: () => ({
        protocolVersion: PROTOCOL_VERSION,
        platform: ctx.options.platform ?? "desktop",
        commands: [...COMMANDS],
        events: [...EVENTS],
        features: [] as string[],
      }),
    },
  };
}
