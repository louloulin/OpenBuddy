// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CheckpointStore } from "../checkpoints.js";
import { collectArtifacts } from "../artifacts.js";
import { Permissions, destructiveInfo } from "../permissions.js";
import { PiEngine, partialToolArgs, slimEvent } from "../pi.js";
import { createSettings } from "@openbuddy/services/settings";
import { allowedPreviewPath, previewPath, previewResponse, PREVIEW_CSP } from "@openbuddy/services/preview-protocol";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
async function tmp(prefix = "ob-ckpt-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function store() {
  const root = await tmp();
  const work = await tmp("ob-work-");
  const trashed: string[] = [];
  const s = new CheckpointStore(join(root, "ckpt"), async (p) => { trashed.push(p); await rm(p); });
  return { s, work, trashed, root: join(root, "ckpt") };
}

it("records before/after only when a tool really changed the file", async () => {
  const { s, work } = await store();
  const file = join(work, "a.md");
  await writeFile(file, "one\n");
  await s.begin("sid", "t1", file);
  await writeFile(file, "two\n");
  const record = await s.finish("t1");
  expect(record?.before).toMatch(/^[a-f0-9]{64}$/);
  expect(record?.after).not.toBe(record?.before);
  expect((await s.read("sid", record!.before!)).text).toBe("one\n");
  // Unchanged → no record.
  await s.begin("sid", "t2", file);
  expect(await s.finish("t2")).toBeUndefined();
  expect(await s.list("sid")).toHaveLength(1);
  // Never-run calls leave nothing.
  await s.begin("sid", "t3", file);
  s.discard("t3");
  expect(await s.finish("t3")).toBeUndefined();
});

it("keeps every record when parallel tool calls finish at the same time", async () => {
  const { s, work, root } = await store();
  const files = ["a.md", "b.html", "c.csv", "d.json"].map((f) => join(work, f));
  await Promise.all(files.map((f, i) => s.begin("sid", `t${i}`, f)));
  await Promise.all(files.map((f) => writeFile(f, f)));
  await Promise.all(files.map((_, i) => s.finish(`t${i}`)));
  const list = await s.list("sid");
  expect(list.map((r) => r.toolCallId).sort()).toEqual(["t0", "t1", "t2", "t3"]);
  expect(list.every((r) => r.before === null)).toBe(true);
  // And the persisted index has all of them too.
  expect(await new CheckpointStore(root, async () => {}).list("sid")).toHaveLength(4);
});

it("restores a created file by moving it to the trash and keeps the current content first", async () => {
  const { s, work, trashed } = await store();
  const file = join(work, "new.txt");
  await s.begin("sid", "t1", file);
  await writeFile(file, "made by agent");
  const record = await s.finish("t1");
  expect(record?.before).toBeNull();
  await s.restore("sid", file, null);
  expect(trashed).toEqual([file]);
  const restore = (await s.list("sid", file)).find((r) => r.source === "restore")!;
  expect(restore.before).toBe(record!.after);
  expect((await s.read("sid", restore.before!)).text).toBe("made by agent");
});

it("reverts a turn oldest-first and refuses to overwrite later edits unless forced", async () => {
  const { s, work } = await store();
  const file = join(work, "doc.md");
  await writeFile(file, "v0");
  await s.begin("sid", "a", file); await writeFile(file, "v1"); await s.finish("a");
  await s.begin("sid", "b", file); await writeFile(file, "v2"); await s.finish("b");
  await writeFile(file, "user edit");
  const first = await s.revert("sid", ["a", "b"]);
  expect(first.conflicts).toEqual([{ path: file, reason: "changed_since" }]);
  expect(await readFile(file, "utf8")).toBe("user edit");
  const forced = await s.revert("sid", ["a", "b"], { force: true });
  expect(forced.restored).toEqual([file]);
  expect(await readFile(file, "utf8")).toBe("v0");
});

it("persists the index and validates hashes and session ids", async () => {
  const root = await tmp();
  const work = await tmp("ob-work-");
  const file = join(work, "x.txt");
  const a = new CheckpointStore(root, async () => {});
  await a.userSave("sid", file, "hello");
  const b = new CheckpointStore(root, async () => {});
  expect((await b.list("sid"))[0]).toMatchObject({ source: "user", before: null, path: file });
  await expect(b.read("sid", "../../etc/passwd")).rejects.toThrow("hash");
  await expect(b.list("../evil")).rejects.toThrow("sessionId");
});

it("skips files over the size limit instead of copying them", async () => {
  const root = await tmp();
  const work = await tmp("ob-work-");
  const file = join(work, "big.bin");
  await writeFile(file, Buffer.alloc(2048));
  const s = new CheckpointStore(root, async () => {}, { maxFile: 1024, quota: 1e9 });
  await s.begin("sid", "t", file);
  await writeFile(file, Buffer.alloc(4096));
  const record = await s.finish("t");
  expect(record?.skipped).toBe("too_large");
  expect((await s.revert("sid", ["t"])).conflicts[0].reason).toBe("missing_snapshot");
});

it("collects only written/edited files, merges per path and marks created ones", async () => {
  const work = await tmp("ob-work-");
  await writeFile(join(work, "report.md"), "# r\n");
  const entries = [
    { type: "message", message: { role: "assistant", timestamp: 1, content: [
      { type: "toolCall", id: "r1", name: "read", arguments: { path: "notes.txt" } },
      { type: "toolCall", id: "w1", name: "write", arguments: { path: "report.md", content: "a\nb\n" } },
    ] } },
    { type: "message", message: { role: "toolResult", toolCallId: "w1", isError: false } },
    { type: "message", message: { role: "assistant", timestamp: 2, content: [
      { type: "toolCall", id: "e1", name: "edit", arguments: { path: join(work, "report.md") } },
      { type: "toolCall", id: "e2", name: "edit", arguments: { path: "broken.md" } },
    ] } },
    { type: "message", message: { role: "toolResult", toolCallId: "e1", details: { diff: "--- a\n+++ b\n-a\n+c\n+d\n" } } },
    { type: "message", message: { role: "toolResult", toolCallId: "e2", isError: true } },
  ];
  const list = await collectArtifacts(entries, work, [
    { id: "1", toolCallId: "w1", path: join(work, "report.md"), before: null, after: "x".repeat(64), at: 1, source: "tool" },
  ]);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ path: join(work, "report.md"), status: "created", toolCallIds: ["w1", "e1"], added: 4, removed: 1, exists: true });
});

it("asks harder for deletions, records 始终允许 as a rule and passes the deny reason", async () => {
  expect(destructiveInfo("bash", { command: "ls && rm -rf build dist" })).toEqual({ command: "ls && rm -rf build dist", paths: ["build", "dist"] });
  expect(destructiveInfo("bash", { command: "echo rmdir-ish" })).toBeUndefined();
  const root = await tmp();
  const settings = createSettings(root, { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
  const events: Array<{ name: string; p: any }> = [];
  const permissions = new Permissions(settings, (name, p) => events.push({ name, p }));
  const destructive = permissions.decision("s", "t0", "bash", { command: "rm -rf out" });
  const card = events.at(-1)!.p;
  expect(card.destructive.paths).toEqual(["out"]);
  expect(card.options.map((o: any) => o.optionId)).not.toContain("allow_always");
  permissions.resolve(card.requestId, "deny", false, "  先备份再删  ");
  expect(await destructive).toEqual({ allow: false, note: "先备份再删" });

  const write = permissions.decision("s", "t1", "write", { path: "docs/a.md" });
  permissions.resolve(events.at(-1)!.p.requestId, "allow_always", false);
  expect((await write).allow).toBe(true);
  expect(settings.config.read().rules).toContainEqual({ action: "allow", tool: "write", pattern: "docs/a.md" });
  expect(permissions.decide("other-session", "write", { path: "docs/a.md" })).toBe(true);
});

it("slims tool progress events and extracts streamed tool targets", () => {
  expect(slimEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: "x".repeat(9999) } } as never)).toBeUndefined();
  const update = slimEvent({ type: "tool_execution_update", toolCallId: "t", toolName: "bash", args: { command: "x" }, partialResult: { content: [{ type: "text", text: "y".repeat(20000) }] } } as never) as any;
  expect(update.args).toBeUndefined();
  expect(update.partialResult.content[0].text.length).toBeLessThanOrEqual(8 * 1024);
  expect(partialToolArgs('{"path":"src/a\\u0020b.ts","content":"lo')).toEqual({ path: "src/a b.ts" });
  expect(partialToolArgs('{"command":"npm run bu')).toEqual({ command: "npm run bu" });
});

it("serves previews only from inside the workspace, never through traversal or symlinks", async () => {
  const work = await tmp("ob-work-");
  const outside = await tmp("ob-out-");
  await mkdir(join(work, "site"));
  await writeFile(join(work, "site", "index.html"), "<h1>hi</h1>");
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(join(outside, "secret.txt"), join(work, "link.txt"));
  const url = (p: string) => "ob-preview://local/" + p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  expect(previewPath(url(join(work, "site", "index.html")), "linux")).toBe(join(work, "site", "index.html"));
  expect(previewPath("ob-preview://local/C%3A/Users/a.html", "win32")).toBe("C:\\Users\\a.html");
  // The URL parser folds %2E%2E segments; the root check is what stops them.
  expect((await previewResponse("ob-preview://local" + work + "/%2E%2E/%2E%2E/etc/passwd", [work])).status).toBe(403);
  expect(previewPath("ob-preview://evil/tmp/x", "linux")).toBeNull();
  expect(await allowedPreviewPath(join(work, "link.txt"), [work])).toBeNull();
  expect(await allowedPreviewPath(join(outside, "secret.txt"), [work])).toBeNull();

  const ok = await previewResponse(url(join(work, "site", "index.html")), [work]);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toContain("text/html");
  expect(ok.headers.get("content-security-policy")).toBe(PREVIEW_CSP);
  expect(await ok.text()).toBe("<h1>hi</h1>");
  expect((await previewResponse(url(join(outside, "secret.txt")), [work])).status).toBe(403);
  expect((await previewResponse(url(join(work, "link.txt")), [work])).status).toBe(403);
});

it("sends big tool arguments and finished blocks across IPC only once (message_end)", () => {
  const big = { path: "out/big.txt", content: "x".repeat(1024 * 1024) };
  const delta = slimEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi", partial: { usage: { input: 1 } } } } as never) as any;
  expect(delta).toEqual({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi" } });
  const end = slimEvent({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "hi there" } } as never) as any;
  expect(end.assistantMessageEvent.content).toBeUndefined();
  const callEnd = slimEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { type: "toolCall", id: "w", name: "write", arguments: big } } } as never) as any;
  expect(callEnd.assistantMessageEvent.toolCall).toEqual({ type: "toolCall", id: "w", name: "write", arguments: { path: "out/big.txt" } });
  const start = slimEvent({ type: "tool_execution_start", toolCallId: "w", toolName: "write", args: big } as never) as any;
  expect(start).toEqual({ type: "tool_execution_start", toolCallId: "w", toolName: "write" });
  const small = { type: "tool_execution_start", toolCallId: "r", toolName: "read", args: { path: "a.md" } };
  expect(slimEvent(small as never)).toBe(small);
});

it("merges text deltas per block without reordering events", () => {
  vi.useFakeTimers();
  try {
    const sent: any[] = [];
    const engine = Object.create(PiEngine.prototype) as any;
    engine.emit = (name: string, payload: any) => { if (name === "agent://event") sent.push(payload.event); };
    const slot = { id: "s" } as any;
    const text = (delta: string, type = "text_delta", contentIndex = 0) => ({ type: "message_update", assistantMessageEvent: { type, contentIndex, delta } });
    engine.emitEvent(slot, text("He"));           // leading edge: sent at once
    engine.emitEvent(slot, text("ll"));
    engine.emitEvent(slot, text("o"));
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(16);
    expect(sent.map((e) => e.assistantMessageEvent.delta)).toEqual(["He", "llo"]);
    engine.emitEvent(slot, text("想", "thinking_delta", 1));
    engine.emitEvent(slot, text("一想", "thinking_delta", 1));
    engine.emitEvent(slot, text("!", "text_delta", 2)); // another block flushes the pending one
    engine.emitEvent(slot, { type: "message_end", message: { role: "assistant" } });
    expect(sent.slice(2).map((e) => e.assistantMessageEvent?.delta ?? e.type)).toEqual(["想一想", "!", "message_end"]);
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(5);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the sidebar title and the thinking control in sync with Pi session events", () => {
  const sent: Array<{ name: string; payload: any }> = [];
  const engine = Object.create(PiEngine.prototype) as any;
  engine.emit = (name: string, payload: any) => sent.push({ name, payload });
  engine.metadata = vi.fn();
  engine.invalidateList = vi.fn();
  engine.modelState = (id: string) => ({ sessionId: id, thinkingLevel: "high" });
  const slot = { id: "s" } as any;
  engine.onEvent(slot, { type: "session_info_changed", name: " 季度报告 " });
  engine.onEvent(slot, { type: "thinking_level_changed", level: "high" });
  expect(sent.filter((e) => e.name !== "agent://event")).toEqual([
    { name: "agent://summary", payload: { sessionId: "s", title: "季度报告" } },
    { name: "agent://model-state", payload: { sessionId: "s", thinkingLevel: "high" } },
  ]);
  expect(engine.metadata).toHaveBeenCalledWith("s", { title: "季度报告" });
});

it("replaces the pending queue in the new order (withdraw / 立即插话 / move)", async () => {
  const steering: string[] = ["旧插话"], followUp: string[] = ["a", "b"];
  const session = {
    clearQueue: () => { const r = { steering: steering.splice(0), followUp: followUp.splice(0) }; return r; },
    steer: async (t: string) => { steering.push(t); },
    followUp: async (t: string) => { followUp.push(t); },
    getSteeringMessages: () => steering,
    getFollowUpMessages: () => followUp,
  };
  const engine = Object.create(PiEngine.prototype) as any;
  const slot = { id: "s", busy: true, session };
  engine.slot = () => slot;
  engine.live = () => session;
  expect(await engine.setQueue("s", ["b"], ["a"])).toEqual({ steering: ["b"], followUp: ["a"] });
  // Nothing running: the queue is only cleared.
  slot.busy = false;
  expect(await engine.setQueue("s", ["x"], [])).toEqual({ steering: [], followUp: [] });
});

it("lists 「应用」 writes as artifacts and keeps them restorable (U1.7)", async () => {
  const { s, work } = await store();
  const file = join(work, "notes", "meeting.md");
  await s.userSave("sid", file, "# 纪要\n", "apply");
  await s.userSave("sid", join(work, "hand.md"), "x", "user");
  const records = await s.list("sid");
  expect(records.map((r) => r.source).sort()).toEqual(["apply", "user"]);
  const list = await collectArtifacts([], work, records);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ path: file, status: "created", applied: true, exists: true, toolCallIds: [] });
  // Overwriting through 「应用」 again: modified, and the first version can be restored.
  await s.userSave("sid", file, "# 纪要 v2\n", "apply");
  const apply = (await s.list("sid", file)).filter((r) => r.source === "apply");
  expect(apply).toHaveLength(2);
  expect((await s.read("sid", apply[1].before!)).text).toBe("# 纪要\n");
});
