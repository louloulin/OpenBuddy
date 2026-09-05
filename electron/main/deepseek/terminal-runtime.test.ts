import { describe, expect, it } from "vitest";
import { createShellTerminalBackend, createTerminalService, terminalOwner, TerminalError } from "./terminal-runtime";

function context(sessionId: string, root: object = {}): { get: (key: string) => unknown; root: object } {
  const piSession = { sessionId };
  return {
    root,
    get: (key) => key === "piSession" ? piSession : undefined,
  };
}

describe("TerminalRuntime", () => {
  it("keeps a shell alive across sends and bounds ownership", async () => {
    const runtime = createTerminalService();
    runtime.registerBackend(createShellTerminalBackend());
    const root = {};
    const owner = terminalOwner(context("session-a", root));
    const foreign = terminalOwner(context("session-b", root));
    const opened = await runtime.open(owner, { type: "shell", cwd: process.cwd() });

    try {
      expect(opened.sessionId).toMatch(/^pty-/u);
      expect(runtime.list(owner)).toHaveLength(1);
      expect(runtime.list(foreign)).toHaveLength(0);
      expect(() => runtime.read(foreign, opened.sessionId)).toThrow("another owner");

      const sent = await runtime.send(owner, opened.sessionId, "printf 'openbuddy-terminal-ok'", true);
      expect(sent.viewport).toContain("openbuddy-terminal-ok");
      expect(runtime.read(owner, opened.sessionId).text).toContain("openbuddy-terminal-ok");
      const operation = runtime.startSend(owner, opened.sessionId, { text: "printf 'operation-ok'", submit: true });
      await expect(operation.done).resolves.toMatchObject({ sessionStatus: { kind: "running" } });
      expect(operation.readOutput().delta).toContain("operation-ok");
    } finally {
      await runtime.disposeOwner(owner);
      await runtime.dispose();
    }

    expect(runtime.list(owner)).toEqual([]);
  }, 30_000);

  it("closes all sessions for one owner without affecting another", async () => {
    const runtime = createTerminalService();
    runtime.registerBackend(createShellTerminalBackend());
    const root = {};
    const ownerA = terminalOwner(context("session-a", root));
    const ownerB = terminalOwner(context("session-b", root));
    const terminalA = await runtime.open(ownerA, { type: "shell" });
    const terminalB = await runtime.open(ownerB, { type: "shell" });

    try {
      await runtime.disposeOwner(ownerA);
      expect(runtime.list(ownerA)).toEqual([]);
      expect(runtime.list(ownerB)).toHaveLength(1);
      await runtime.close(ownerB, terminalB.sessionId);
    } finally {
      await runtime.dispose();
    }

    expect(terminalA.sessionId).toMatch(/^pty-/u);
  }, 30_000);

  it("exposes stable Harness-style terminal error codes", () => {
    const runtime = createTerminalService();
    return expect(runtime.open({}, { type: "missing" })).rejects.toMatchObject({ code: "NO_BACKEND" });
  });

  it("rejects duplicate backends with a machine-readable error", () => {
    const runtime = createTerminalService();
    runtime.registerBackend(createShellTerminalBackend());
    expect(() => runtime.registerBackend(createShellTerminalBackend())).toThrow(TerminalError);
  });

  it("passes shell configuration through the registered backend", async () => {
    const runtime = createTerminalService();
    runtime.registerBackend(createShellTerminalBackend("configured-shell", {
      shellPath: "/bin/bash",
      shellArgs: ["--noprofile", "--norc", "-i"],
      env: { OPENBUDDY_TERMINAL_CONFIGURED: "yes" },
    }));
    const owner = terminalOwner(context("configured-session"));
    const opened = await runtime.spawn(owner, { type: "configured-shell" });
    try {
      const result = await runtime.send(owner, opened.sessionId, "printf %s $OPENBUDDY_TERMINAL_CONFIGURED", true);
      expect(result.viewport).toContain("yes");
      expect(result.waitReason).toBe("stdin_read");
    } finally {
      await runtime.kill(owner, opened.sessionId);
      await runtime.dispose();
    }
  }, 30_000);
});
