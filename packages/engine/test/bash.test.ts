// @vitest-environment node
// 20261116-pii W1.2: `!command` / `!!command` through the real AgentSession.executeBash.
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkFixture, until, requestText } from "./helpers/sdk-fixture";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const exists = (path: string) => stat(path).then(() => true, () => false);
const bashEvents = (events: Array<{ name: string; payload: any }>) => events.filter((e) => e.name === "agent://event" && String(e.payload.event?.type).startsWith("bash_execution")).map((e) => e.payload.event);

describe("agent_bash (W1.2)", () => {
  it("`!cmd` output reaches the model with the next prompt; `!!cmd` output never does", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    const shown = (await f.call("agent_bash", { sessionId: f.sid, command: "echo hello-in-context" })) as any;
    expect(shown).toMatchObject({ exitCode: 0, cancelled: false, excludeFromContext: false });
    expect(shown.output).toContain("hello-in-context");
    const events = bashEvents(f.events);
    expect(events.map((e) => e.type)[0]).toBe("bash_execution_start");
    expect(events.at(-1)).toMatchObject({ type: "bash_execution_end", id: shown.id, command: "echo hello-in-context", exitCode: 0, excludeFromContext: false });
    expect(events.filter((e) => e.type === "bash_execution_update").map((e) => e.delta).join("")).toContain("hello-in-context");
    expect(events.every((e) => e.id === shown.id)).toBe(true);

    const hidden = (await f.call("agent_bash", { sessionId: f.sid, command: "echo private-output", excludeFromContext: true })) as any;
    expect(hidden).toMatchObject({ exitCode: 0, excludeFromContext: true });
    expect(hidden.output).toContain("private-output");
    // Both are in the session history (the renderer replays them), only one is model context.
    const snapshot = (await f.call("agent_load_session", { sessionId: f.sid, cwd: f.root })) as any;
    const runs = snapshot.messages.filter((m: any) => m.role === "bashExecution");
    expect(runs.map((m: any) => [m.command, m.excludeFromContext ?? false])).toEqual([["echo hello-in-context", false], ["echo private-output", true]]);
    expect(f.requests).toHaveLength(0);
    await f.call("agent_send", { sessionId: f.sid, text: "what did the command print?" });
    expect(requestText(f.requests.at(-1))).toContain("hello-in-context");
    expect(requestText(f.requests.at(-1))).not.toContain("private-output");
    // A failing command still reports its exit code.
    const failed = (await f.call("agent_bash", { sessionId: f.sid, command: "exit 3" })) as any;
    expect(failed.exitCode).toBe(3);
  });

  it("stops a running command (agent_bash_abort, and 停止)", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    const started = Date.now();
    const run = f.call("agent_bash", { sessionId: f.sid, command: "echo begin; sleep 8; echo never-printed" }) as Promise<any>;
    await until(() => bashEvents(f.events).some((e) => e.type === "bash_execution_update" && e.delta.includes("begin")));
    // A second command cannot start while one runs.
    await expect(f.call("agent_bash", { sessionId: f.sid, command: "echo two" })).rejects.toThrow("bash_running");
    await f.call("agent_bash_abort", { sessionId: f.sid });
    const result = await run;
    expect(result.cancelled).toBe(true);
    expect(result.output).not.toContain("never-printed");
    expect(Date.now() - started).toBeLessThan(6000);
    expect(bashEvents(f.events).at(-1)).toMatchObject({ type: "bash_execution_end", cancelled: true });
    // agent_cancel (the composer's stop) aborts a command too.
    const second = f.call("agent_bash", { sessionId: f.sid, command: "sleep 8" }) as Promise<any>;
    await until(() => bashEvents(f.events).filter((e) => e.type === "bash_execution_start").length === 2);
    await f.call("agent_cancel", { sessionId: f.sid });
    expect((await second).cancelled).toBe(true);
  });

  it("`rm -rf` waits for the strong confirmation, whatever the permission mode; deny rules apply", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    const victim = join(f.root, "victim");
    await mkdir(victim);
    await writeFile(join(victim, "keep.txt"), "data");
    // Ordinary commands the user typed run without a card (the Enter was the approval).
    await expect(f.call("agent_bash", { sessionId: f.sid, command: "echo fine" })).resolves.toMatchObject({ exitCode: 0 });
    expect(f.events.some((e) => e.name === "agent://permission")).toBe(false);

    const denied = f.call("agent_bash", { sessionId: f.sid, command: "rm -rf victim" });
    await until(() => f.events.some((e) => e.name === "agent://permission"));
    const request = f.events.find((e) => e.name === "agent://permission")!.payload;
    expect(request.toolCallId).toMatch(/^user-bash:/);
    expect(request.destructive).toMatchObject({ command: "rm -rf victim", paths: ["victim"] });
    expect(request.options.map((o: any) => o.optionId)).toEqual(["allow", "deny"]);
    expect(await exists(victim)).toBe(true);
    // A typed command can never be granted for later (that would also let the agent's bash through).
    await expect(f.call("agent_resolve_permission", { requestId: request.requestId, optionId: "allow_session" })).rejects.toThrow("无效的权限选项");
    await f.call("agent_resolve_permission", { requestId: request.requestId, optionId: "deny" });
    await expect(denied).rejects.toThrow("permission_denied");
    expect(await exists(victim)).toBe(true);
    expect(bashEvents(f.events).filter((e) => e.type === "bash_execution_start")).toHaveLength(1);

    await f.call("permission_mode_set", { mode: "always-approve" });
    f.events.length = 0;
    const allowed = f.call("agent_bash", { sessionId: f.sid, command: "rm -rf victim" });
    await until(() => f.events.some((e) => e.name === "agent://permission"));
    await f.call("agent_resolve_permission", { requestId: f.events.find((e) => e.name === "agent://permission")!.payload.requestId, optionId: "allow" });
    await expect(allowed).resolves.toMatchObject({ exitCode: 0 });
    expect(await exists(victim)).toBe(false);

    // The renderer's risk reading can only add the confirmation, never remove it.
    f.events.length = 0;
    const risky = f.call("agent_bash", { sessionId: f.sid, command: "echo pretend-reset", risk: "high" });
    await until(() => f.events.some((e) => e.name === "agent://permission"));
    await f.call("agent_resolve_permission", { requestId: f.events.find((e) => e.name === "agent://permission")!.payload.requestId, optionId: "deny" });
    await expect(risky).rejects.toThrow("permission_denied");

    await f.call("permission_save", { rules: [{ action: "deny", tool: "bash", pattern: "curl" }] });
    f.events.length = 0;
    await expect(f.call("agent_bash", { sessionId: f.sid, command: "curl http://127.0.0.1:9" })).rejects.toThrow("permission_denied");
    expect(f.events.some((e) => e.name === "agent://permission")).toBe(false);
    expect(bashEvents(f.events)).toEqual([]);
  });
});
