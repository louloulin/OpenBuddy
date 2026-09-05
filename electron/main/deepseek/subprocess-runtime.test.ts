import { describe, expect, it } from "vitest";
import { SandboxPolicyService, SandboxRuntime, SubprocessRuntime, scrubbedParentEnv } from "./subprocess-runtime";

describe("SubprocessRuntime", () => {
  it("scrubs ambient credentials and resolves executables", async () => {
    const previousSecret = process.env.OPENBUDDY_TEST_SECRET;
    const previousHarness = process.env.DSH_TEST_VALUE;
    process.env.OPENBUDDY_TEST_SECRET = "hidden";
    process.env.DSH_TEST_VALUE = "hidden";
    try {
      const environment = scrubbedParentEnv();
      expect(environment.OPENBUDDY_TEST_SECRET).toBeUndefined();
      expect(environment.DSH_TEST_VALUE).toBeUndefined();
      await expect(new SubprocessRuntime().resolveExecutable("node")).resolves.toMatch(/node/u);
    } finally {
      if (previousSecret === undefined) delete process.env.OPENBUDDY_TEST_SECRET;
      else process.env.OPENBUDDY_TEST_SECRET = previousSecret;
      if (previousHarness === undefined) delete process.env.DSH_TEST_VALUE;
      else process.env.DSH_TEST_VALUE = previousHarness;
    }
  });

  it("supports collected output and tree-scoped disposal", async () => {
    const runtime = new SubprocessRuntime();
    const handle = runtime.spawn({
      argv: [process.execPath, "-e", "process.stdout.write('subprocess-ok')"],
      cwd: process.cwd(),
      stdio: { stdin: "ignore", stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
      graceMs: 500,
    });
    await expect(handle.done).resolves.toMatchObject({ exitCode: 0, signal: null });
    expect(handle.collected.stdout().text).toContain("subprocess-ok");
    expect(handle.collected.stdout.readFrom(0)).toMatchObject({ text: "subprocess-ok", nextOffset: Buffer.byteLength("subprocess-ok"), lossy: false });
    await runtime.dispose();
  });

  it("keeps collected readers offset-addressable in UTF-8 bytes", async () => {
    const runtime = new SubprocessRuntime();
    const handle = runtime.spawn({
      argv: [process.execPath, "-e", "process.stdout.write('前缀-后缀')"],
      cwd: process.cwd(),
      stdio: { stdin: "ignore", stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
      graceMs: 500,
    });
    await handle.done;
    const first = handle.collected.stdout.readFrom(0);
    const second = handle.collected.stdout.readFrom(Buffer.byteLength("前缀-"));
    expect(first).toMatchObject({ text: "前缀-后缀", nextOffset: Buffer.byteLength("前缀-后缀"), lossy: false });
    expect(second).toMatchObject({ text: "后缀", nextOffset: first.nextOffset, lossy: false });
    await runtime.dispose();
  });

  it("exposes the shared PTY primitive through spawnTerminal", async () => {
    const runtime = new SubprocessRuntime();
    const terminal = await runtime.spawnTerminal({
      argv: ["/bin/bash", "--noprofile", "--norc", "-i"],
      cwd: process.cwd(),
      rows: 24,
      cols: 120,
      graceMs: 500,
    });
    const output: Buffer[] = [];
    terminal.output.on("data", (value: Buffer) => output.push(Buffer.from(value)));
    await terminal.write("printf standard-pty-ok\nexit\n");
    await terminal.done;
    expect(Buffer.concat(output).toString()).toContain("standard-pty-ok");
    await runtime.dispose();
  }, 30_000);

  it("resolves a session-scoped sandbox policy", () => {
    const policy = new SandboxPolicyService({ mode: "read-only", workspaceRoot: "/tmp" });
    expect(policy.resolve({ session: { sessionId: "session-1", cwd: "/workspace/project" } })).toMatchObject({
      mode: "read-only",
      workspaceRoot: "/workspace/project",
      sessionId: "session-1",
    });
    policy.setSessionMode("session-1", "workspace-write");
    expect(policy.resolve({ session: { sessionId: "session-1", cwd: "/workspace/project" } }).mode).toBe("workspace-write");
    expect(policy.resolve({ mode: "danger-full-access", cwd: "/tmp/other" })).toMatchObject({
      mode: "danger-full-access",
      workspaceRoot: "/tmp/other",
    });
  });

  it("fails closed when no sandbox provider is available", () => {
    const sandbox = new SandboxRuntime(new SandboxPolicyService({ mode: "workspace-write" }));
    try {
      const confined = sandbox.confine([process.execPath, "-e", "console.log('no-op')"]);
      expect(["bwrap", "/usr/bin/sandbox-exec"]).toContain(confined.argv[0]);
    } catch (error) {
      expect(String(error)).toMatch(/no enforcing provider/u);
    }
  });
});
