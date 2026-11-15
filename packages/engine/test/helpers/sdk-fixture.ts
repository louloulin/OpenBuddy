// Shared harness for engine tests that drive real Pi sessions (real SessionManager / AgentSession)
// against a local OpenAI-compatible SSE fixture model. No network, no real keys.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createEngineHandlers } from "@openbuddy/host/handlers";

export interface FixtureRequest { messages: Array<{ role: string; content?: unknown }>; [key: string]: unknown }
/** What the fixture model streams back for one request: plain text, or tool calls. */
export type FixtureReply = { text: string } | { toolCalls: Array<{ id: string; name: string; arguments: unknown }> };

const secureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
  decryptString: (value: Buffer) => value.toString().split("").reverse().join(""),
};

export async function sdkFixture(reply: (request: FixtureRequest, index: number) => FixtureReply | Promise<FixtureReply>, cleanups: Array<() => Promise<unknown>>, options: { extensionFactories?: ExtensionFactory[] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-w1-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: FixtureRequest[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const data = JSON.parse(body) as FixtureRequest;
    requests.push(data);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const out = await reply(data, requests.length - 1);
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: "assistant" });
    if ("text" in out) {
      chunk({ content: out.text });
      chunk({}, "stop");
    } else {
      chunk({ tool_calls: out.toolCalls.map((call, index) => ({ index, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
      chunk({}, "tool_calls");
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as { port: number }).port;
  const events: Array<{ name: string; payload: any }> = [];
  const engine = await createEngineHandlers({
    userDataDir: root,
    safeStorage: secureStorage,
    emit: (name, payload) => events.push({ name, payload }),
    shell: { openPath: async () => "", openExternal: async () => {}, showItemInFolder: () => {} },
    extensionFactories: options.extensionFactories,
  });
  cleanups.push(engine.dispose);
  const call = async (name: string, payload: Record<string, unknown> = {}) => engine.handlers[name]!(payload);
  await call("providers_save_provider", { provider: { id: "fixture", providerKind: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, apiBackend: "chat_completions", authScheme: "bearer", apiKey: "private-test-key" } });
  await call("providers_save_model", { model: { modelId: "fixture", providerId: "fixture", contextWindow: 32000 } });
  await call("agent_init", { cwd: root });
  const sid = (await call("agent_new_session", { cwd: root, modelId: "fixture" })) as string;
  return { root, engine, call, sid, events, requests };
}

export async function until(predicate: () => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Text of the last user-side message the model received (Pi turns `!cmd` output into a user message). */
export function requestText(request: FixtureRequest | undefined): string {
  return JSON.stringify(request?.messages ?? []);
}
