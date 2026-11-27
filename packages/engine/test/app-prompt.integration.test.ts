// @vitest-environment node
/**
 * 应用级根 prompt (20261127-upup U4) against the real Pi SDK and a local
 * OpenAI-protocol fixture: selecting an app writes `currentAppId` to settings
 * and the next new session gets the app's identity/boundary in its system prompt.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createEngineHandlers } from "@openbuddy/host/handlers";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
  decryptString: (value: Buffer) => value.toString().split("").reverse().join(""),
};
const shell = { openPath: async () => "", openExternal: async () => {}, showItemInFolder: () => {} };
type Request = { messages: Array<{ role: string; content?: unknown }> };

async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), "openbuddy-app-prompt-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: Request[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id: "fx", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: "assistant" });
    chunk({ content: "ok" });
    chunk({}, "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as { port: number }).port;
  let engine = await createEngineHandlers({ userDataDir: root, safeStorage, emit: () => {}, shell });
  cleanups.push(() => engine.dispose());
  const call = async (name: string, payload: Record<string, unknown> = {}) => engine.handlers[name]!(payload) as Promise<any>;
  await call("providers_save_provider", {
    provider: { id: "fixture", providerKind: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, apiBackend: "chat_completions", authScheme: "bearer", apiKey: "fixture-key" },
  });
  await call("providers_save_model", { model: { modelId: "fixture", providerId: "fixture", contextWindow: 32000 } });
  await call("agent_init", { cwd: root });
  const newSession = async () => (await call("agent_new_session", { cwd: root, modelId: "fixture", providerId: "fixture" })) as string;
  const restart = async () => {
    await engine.dispose();
    engine = await createEngineHandlers({ userDataDir: root, safeStorage, emit: () => {}, shell });
    cleanups.push(() => engine.dispose());
  };
  return { root, call, newSession, requests, restart };
}

const text = (content: unknown) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p: { text?: string }) => p.text ?? "").join("") : "";
const systemOf = (request: Request) => text(request.messages.find((m) => m.role === "system" || m.role === "developer")?.content);

describe("应用级根 prompt (U4)", () => {
  it("选择内置应用后，新会话的 system prompt 带上应用身份", async () => {
    const f = await fixture();
    // 基线：没选应用时不注入。
    const plainId = await f.newSession();
    await f.call("agent_send", { sessionId: plainId, text: "plain" });
    expect(systemOf(f.requests.at(-1)!)).not.toContain("当前应用：");

    const picked = await f.call("apps_set_current", { appId: "openbuddy" });
    expect(picked).toMatchObject({ appId: "openbuddy" });

    const sid = await f.newSession();
    await f.call("agent_send", { sessionId: sid, text: "hello" });
    const system = systemOf(f.requests.at(-1)!);
    expect(system).toContain("当前应用：OpenBuddy — 通用智能助手。");
    expect(system).toContain("优先使用该应用声明的场景与工具");
  });

  it("选择会持久化：重启后新会话仍然注入；未知应用被拒绝", async () => {
    const f = await fixture();
    await f.call("apps_set_current", { appId: "openbuddy" });
    await expect(f.call("apps_set_current", { appId: "nope" })).rejects.toThrow("app_not_found");

    await f.restart();
    const sid = await f.newSession();
    await f.call("agent_send", { sessionId: sid, text: "after restart" });
    expect(systemOf(f.requests.at(-1)!)).toContain("当前应用：OpenBuddy");
  });
});
