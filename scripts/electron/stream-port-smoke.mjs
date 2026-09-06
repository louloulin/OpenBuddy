/**
 * stream-port-smoke.mjs — real-Electron verification of the Pi stream
 * MessageChannel transport (P2-03).
 *
 * Launches the packaged main + preload against a throwaway profile, then:
 *   1.  handshakes `window.api.events.openPiStream(...)` and asserts the
 *       transferred port is usable (returns a real unlisten fn);
 *   2.  publishes three `pi://update`-shaped payloads through the main-process
 *       smoke hook and asserts they arrive as ONE 16ms batch, FIFO, on the
 *       renderer port;
 *   3.  opens a second port and asserts port replacement semantics: the old
 *       subscriber stops receiving and the new one takes over;
 *   4.  asserts unlisten() closes the port cleanly.
 *
 * Requires the app to have been built (`npm run build`) before running.
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-stream-port-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

let app;
let passed = false;
try {
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron"),
    cwd: root,
    timeout: 20_000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "",
      PI_CODING_AGENT_DIR: piAgentDir,
      OPENBUDDY_DEBUG_UI: "0",
      OPENBUDDY_FILESYSTEM_SMOKE: "0",
      OPENBUDDY_STREAM_SMOKE: "1",
    },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

  // Everything happens inside ONE renderer evaluate: open the port, publish
  // through the smoke hook, and observe the delivered batches.
  const probe = await page.evaluate(async () => {
    const sleep = (millis) => new Promise((resolve) => setTimeout(resolve, millis));
    const out = { opened: false, unlistenKind: null, batch: null, secondBatch: null, firstReceivedCount: 0, errors: [] };
    const firstReceived = [];
    const secondReceived = [];
    try {
      const unlisten = await window.api.events.openPiStream((batch) => firstReceived.push(batch));
      if (!unlisten) {
        out.errors.push("openPiStream returned null (no port support)");
        return out;
      }
      out.opened = true;
      out.unlistenKind = typeof unlisten;

      // Three publishes within the 16ms window → one FIFO batch on the port.
      await window.api.invoke("stream-smoke:publish", { sessionId: "smoke-s1", type: "agent_message_chunk", content: [{ type: "text_delta", text: "a" }] });
      await window.api.invoke("stream-smoke:publish", { sessionId: "smoke-s1", type: "agent_message_chunk", content: [{ type: "text_delta", text: "b" }] });
      await window.api.invoke("stream-smoke:publish", { sessionId: "smoke-s1", type: "tool_call", toolCallId: "t1", title: "bash", kind: "bash", status: "in_progress" });
      await sleep(300);
      out.batch = firstReceived[0] ?? null;
      out.firstReceivedCount = firstReceived.length;

      // Second port replaces the first (main-side attach):
      // the old subscriber must stop, the replacement takes over.
      const unlisten2 = await window.api.events.openPiStream((batch) => secondReceived.push(batch));
      await window.api.invoke("stream-smoke:publish", { sessionId: "smoke-s1", type: "agent_message_chunk", content: [{ type: "text_delta", text: "c" }] });
      await sleep(300);
      out.firstReceivedCount = firstReceived.length;
      out.secondBatch = secondReceived[0] ?? null;
      unlisten2?.();
      unlisten();
      return out;
    } catch (error) {
      out.errors.push(String(error));
      return out;
    }
  });

  if (!probe.opened || probe.batch === null) {
    throw new Error(`stream port handshake or batch failed: ${JSON.stringify(probe)}`);
  }
  const events = probe.batch.events ?? [];
  if (events.length !== 3 || events[0].content?.[0]?.text !== "a" || events[1].content?.[0]?.text !== "b"
    || events[2].type !== "tool_call" || events[2].toolCallId !== "t1") {
    throw new Error(`expected one FIFO batch of 3, got: ${JSON.stringify(probe.batch)}`);
  }
  if (probe.firstReceivedCount !== 1) {
    throw new Error(`expected old port to stop after replacement, firstReceivedCount=${probe.firstReceivedCount}`);
  }
  const secondEvents = probe.secondBatch?.events ?? [];
  if (secondEvents.length !== 1 || secondEvents[0].content?.[0]?.text !== "c") {
    throw new Error(`expected replacement port to receive the later delta, got: ${JSON.stringify(probe.secondBatch)}`);
  }
  if (probe.unlistenKind !== "function") {
    throw new Error(`unlisten is not a function: ${probe.unlistenKind}`);
  }
  if (probe.errors.length > 0) {
    throw new Error(`renderer probe errors: ${probe.errors.join("; ")}`);
  }

  console.log("stream-port-smoke OK", {
    batchEvents: events.length,
    batchVersion: probe.batch.version,
    oldPortStopped: probe.firstReceivedCount === 1,
    replacementReceived: secondEvents.length,
  });
  passed = true;
} finally {
  if (app) {
    try { await app.close(); } catch { /* best effort */ }
  }
  rmSync(userData, { recursive: true, force: true });
  if (!passed) {
    console.error("stream-port-smoke FAILED — the real Electron stream transport handshake/batching did not hold.");
    process.exitCode = 1;
  }
}
