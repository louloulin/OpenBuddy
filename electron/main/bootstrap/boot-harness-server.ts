/**
 * bootstrap/boot-harness-server.ts — boot the IPC harness server in the
 * background, write the address/token JSON to disk so test runners
 * (launch-harness.mjs) can resolve it without parsing stdout.
 *
 * Phase 8.3 §41: extracted from electron/main/index.ts:bootBackgroundServices.
 * The original 35-line inline block did three things:
 *   1. startHarnessServer with port + auth token + rpc cache + agent host
 *      + dispatchRpc + lifecycleJournal (the actual server boot)
 *   2. setActiveHarnessServer so the rest of the app can read it
 *   3. write /tmp/openbuddy-harness.json with { baseUrl, token, host, port }
 *      if OPENBUDDY_HARNESS_FILE is set
 *
 * All three stay together — the file write is part of the server boot
 * because it's the handshake that downstream tooling depends on.
 *
 * Reverse-dependency invariant:
 *   This module imports nothing from index.ts. It imports:
 *   - ../harness/harness-server (startHarnessServer, setActiveHarnessServer)
 *   - ../harness/harness-token (resolveHarnessAuthToken)
 *   - ../harness/harness-rpc-store (defaultHarnessRpcCachePath)
 *   - node:fs (writeFileSync for the handshake file)
 */
import { writeFileSync } from "node:fs";
import { startHarnessServer, setActiveHarnessServer, type HarnessServer } from "../harness/harness-server";
import { resolveHarnessAuthToken } from "../harness/harness-token";
import { defaultHarnessRpcCachePath } from "../harness/harness-rpc-store";
import { perfTraceMark } from "../observability/perf-trace";

/**
 * Dependencies required to boot the harness server. The deps are
 * minimal — just the lazy-loaded agent-host facade (whose `.init()`
 * isn't called here, only the harness needs a reference) and the
 * harnessRpc dispatch bridge.
 */
export interface BootHarnessServerDeps {
  agent: unknown;
  dispatchRpc: (req: unknown) => Promise<unknown> | unknown;
}

/**
 * Boot the harness server and write the handshake JSON.
 *
 * Returns the server instance on success, or null on failure (failure
 * is logged but never thrown — the main app should keep running even
 * if the harness can't listen, because the renderer doesn't depend on
 * it for first-paint).
 */
export async function bootHarnessServer(deps: BootHarnessServerDeps): Promise<HarnessServer | null> {
  perfTraceMark("harness-server-spawn");
  try {
    const started = await startHarnessServer({
      port: process.env.OPENBUDDY_HARNESS_PORT ? Number(process.env.OPENBUDDY_HARNESS_PORT) : 0,
      authToken: await resolveHarnessAuthToken({ envToken: process.env.OPENBUDDY_HARNESS_TOKEN }),
      resumeTokenSecret: process.env.OPENBUDDY_HARNESS_RESUME_SECRET ?? process.env.OPENBUDDY_HARNESS_TOKEN,
      rpcCachePath: process.env.OPENBUDDY_HARNESS_RPC_CACHE ?? defaultHarnessRpcCachePath(),
      agent: deps.agent as never,
      dispatchRpc: deps.dispatchRpc as never,
      lifecycleJournal: async (sessionId, event) => {
        const context = (deps.agent as { getContext?: () => { get: (key: string) => unknown } | undefined }).getContext?.();
        const appendLifecycleEntry = context?.get("agentHost") as { appendLifecycleEntry?: (id: string, event: unknown) => Promise<string> } | undefined;
        await appendLifecycleEntry?.appendLifecycleEntry?.(sessionId, event);
      },
    });
    setActiveHarnessServer(started.server);
    console.info(`[openbuddy-harness] listening at ${started.address.baseUrl}`);

    const harnessFile = process.env.OPENBUDDY_HARNESS_FILE;
    if (harnessFile) {
      try {
        writeFileSync(harnessFile, JSON.stringify({
          baseUrl: started.address.baseUrl,
          token: started.address.token ?? process.env.OPENBUDDY_HARNESS_TOKEN ?? "",
          host: started.address.host,
          port: started.address.port,
        }));
        console.info(`[openbuddy-harness] wrote ${harnessFile}`);
      } catch (error) {
        console.error(`[openbuddy-harness] failed to write ${harnessFile}:`, error);
      }
    }
    return started.server;
  } catch (error) {
    console.error("[openbuddy-harness] server failed to start:", error);
    return null;
  }
}
