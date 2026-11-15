/** `host_capabilities` (20261115-md R1/R4, pii W0.1): what the connected host actually serves. */
export interface HostCapabilities {
  protocolVersion: number;
  /** "desktop" for Electron; "unknown" when the embedding app did not say. */
  platform: string;
  /** Command names the host answers (host modules plus the embedding app's native ones). */
  commands: string[];
  /** Event names the host may emit. */
  events: string[];
  features: string[];
}
