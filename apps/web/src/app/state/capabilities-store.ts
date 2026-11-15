import { useEffect } from "react";
import { create } from "zustand";
import { hostCapabilities, type HostCapabilities } from "@openbuddy/client/api/host";

/**
 * What the connected host serves (pii W0.1). Fetched once at startup from `host_capabilities`;
 * entry points ask `useCapability(command)` / `useEvent(event)` instead of hard-coding
 * availability. Until the answer arrives, and when the host cannot answer (browser-only
 * preview, an older host), every command and event counts as missing.
 */
export type CapabilityStatus = "idle" | "loading" | "ready" | "unavailable";

export interface CapabilitySnapshot {
  status: CapabilityStatus;
  /** "desktop" for Electron; undefined until known. */
  platform?: string;
  commands: ReadonlySet<string>;
  events: ReadonlySet<string>;
}

interface CapabilitiesState extends CapabilitySnapshot {
  /** Fetch once (concurrent callers share the request); `force` asks again. */
  load: (force?: boolean) => Promise<void>;
  /** Apply a known answer (tests, non-IPC hosts); `null` = the host cannot tell. */
  apply: (caps: HostCapabilities | null) => void;
}

const NONE: ReadonlySet<string> = new Set();
let inflight: Promise<void> | undefined;

export const useCapabilitiesStore = create<CapabilitiesState>((set, get) => ({
  status: "idle",
  commands: NONE,
  events: NONE,
  apply: (caps) =>
    set(caps
      ? { status: "ready", platform: caps.platform, commands: new Set(caps.commands), events: new Set(caps.events) }
      : { status: "unavailable", platform: undefined, commands: NONE, events: NONE }),
  load: (force = false) => {
    if (inflight) return inflight;
    const { status } = get();
    if (!force && (status === "ready" || status === "unavailable")) return Promise.resolve();
    set({ status: "loading" });
    const request = (async () => {
      try {
        get().apply(await hostCapabilities());
      } catch {
        get().apply(null);
      }
    })();
    inflight = request.finally(() => { inflight = undefined; });
    return inflight;
  },
}));

/** Start the one startup fetch (idempotent). */
export const loadCapabilities = (force?: boolean) => useCapabilitiesStore.getState().load(force);

export const hasCommand = (caps: CapabilitySnapshot, command: string) => caps.status === "ready" && caps.commands.has(command);
export const hasEvent = (caps: CapabilitySnapshot, event: string) => caps.status === "ready" && caps.events.has(event);

function useEnsureLoaded() {
  useEffect(() => { void loadCapabilities(); }, []);
}

/** True once the host reports `command`; false while loading or when it is missing. */
export function useCapability(command: string): boolean {
  useEnsureLoaded();
  return useCapabilitiesStore((s) => hasCommand(s, command));
}

/** True once the host reports it may emit `event`; false while loading or when it is missing. */
export function useEvent(event: string): boolean {
  useEnsureLoaded();
  return useCapabilitiesStore((s) => hasEvent(s, event));
}

/** The whole snapshot, for code that checks several names (the FeatureRegistry). */
export function useCapabilitySnapshot(): CapabilitySnapshot {
  useEnsureLoaded();
  const status = useCapabilitiesStore((s) => s.status);
  const platform = useCapabilitiesStore((s) => s.platform);
  const commands = useCapabilitiesStore((s) => s.commands);
  const events = useCapabilitiesStore((s) => s.events);
  return { status, platform, commands, events };
}
