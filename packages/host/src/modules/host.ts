import { COMMANDS } from "@openbuddy/protocol/commands";
import { EVENTS } from "@openbuddy/protocol/events";
import { PROTOCOL_VERSION } from "@openbuddy/protocol/version";
import type { HostContext, HostModule } from "../module.js";
/**
 * §5.3 `host` module (20261115-md R1/R4): `host_capabilities` tells a client what this host
 * actually serves, so entry points can be shown or hidden instead of hard-coded. Commands are
 * the ones registered in the host plus those the embedding app serves itself; events are the
 * `agent://*` ones (the only kind the engine and host emit) plus the app's own. Additive only;
 * the renderer does not consume it yet. `features` stays empty until the R8 FeatureRegistry.
 */
export function hostModule(ctx: HostContext): HostModule {
  return {
    id: "host",
    commands: {
      host_capabilities: () => {
        const platform = ctx.options.platform;
        const commands = new Set<string>([...ctx.servedCommands(), ...(platform?.commands ?? [])]);
        const events = new Set<string>([...EVENTS.filter((e) => e.startsWith("agent://")), ...(platform?.events ?? [])]);
        return {
          protocolVersion: PROTOCOL_VERSION,
          platform: platform?.kind ?? "unknown",
          commands: COMMANDS.filter((c) => commands.has(c)),
          events: EVENTS.filter((e) => events.has(e)),
          features: [] as string[],
        };
      },
    },
  };
}
