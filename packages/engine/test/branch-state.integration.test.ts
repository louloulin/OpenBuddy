// @vitest-environment node
/**
 * Per-branch session state across moves inside the conversation tree (20261116-pii §5, W0.5,
 * W1.1, W2.2) on real Pi sessions: 重新生成 / 从这里编辑 keep what the user has selected now (mode,
 * bound expert) on the new branch, while switching versions ‹1/2› restores that version's own.
 */
import { afterEach, describe, expect, it } from "vitest";
import { sdkFixture, type FixtureRequest } from "./helpers/sdk-fixture";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const READ_ONLY = ["find", "grep", "ls", "ob_remember", "ob_todo", "read"];
const toolsOf = (request: FixtureRequest | undefined) => ((request?.tools as Array<{ function?: { name?: string } }> | undefined) ?? []).map((t) => t.function?.name).sort();
const text = (content: unknown) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((p: { text?: string }) => p.text ?? "").join("") : "");
const systemOf = (request: FixtureRequest | undefined) => text(request?.messages.find((m) => m.role === "system" || m.role === "developer")?.content);
const modelStates = (events: Array<{ name: string; payload: any }>) => events.filter((e) => e.name === "agent://model-state").map((e) => e.payload);

describe("mode across regenerate, edit-and-resend and version switches (pii W0.5 / W1.1)", () => {
  it("regenerating after switching to 问一问 runs read-only; ‹1/2› restores each version's own mode", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "first question" });
    await f.call("agent_send", { sessionId: f.sid, text: "second question" });
    expect(toolsOf(f.requests.at(-1))).toEqual(expect.arrayContaining(["bash", "edit", "write"]));

    // 问一问 is selected after the last reply; 重新生成 must run in it, not in the reply's older mode.
    await f.call("agent_set_mode", { sessionId: f.sid, mode: "ask" });
    f.events.length = 0;
    await f.call("agent_regenerate", { sessionId: f.sid });
    expect(toolsOf(f.requests.at(-1))).toEqual(READ_ONLY);
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ mode: "ask" });
    // The mode never flipped back (not even briefly) while the leaf moved.
    expect(modelStates(f.events).map((s) => s.mode)).not.toContain("craft");
    // Pi records the narrower tool loadout as a system message before the prompt; both versions still pair up ‹2/2›.
    expect(((await f.call("agent_tree", { sessionId: f.sid })) as any).turns[1]).toMatchObject({ total: 2, index: 1 });

    // 从这里编辑 + resend on the first prompt: still 问一问.
    const tree = (await f.call("agent_tree", { sessionId: f.sid })) as any;
    const { editorText } = (await f.call("rewind_execute", { sessionId: f.sid, entryId: tree.turns[0].entryId })) as { editorText: string };
    expect(editorText).toBe("first question");
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ mode: "ask" });
    await f.call("agent_send", { sessionId: f.sid, text: "first question, edited" });
    expect(toolsOf(f.requests.at(-1))).toEqual(READ_ONLY);

    // The new branch carries its mode: reopening it restores 问一问.
    await f.call("agent_shutdown");
    expect((await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })).mode).toBe("ask");

    // Switching versions restores that version's own mode, and tells the renderer.
    await f.call("agent_set_mode", { sessionId: f.sid, mode: "craft" });
    let turns = ((await f.call("agent_tree", { sessionId: f.sid })) as any).turns;
    expect(turns[0]).toMatchObject({ total: 2, index: 1 });
    f.events.length = 0;
    await f.call("agent_navigate", { sessionId: f.sid, entryId: turns[0].siblings[0].leafId });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ mode: "ask" });
    expect(modelStates(f.events).at(-1)).toMatchObject({ sessionId: f.sid, mode: "ask" });
    await f.call("agent_send", { sessionId: f.sid, text: "on the first version" });
    expect(toolsOf(f.requests.at(-1))).toEqual(READ_ONLY);
    turns = ((await f.call("agent_tree", { sessionId: f.sid })) as any).turns;
    await f.call("agent_navigate", { sessionId: f.sid, entryId: turns[0].siblings[1].leafId });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ mode: "craft" });
    await f.call("agent_send", { sessionId: f.sid, text: "on the second version" });
    expect(toolsOf(f.requests.at(-1))).toEqual(expect.arrayContaining(["bash", "edit", "write"]));
  });

  it("with mode memory switched off, regenerate keeps the in-memory mode's tools (Pi's transcript loadout never widens them)", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    await f.call("settings_agent_set", { patch: { builtins: { mode: false } } });
    await f.call("agent_send", { sessionId: f.sid, text: "first question" });
    await f.call("agent_send", { sessionId: f.sid, text: "second question" });
    await f.call("agent_set_mode", { sessionId: f.sid, mode: "ask" });
    await f.call("agent_regenerate", { sessionId: f.sid });
    expect(toolsOf(f.requests.at(-1))).toEqual(READ_ONLY);
    const turns = ((await f.call("agent_tree", { sessionId: f.sid })) as any).turns;
    await f.call("agent_navigate", { sessionId: f.sid, entryId: turns[1].siblings[0].leafId });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ mode: "ask" });
    await f.call("agent_send", { sessionId: f.sid, text: "third question" });
    expect(toolsOf(f.requests.at(-1))).toEqual(READ_ONLY);
  });
});

describe("expert binding across branches (pii W2.2)", () => {
  it("a version from before the binding runs without the expert's model / thinking / tools; regenerate and edit keep the bound expert", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    await f.call("providers_save_model", { model: { modelId: "reasoning", providerId: "fixture", reasoning: true, compat: { supportsReasoningEffort: true } } });
    const expert = (await f.call("agents_save", {
      expert: { name: "Branch Tester", model: "fixture/reasoning", thinking: "high", tools: ["read", "grep"], prompt: "BRANCH-PERSONA-MARKER" },
      mode: "create",
    })) as { id: string };
    await f.call("agent_send", { sessionId: f.sid, text: "plain question" });
    await f.call("agent_regenerate", { sessionId: f.sid });
    await f.call("agent_set_session_expert", { sessionId: f.sid, expertId: expert.id });
    await f.call("agent_send", { sessionId: f.sid, text: "expert question" });
    expect(systemOf(f.requests.at(-1))).toContain("BRANCH-PERSONA-MARKER");
    expect(f.requests.at(-1)!.model).toBe("reasoning");

    // ‹1/2› back to the version from before the binding: the task's own model, thinking and tools.
    let turns = ((await f.call("agent_tree", { sessionId: f.sid })) as any).turns;
    f.events.length = 0;
    await f.call("agent_navigate", { sessionId: f.sid, entryId: turns[0].siblings[0].leafId });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ modelId: "fixture", thinkingLevel: "off", expert: null });
    // The renderer's badge follows the model-state event.
    expect(modelStates(f.events).at(-1)).toMatchObject({ sessionId: f.sid, modelId: "fixture", expert: null });
    expect((await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })).expert).toBeNull();
    await f.call("agent_send", { sessionId: f.sid, text: "on the plain version" });
    expect(systemOf(f.requests.at(-1))).not.toContain("专家人设");
    expect(f.requests.at(-1)!.model).toBe("fixture");
    expect(toolsOf(f.requests.at(-1))).toEqual(expect.arrayContaining(["bash", "edit", "write"]));

    // And forward again to the bound version: the expert applies again.
    turns = ((await f.call("agent_tree", { sessionId: f.sid })) as any).turns;
    f.events.length = 0;
    await f.call("agent_navigate", { sessionId: f.sid, entryId: turns[0].siblings[1].leafId });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ modelId: "reasoning", thinkingLevel: "high", expert: { id: expert.id } });
    expect(modelStates(f.events).at(-1)).toMatchObject({ expert: { id: expert.id, name: "Branch Tester" } });
    await f.call("agent_send", { sessionId: f.sid, text: "back on the expert version" });
    expect(systemOf(f.requests.at(-1))).toContain("BRANCH-PERSONA-MARKER");
    expect(f.requests.at(-1)!.model).toBe("reasoning");
    expect(toolsOf(f.requests.at(-1))).toEqual(["grep", "ob_app_recommend", "ob_docx", "ob_pptx", "ob_remember", "ob_subagent", "ob_todo", "ob_xlsx", "read"]);

    // 重新生成 keeps the bound expert.
    await f.call("agent_regenerate", { sessionId: f.sid });
    expect(systemOf(f.requests.at(-1))).toContain("BRANCH-PERSONA-MARKER");
    expect(toolsOf(f.requests.at(-1))).toEqual(["grep", "ob_app_recommend", "ob_docx", "ob_pptx", "ob_remember", "ob_subagent", "ob_todo", "ob_xlsx", "read"]);

    // 从这里编辑 on the first prompt goes back before the binding; the expert the user has bound stays.
    turns = ((await f.call("agent_tree", { sessionId: f.sid })) as any).turns;
    await f.call("rewind_execute", { sessionId: f.sid, entryId: turns[0].entryId });
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ modelId: "reasoning", expert: { id: expert.id } });
    await f.call("agent_send", { sessionId: f.sid, text: "plain question, edited" });
    expect(systemOf(f.requests.at(-1))).toContain("BRANCH-PERSONA-MARKER");
    expect(f.requests.at(-1)!.model).toBe("reasoning");
    expect(toolsOf(f.requests.at(-1))).toEqual(["grep", "ob_app_recommend", "ob_docx", "ob_pptx", "ob_remember", "ob_subagent", "ob_todo", "ob_xlsx", "read"]);
    // The re-asserted binding is on the new branch: it survives a reopen.
    await f.call("agent_shutdown");
    expect((await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })).expert).toMatchObject({ id: expert.id });
  });
});
