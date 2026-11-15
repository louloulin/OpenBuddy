// @vitest-environment node
/**
 * 专家人设 (20261116-pii W2.2) against the real Pi SDK and a local OpenAI-protocol fixture:
 * the persona reaches the model's system prompt, the expert's model / thinking / tools apply,
 * the binding survives a restart and forks, and clearing restores the session.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
type Request = { model: string; messages: Array<{ role: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }>; reasoning_effort?: string };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-persona-"));
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
    provider: { id: "fixture", providerKind: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, apiBackend: "chat_completions", authScheme: "bearer", apiKey: "test-key" },
  });
  await call("providers_save_model", { model: { modelId: "fixture", providerId: "fixture", contextWindow: 32000 } });
  await call("providers_save_model", { model: { modelId: "reasoning", providerId: "fixture", reasoning: true, compat: { supportsReasoningEffort: true } } });
  await call("agent_init", { cwd: root });
  const sid = (await call("agent_new_session", { cwd: root, modelId: "fixture", providerId: "fixture" })) as string;
  const restart = async () => {
    await engine.dispose();
    engine = await createEngineHandlers({ userDataDir: root, safeStorage, emit: () => {}, shell });
    cleanups.push(() => engine.dispose());
  };
  return { root, call, sid, requests, restart };
}

const text = (content: unknown) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p: { text?: string }) => p.text ?? "").join("") : "";
const systemOf = (request: Request) => text(request.messages.find((m) => m.role === "system" || m.role === "developer")?.content);
const toolsOf = (request: Request) => (request.tools ?? []).map((t) => t.function?.name).sort();

describe("expert persona built-in (pii W2.2)", () => {
  it("appends the persona, applies model / thinking / tools, survives restart and forks, and clearing restores", async () => {
    const f = await fixture();
    await f.call("agent_send", { sessionId: f.sid, text: "before" });
    const plain = systemOf(f.requests.at(-1)!);
    expect(plain).not.toContain("专家人设");
    expect(toolsOf(f.requests.at(-1)!)).toEqual(expect.arrayContaining(["bash", "edit", "read", "write"]));

    const expert = await f.call("agents_save", {
      expert: { name: "Persona Tester", avatar: "🧪", model: "fixture/reasoning", thinking: "high", tools: ["read", "grep"], prompt: "PERSONA-MARKER：你是一名测试专家，回答前先说明依据。" },
      mode: "create",
    });
    expect(expert.id).toBe("persona-tester");
    const bound = await f.call("agent_set_session_expert", { sessionId: f.sid, expertId: expert.id });
    expect(bound).toMatchObject({ sessionId: f.sid, id: "persona-tester", name: "Persona Tester", avatar: "🧪", scope: "user", warnings: [] });
    expect(bound.applied).toEqual({ model: "model:fixture/reasoning", thinking: "high", tools: ["read", "grep"] });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ modelId: "reasoning", thinkingLevel: "high" });

    await f.call("agent_send", { sessionId: f.sid, text: "hello expert" });
    let request = f.requests.at(-1)!;
    let system = systemOf(request);
    expect(system).toContain("## 专家人设：Persona Tester");
    expect(system).toContain("PERSONA-MARKER");
    // Appended, never replacing: Pi's own prompt is still the head of the system prompt.
    const head = plain.slice(0, plain.indexOf("<tools>"));
    expect(head.length).toBeGreaterThan(20);
    expect(system.startsWith(head)).toBe(true);
    expect(system.indexOf("<cwd>")).toBeGreaterThan(0);
    expect(system.indexOf("<cwd>")).toBeLessThan(system.indexOf("## 专家人设"));
    // The prompt's own tool list follows the expert's allowlist.
    expect(system).toContain("- grep:");
    expect(system).not.toContain("- bash:");
    expect(request.model).toBe("reasoning");
    expect(toolsOf(request)).toEqual(["grep", "read"]);

    // A mode switch resets the mode's tools; the next run is still narrowed to the expert's.
    await f.call("agent_set_mode", { sessionId: f.sid, mode: "craft" });
    await f.call("agent_send", { sessionId: f.sid, text: "after mode switch" });
    expect(toolsOf(f.requests.at(-1)!)).toEqual(["grep", "read"]);

    // Reopening (full engine restart) keeps the binding: it lives in the session's entries.
    await f.restart();
    const snapshot = await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root });
    expect(snapshot.expert).toMatchObject({ id: "persona-tester", name: "Persona Tester" });
    expect(snapshot).toMatchObject({ modelId: "reasoning", thinkingLevel: "high" });
    await f.call("agent_send", { sessionId: f.sid, text: "after restart" });
    expect(systemOf(f.requests.at(-1)!)).toContain("PERSONA-MARKER");
    expect(toolsOf(f.requests.at(-1)!)).toEqual(["grep", "read"]);

    // Forks inherit the binding.
    const fork = await f.call("agent_fork_session", { sessionId: f.sid });
    expect((await f.call("agent_load_session", { sessionId: fork, cwd: f.root })).expert).toMatchObject({ id: "persona-tester" });
    await f.call("agent_send", { sessionId: fork, text: "in the fork" });
    expect(systemOf(f.requests.at(-1)!)).toContain("PERSONA-MARKER");

    // Clearing restores model, thinking and tools; the persona is gone from the next request.
    expect(await f.call("agent_clear_session_expert", { sessionId: f.sid })).toBe(true);
    expect(await f.call("agent_clear_session_expert", { sessionId: f.sid })).toBe(false);
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ modelId: "fixture", thinkingLevel: "off" });
    expect((await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })).expert).toBeNull();
    await f.call("agent_send", { sessionId: f.sid, text: "after clear" });
    request = f.requests.at(-1)!;
    system = systemOf(request);
    expect(system).not.toContain("专家人设");
    expect(request.model).toBe("fixture");
    expect(toolsOf(request)).toEqual(expect.arrayContaining(["bash", "edit", "read", "write"]));
    // The fork keeps its own binding.
    expect((await f.call("agent_load_session", { sessionId: fork, cwd: f.root })).expert).toMatchObject({ id: "persona-tester" });
  });

  it("binds built-in and trusted project experts, reports what it could not apply, and rejects the rest", async () => {
    const f = await fixture();
    const reviewer = await f.call("agent_set_session_expert", { sessionId: f.sid, expertId: "code-reviewer" });
    expect(reviewer).toMatchObject({ id: "code-reviewer", scope: "builtin", avatar: "🔍", warnings: ["thinking_unsupported"] });
    expect(reviewer.applied.tools.sort()).toEqual(["find", "grep", "ls", "read"]);
    await f.call("agent_send", { sessionId: f.sid, text: "review" });
    expect(systemOf(f.requests.at(-1)!)).toContain("## 专家人设：代码审查员");

    // Switching experts replaces the persona (one binding at a time).
    const saved = await f.call("agents_save", { expert: { name: "Model Less", model: "nowhere/none", prompt: "SECOND-PERSONA" } });
    expect((await f.call("agent_set_session_expert", { sessionId: f.sid, expertId: saved.id })).warnings).toEqual(["model_unavailable"]);
    await f.call("agent_send", { sessionId: f.sid, text: "second" });
    const system = systemOf(f.requests.at(-1)!);
    expect(system).toContain("SECOND-PERSONA");
    expect(system).not.toContain("代码审查员");
    expect(toolsOf(f.requests.at(-1)!)).toEqual(expect.arrayContaining(["bash", "write"]));

    await expect(f.call("agent_set_session_expert", { sessionId: f.sid, expertId: "missing" })).rejects.toThrow("expert_not_found");
    await expect(f.call("agent_set_session_expert", { sessionId: "not-loaded", expertId: "translator" })).rejects.toThrow("session_not_loaded");

    // Project experts (`<cwd>/.pi/agents`) bind only once the folder is trusted.
    await mkdir(join(f.root, ".pi", "agents"), { recursive: true });
    await writeFile(join(f.root, ".pi", "agents", "repo-guide.md"), "---\nname: 仓库向导\n---\nPROJECT-PERSONA");
    await expect(f.call("agent_set_session_expert", { sessionId: f.sid, expertId: "repo-guide" })).rejects.toThrow("expert_not_found");
    expect((await f.call("experts_load", { cwd: f.root })).projectTrusted).toBe(false);
    await f.call("folder_trust_respond", { cwd: f.root, trusted: true });
    expect((await f.call("experts_load", { cwd: f.root })).experts.some((e: { id: string }) => e.id === "repo-guide")).toBe(true);
    expect(await f.call("agent_set_session_expert", { sessionId: f.sid, expertId: "repo-guide" })).toMatchObject({ scope: "project" });
    await f.call("agent_send", { sessionId: f.sid, text: "project" });
    expect(systemOf(f.requests.at(-1)!)).toContain("PROJECT-PERSONA");
  });
});
