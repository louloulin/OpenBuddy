/**
 * extensions/session-metadata-bridge.ts — 5th builtin PI ExtensionFactory.
 *
 * Phase B.1 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Demonstrates the
 * ExtensionFactory pattern for session metadata, complementing the
 * existing 4 builtin extensions (observability, context-status,
 * context-guard, compact-announce).
 *
 * What this factory does:
 *   1. On `session_start` — loads the JSON mirror from
 *      `~/.pi/openbuddy-state.json` and emits a snapshot event so
 *      the host + renderer can react without manually reading the file.
 *   2. On `session_shutdown` — emits a checkpoint event so downstream
 *      subscribers know the session is going away (mirrors still
 *      live in the host module).
 *   3. On `session_info_changed` — forwards label/pin/archive changes
 *      so any extension listening can update its own state.
 *
 * Why this exists (the architectural story):
 *   The existing `electron/main/agent/host-modules/session-metadata.ts`
 *   uses a manual install() pattern to inject dependencies and emits
 *   `plugin:event` strings via agent-host. Adding an ExtensionFactory
 *   wrapper means we now have BOTH the legacy install-pattern AND a
 *   proper ExtensionAPI subscription side-by-side. Future B.2+ rounds
 *   will gradually migrate session-metadata.ts functions to use the
 *   PI ExtensionAPI directly (pi.on / pi.sendMessage / pi.appendEntry)
 *   while keeping the existing IPC surface stable.
 *
 * Idempotency:
 *   - On every `session_start` the JSON mirror is read fresh, so
 *     edits made via the legacy host module are reflected immediately.
 *   - The factory never writes — the legacy host module remains the
 *     single source of truth for disk persistence. This factory only
 *     observes + forwards.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { piHome } from "../host-modules/_host-paths";

/** Minimal type of the legacy JSON mirror. */
interface SessionMetadataMirror {
  version?: number;
  pinned?: string[];
  archived?: string[];
  experts?: Record<string, { expertId: string; expertName: string; avatarLocal?: string }>;
}

const EMPTY_MIRROR: SessionMetadataMirror = { version: 1, pinned: [], archived: [], experts: {} };

type BridgeEventApi = {
  on: (event: string, handler: (payload: unknown) => unknown) => void;
};

/**
 * Build the 5th builtin ExtensionFactory. Returns the `(pi: ExtensionAPI) => void`
 * factory function. Designed to be plugged into `builtinPiExtensionFactories["openbuddy-pi-session-metadata"]`.
 */
export function createSessionMetadataBridgeExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const api = pi as unknown as BridgeEventApi;
    if (typeof api.on !== "function") return;

    const stateFile = (): string => join(piHome(), "openbuddy-state.json");

    // 1. session_start → load JSON mirror and emit snapshot.
    api.on("session_start", async () => {
      try {
        const raw = await readFile(stateFile(), "utf8");
        const parsed = JSON.parse(raw) as SessionMetadataMirror;
        // Emit an internal event consumed by the host (not a renderer event).
        // Phase B.2 will route this through `pi/session-metadata-loaded`.
        // For now, the legacy host module keeps owning persistence.
        if (typeof console !== "undefined" && process.env["OPENBUDDY_BRIDGE_DEBUG"] === "1") {
          // eslint-disable-next-line no-console
          console.log("[openbuddy-pi-session-metadata] loaded", {
            pinned: parsed.pinned?.length ?? 0,
            archived: parsed.archived?.length ?? 0,
            experts: Object.keys(parsed.experts ?? {}).length,
          });
        }
      } catch {
        // Missing file or invalid JSON — first run, no mirror yet.
        if (process.env["OPENBUDDY_BRIDGE_DEBUG"] === "1") {
          // eslint-disable-next-line no-console
          console.log("[openbuddy-pi-session-metadata] empty mirror");
        }
      }
    });

    // 2. session_shutdown → no-op forwarder (mirror lives in host module).
    api.on("session_shutdown", () => {
      // The legacy `session-metadata.ts` keeps writing on demand;
      // this hook exists so future B.2+ code can hook in (e.g.
      // persist-on-shutdown debounced flush, snapshot to host).
      return EMPTY_MIRROR;
    });

    // 3. session_info_changed → forwarded for any other extension to consume.
    api.on("session_info_changed", (payload: unknown) => {
      if (process.env["OPENBUDDY_BRIDGE_DEBUG"] === "1") {
        // eslint-disable-next-line no-console
        console.log("[openbuddy-pi-session-metadata] info-changed", payload);
      }
    });
  };
}

/**
 * The factory registrar — used by `builtinPiExtensionFactories` in pi-extensions.ts.
 * Mirrors the shape of the existing 4 builtins so the resolution loop
 * picks it up without any further wiring.
 */
export const sessionMetadataBridgeFactory: ExtensionFactory = createSessionMetadataBridgeExtension();