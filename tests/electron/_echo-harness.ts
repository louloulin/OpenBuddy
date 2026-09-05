/**
 * _echo-harness.ts — shared echo-upstream harness for chat e2e specs.
 *
 * Extracted from `chat-flow-echo.spec.ts` so more than one spec can drive a
 * real streaming turn without copying the setup. The scrub-list in
 * `_fixtures.ts` had already demonstrated what happens when this kind of
 * fixture gets duplicated: three copies drifted apart and two of them silently
 * lost entries.
 *
 * What it provides:
 *   - `startEchoServer()` / `stopEchoServer()` — spawn the local
 *     Anthropic-Messages echo upstream on an ephemeral port and learn the port
 *     from the server's own stdout announcement.
 *   - `bootstrapEcho()` — register the provider + model and open a session.
 *   - `invoke()` / `invokeOrReject()` — call the renderer IPC bridge.
 *   - `installCapture()` — buffer `pi://update` / `pi://complete` / `pi://error`
 *     in the renderer and read them back.
 */
import { expect } from "./_fixtures";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(dirname(__dirname));
const ECHO_SCRIPT = join(ROOT, "evals", "node", "echo", "anthropic-echo-provider.mjs");
const ECHO_HOST = "127.0.0.1";
const ECHO_API_KEY = "echo-key";
export const ECHO_PROVIDER_ID = "openbuddy_e2e_echo";
export const ECHO_MODEL_ID = "openbuddy-e2e-echo-model";

/**
 * `agent:set-model` parses its argument by splitting on `/` and treating the
 * first segment as the provider id, so the wire format is
 * `<providerId>/<modelId>`.
 */
export const ECHO_WIRE_MODEL_ID = `${ECHO_PROVIDER_ID}/${ECHO_MODEL_ID}`;

/**
 * The echo upstream binds an EPHEMERAL port and reports it on stdout.
 *
 * History of this decision, because two earlier approaches both flaked:
 *
 *  1. A single hard-coded 8787 for every worker. `playwright.config.ts` sets
 *     `fullyParallel: true`, so on a 14-core box all 7 workers run the
 *     `beforeAll` and each spawns a server. Only one wins the bind; the rest
 *     log `echo server exited with code 1` (EADDRINUSE) and then silently
 *     share the winner's server. Whichever worker finishes first runs
 *     `afterAll` and SIGTERMs that shared server out from under everyone
 *     else's in-flight requests.
 *
 *  2. `8787 + parallelIndex`, so each worker owns its own server. Better, but
 *     the ports are still guesses about a developer's machine — an unrelated
 *     long-running local service was found squatting on 8788, which silently
 *     starved exactly one worker of its upstream (that turn produced zero
 *     `pi://update` events and failed the text assertion).
 *
 * Port 0 removes the guess entirely: the OS assigns a free port, the server
 * prints `{"ok":true,"address":{...,"baseUrl":"..."}}`, and we wait for that
 * line instead of polling a URL we assumed.
 */
const ECHO_STARTUP_TIMEOUT_MS = 15_000;

export type PiUpdatePayload = {
  sessionId?: string;
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
  toolCallId?: string;
  status?: string;
};

export type CompletePayload = { sessionId?: string; promptId?: string; stopReason?: string };

export type CaptureBuffer = {
  updates: PiUpdatePayload[];
  completes: CompletePayload[];
  errors: Array<{ sessionId?: string; error?: string }>;
};

export type CaptureReader = () => Promise<{
  updates: PiUpdatePayload[];
  completes: CompletePayload[];
  errors: CaptureBuffer["errors"];
}>;

/**
 * Buffer the three streaming channels in the renderer.
 *
 * Note the capture must be (re)installed after any reload — the buffer lives
 * on `window` and a navigation wipes it.
 */
export async function installCapture(page: import("@playwright/test").Page): Promise<CaptureReader> {
  await page.evaluate(() => {
    const w = window as unknown as { __chatFlowCapture?: CaptureBuffer };
    w.__chatFlowCapture = { updates: [], completes: [], errors: [] };
    const cap = w.__chatFlowCapture;
    const api = (window as unknown as { api?: { events?: { on: (channel: string, handler: (payload: unknown) => void) => () => void } } }).api;
    if (!api?.events?.on) throw new Error("renderer bridge events.on is unavailable");
    api.events.on("pi://update", (payload) => { cap.updates.push(payload as PiUpdatePayload); });
    api.events.on("pi://complete", (payload) => { cap.completes.push(payload as CompletePayload); });
    api.events.on("pi://error", (payload) => { cap.errors.push(payload as { sessionId?: string; error?: string }); });
  });
  return async () =>
    page.evaluate(() => {
      const cap = (window as unknown as { __chatFlowCapture?: CaptureBuffer }).__chatFlowCapture;
      if (!cap) return { updates: [], completes: [], errors: [] };
      return { updates: cap.updates.slice(), completes: cap.completes.slice(), errors: cap.errors.slice() };
    });
}

export async function invoke<T>(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<T> {
  return page.evaluate(
    async ({ channel, args }: { channel: string; args?: unknown }) => {
      const api = (window as unknown as { api?: { invoke: (channel: string, args?: unknown) => Promise<unknown> } }).api;
      if (!api?.invoke) throw new Error(`renderer bridge unavailable for ${channel}`);
      return api.invoke(channel, args) as unknown;
    },
    { channel, args },
  ) as Promise<T>;
}

export async function invokeOrReject(
  page: import("@playwright/test").Page,
  channel: string,
  args?: unknown,
): Promise<{ ok: boolean; value: unknown }> {
  try {
    return { ok: true, value: await invoke<unknown>(page, channel, args) };
  } catch (error) {
    return { ok: false, value: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Concatenate the assistant text carried by a batch of `pi://update` events.
 *
 * Accepts BOTH wire shapes. Live streaming emits `text_delta`; history replay
 * (`host-modules/session-store.ts`) emits whole messages as legacy `text`.
 * Filtering to one shape made this depend on which path produced the turn.
 *
 * `text_start` / `text_end` are block boundaries carrying no payload, so they
 * contribute nothing and are naturally excluded.
 */
export function collectText(updates: PiUpdatePayload[]): string {
  return updates
    .filter((u) => u.type === "agent_message_chunk")
    .flatMap((u) => u.content ?? [])
    .filter((c) => c.type === "text" || c.type === "text_delta")
    .map((c) => c.text ?? "")
    .join("");
}

/** Read the `baseUrl` the echo server reports on stdout after binding. */
function readEchoBaseUrl(proc: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(
      () => reject(new Error(`echo provider did not report an address within ${timeoutMs}ms; stdout so far: ${buffered.slice(0, 400)}`)),
      timeoutMs,
    );
    const done = (fn: () => void) => { clearTimeout(timer); fn(); };
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      for (const line of buffered.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const parsed = JSON.parse(line) as { ok?: boolean; address?: { baseUrl?: string } };
          if (parsed.ok && parsed.address?.baseUrl) {
            done(() => resolve(parsed.address!.baseUrl!));
            return;
          }
        } catch { /* partial line — keep buffering */ }
      }
    });
    proc.once("error", (err) => done(() => reject(err)));
    proc.once("exit", (code) =>
      done(() => reject(new Error(`echo provider exited with code ${code} before reporting an address; stdout: ${buffered.slice(0, 400)}`))),
    );
  });
}

async function waitForHealthz(url: string, deadlineMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() < start + deadlineMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`echo server did not become healthy within ${deadlineMs}ms at ${url}`);
}

export type EchoServer = { proc: ChildProcess; baseUrl: string };

/** Spawn the echo upstream on an ephemeral port and wait until it serves. */
export async function startEchoServer(label: string): Promise<EchoServer> {
  const proc = spawn(process.execPath, [ECHO_SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      // Port 0 → the OS picks a free port; the server reports it back.
      OPENBUDDY_ECHO_PORT: "0",
      OPENBUDDY_ECHO_HOST: ECHO_HOST,
      OPENBUDDY_ECHO_KEY: ECHO_API_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  const baseUrl = await readEchoBaseUrl(proc, ECHO_STARTUP_TIMEOUT_MS);
  proc.stderr?.on("data", () => { /* swallow verbose logs */ });
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) console.warn(`[${label}] echo server exited with code ${code}`);
  });
  // Confirm the reported address really serves this process's echo server
  // (not something else that happened to grab the port).
  await waitForHealthz(`${baseUrl}/healthz`, 8_000);
  return { proc, baseUrl };
}

export async function stopEchoServer(server: EchoServer | null): Promise<void> {
  const proc = server?.proc;
  if (!proc || proc.killed) return;
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 2_000);
    proc.once("exit", () => { clearTimeout(t); resolve(); });
  });
}

/**
 * Registers the echo provider, saves a model, and creates a session (which
 * auto-activates the model). Returns session info so callers can drive
 * prompt / abort / steer.
 */
export async function bootstrapEcho(
  page: import("@playwright/test").Page,
  echoBase: string,
): Promise<{ sessionId: string; cwd: string }> {
  const cwd = mkdtempSync(join(tmpdir(), "openbuddy-chat-e2e-"));

  const saveProvider = await invokeOrReject(page, "agent:providers-save-provider", {
    provider: {
      id: ECHO_PROVIDER_ID,
      label: "OpenBuddy E2E echo",
      providerKind: "custom_anthropic",
      apiKey: ECHO_API_KEY,
      baseUrl: echoBase,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  expect(saveProvider.ok, `providers-save-provider failed: ${String(saveProvider.value)}`).toBe(true);

  const saveModel = await invokeOrReject(page, "agent:providers-save-model", {
    model: { providerId: ECHO_PROVIDER_ID, modelId: ECHO_MODEL_ID, name: "Echo E2E", contextWindow: 128000 },
  });
  expect(saveModel.ok, `providers-save-model failed: ${String(saveModel.value)}`).toBe(true);

  // new-session auto-calls setModel internally, so we don't need to invoke
  // agent:set-model separately.
  const sessionResult = await invokeOrReject(page, "agent:new-session", { cwd, modelId: ECHO_WIRE_MODEL_ID });
  expect(sessionResult.ok, `agent:new-session failed: ${String(sessionResult.value)}`).toBe(true);
  const session = sessionResult.value as { sessionId?: string };
  expect(session?.sessionId, `sessionId missing from new-session response: ${JSON.stringify(session)}`).toBeDefined();

  const current = await invoke<{ id?: string; provider?: string }>(page, "agent:current-model");
  expect(current).toBeDefined();
  expect(current?.id).toBe(ECHO_MODEL_ID);
  expect(current?.provider).toBe(ECHO_PROVIDER_ID);

  return { sessionId: session.sessionId as string, cwd };
}
