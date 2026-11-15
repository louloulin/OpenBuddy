// @vitest-environment node
// 20261116-pii W1.1: branch switcher ‹1/2› on real Pi sessions (SessionManager tree + navigateTree).
import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkFixture, until, type FixtureRequest } from "./helpers/sdk-fixture";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const lastRole = (r: FixtureRequest) => r.messages.at(-1)?.role;
const texts = (messages: any[], role: string) => messages.filter((m) => m.role === role).map((m) => (typeof m.content === "string" ? m.content : m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("")));

describe("agent_tree / agent_navigate (W1.1)", () => {
  it("regenerating twice leaves three versions; navigating shows each one's messages and new prompts continue there", async () => {
    let answers = 0;
    const f = await sdkFixture(() => ({ text: `answer ${answers++}` }), cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "first question" });
    await f.call("agent_send", { sessionId: f.sid, text: "second question" });
    let tree = (await f.call("agent_tree", { sessionId: f.sid })) as any;
    expect(tree.turns.map((t: any) => t.total)).toEqual([1, 1]);
    await f.call("agent_regenerate", { sessionId: f.sid });
    await f.call("agent_regenerate", { sessionId: f.sid });
    tree = await f.call("agent_tree", { sessionId: f.sid });
    expect(tree.turns).toHaveLength(2);
    expect(tree.turns[0]).toMatchObject({ total: 1, index: 0, siblings: [] });
    const turn = tree.turns[1];
    expect(turn).toMatchObject({ total: 3, index: 2 });
    expect(turn.siblings.map((s: any) => s.preview)).toEqual(["second question", "second question", "second question"]);
    expect(new Set(turn.siblings.map((s: any) => s.leafId)).size).toBe(3);
    expect(turn.siblings[2].leafId).toBe(tree.leafId);
    // The renderer matches turns by the user message timestamp.
    const live = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(live.messages.filter((m: any) => m.role === "user").map((m: any) => m.timestamp)).toEqual(tree.turns.map((t: any) => t.timestamp));
    expect(texts(live.messages, "assistant")).toEqual(["answer 0", "answer 3"]);

    f.events.length = 0;
    const result = (await f.call("agent_navigate", { sessionId: f.sid, entryId: turn.siblings[0].leafId })) as any;
    expect(result).toMatchObject({ navigated: true, restored: [], conflicts: [] });
    const rewound = f.events.find((e) => e.payload.event?.type === "session_rewound");
    expect(texts(rewound!.payload.event.messages, "assistant")).toEqual(["answer 0", "answer 1"]);
    let snapshot = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(texts(snapshot.messages, "user")).toEqual(["first question", "second question"]);
    expect(texts(snapshot.messages, "assistant")).toEqual(["answer 0", "answer 1"]);
    tree = await f.call("agent_tree", { sessionId: f.sid });
    expect(tree.turns[1]).toMatchObject({ total: 3, index: 0 });

    await f.call("agent_navigate", { sessionId: f.sid, entryId: turn.siblings[1].leafId });
    snapshot = await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root });
    expect(texts(snapshot.messages, "assistant")).toEqual(["answer 0", "answer 2"]);
    // A new prompt continues the version on screen; the model sees only that branch.
    await f.call("agent_send", { sessionId: f.sid, text: "third question" });
    expect(JSON.stringify(f.requests.at(-1)!.messages)).toContain("answer 2");
    expect(JSON.stringify(f.requests.at(-1)!.messages)).not.toContain("answer 3");
    tree = await f.call("agent_tree", { sessionId: f.sid });
    expect(tree.turns.map((t: any) => [t.index, t.total])).toEqual([[0, 1], [1, 3], [0, 1]]);
    // Going back to version 3 returns to where that branch was left.
    await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[1].siblings[2].leafId });
    snapshot = await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root });
    expect(texts(snapshot.messages, "assistant")).toEqual(["answer 0", "answer 3"]);

    await expect(f.call("agent_navigate", { sessionId: f.sid, entryId: "missing" })).rejects.toThrow("entry_not_found");
    expect(await f.call("agent_tree", { sessionId: "not-loaded" })).toBeNull();
  });

  it("summarizes the abandoned version on request (Pi branch summary)", async () => {
    let answers = 0;
    const f = await sdkFixture(() => ({ text: `answer ${answers++}` }), cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "question" });
    await f.call("agent_regenerate", { sessionId: f.sid });
    const tree = (await f.call("agent_tree", { sessionId: f.sid })) as any;
    const before = f.requests.length;
    const result = (await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[0].leafId, summarize: true })) as any;
    expect(result).toMatchObject({ navigated: true, summarized: true });
    expect(f.requests.length).toBe(before + 1);
    const snapshot = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    expect(snapshot.messages.map((m: any) => m.role).filter((r: string) => r !== "system")).toEqual(["user", "assistant", "branchSummary"]);
    expect(f.events.filter((e) => e.name === "agent://session-status").map((e) => e.payload.status)).toContain("running");
  });

  it("refuses to switch (or run a command) while the session is running", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let count = 0;
    const f = await sdkFixture(async () => {
      if (count++ === 2) await held;
      return { text: `answer ${count}` };
    }, cleanups);
    await f.call("agent_send", { sessionId: f.sid, text: "question" });
    await f.call("agent_regenerate", { sessionId: f.sid });
    const tree = (await f.call("agent_tree", { sessionId: f.sid })) as any;
    const running = f.call("agent_send", { sessionId: f.sid, text: "long one" });
    await until(() => f.requests.length === 3);
    await expect(f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[0].leafId })).rejects.toThrow("session_busy");
    await expect(f.call("agent_bash", { sessionId: f.sid, command: "echo hi" })).rejects.toThrow("session_busy");
    release();
    await running;
    await expect(f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[0].leafId })).resolves.toMatchObject({ navigated: true });
  });

  it("puts files back to the target version's state, all or nothing when files changed since", async () => {
    let writes = 0;
    const f = await sdkFixture((r) => (lastRole(r) === "tool" ? { text: "done" } : { toolCalls: [{ id: `w${writes}`, name: "write", arguments: { path: join(f.root, "out.txt"), content: `v${++writes}` } }] }), cleanups);
    await f.call("permission_mode_set", { mode: "always-approve" });
    await f.call("agent_send", { sessionId: f.sid, text: "make the file" });
    await f.call("agent_regenerate", { sessionId: f.sid });
    const out = join(f.root, "out.txt");
    await until(() => f.events.filter((e) => e.name === "agent://artifacts").length >= 2);
    expect(await readFile(out, "utf8")).toBe("v2");
    let tree = (await f.call("agent_tree", { sessionId: f.sid })) as any;
    expect(tree.turns[0].siblings.map((s: any) => s.files)).toEqual([[out], [out]]);
    // Without restoreFiles only the conversation moves.
    await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[0].leafId });
    expect(await readFile(out, "utf8")).toBe("v2");
    await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[1].leafId });
    let result = (await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[0].leafId, restoreFiles: true })) as any;
    expect(result).toMatchObject({ navigated: true, restored: [out] });
    expect(await readFile(out, "utf8")).toBe("v1");
    result = await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[1].leafId, restoreFiles: true });
    expect(result.restored).toEqual([out]);
    expect(await readFile(out, "utf8")).toBe("v2");
    // Changed since: nothing is written and the conversation stays until 覆盖 / 跳过.
    await writeFile(out, "edited by hand");
    result = await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[0].leafId, restoreFiles: true });
    expect(result).toEqual({ navigated: false, restored: [], conflicts: [{ path: out, reason: "changed_since" }] });
    expect(await readFile(out, "utf8")).toBe("edited by hand");
    tree = await f.call("agent_tree", { sessionId: f.sid });
    expect(tree.turns[0].index).toBe(1);
    result = await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[0].leafId, restoreFiles: { skip: [out] } });
    expect(result).toMatchObject({ navigated: true, restored: [] });
    expect(await readFile(out, "utf8")).toBe("edited by hand");
    result = await f.call("agent_navigate", { sessionId: f.sid, entryId: tree.turns[0].siblings[1].leafId, restoreFiles: { force: true } });
    expect(result).toMatchObject({ navigated: true, restored: [out] });
    expect(await readFile(out, "utf8")).toBe("v2");
    // The overwritten content was kept as a version first.
    const versions = (await f.call("checkpoint_list", { sessionId: f.sid, path: out })) as any[];
    expect(versions.some((v) => v.source === "restore")).toBe(true);
  });
});
