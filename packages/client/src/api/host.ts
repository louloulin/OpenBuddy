// §5.3 `host` module: host_capabilities (20261115-md R1/R4, pii W0.1).
import type { HostCapabilities } from "@openbuddy/protocol/host";
import { invoke } from "../ipc";

export type { HostCapabilities };

/** What the connected host serves: command and event names, protocol version, platform kind. */
export async function hostCapabilities(): Promise<HostCapabilities> {
  const caps = await invoke<HostCapabilities>("host_capabilities");
  if (!caps || !Array.isArray(caps.commands) || !Array.isArray(caps.events)) throw new Error("invalid_payload: host_capabilities");
  return caps;
}
