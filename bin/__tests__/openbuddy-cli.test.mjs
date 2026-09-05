// Tests for bin/openbuddy-cli.mjs.

// Strategy: spawn the CLI as a subprocess against a tiny in-process HTTP
// stub that mimics the harness server contract (POST /api/<method>, bearer
// token auth, JSON responses). Each test stubs a specific RPC method and
// verifies the CLI's stdout/exit-code contract.

import { describe, test, expect } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "../openbuddy-cli.mjs");

async function startStub(handler) {
  const server = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const method = url.pathname.slice("/api/".length);
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {}
      Promise.resolve(handler({ method, body, req, res })).then((value) => {
        if (res.writableEnded) return;
        const payload = JSON.stringify(value ?? { type: "server-response", rpcId: body?.rpcId, result: { ok: true, value: null } });
        res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
        res.end(payload);
      }).catch((error) => {
        if (res.writableEnded) return;
        const payload = JSON.stringify({ type: "server-response", rpcId: body?.rpcId, result: { ok: false, error: { code: "internal", message: String(error), details: {} } } });
        res.writeHead(500, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
        res.end(payload);
      });
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  return { server, port, url: `http://127.0.0.1:${port}`, token: "stub-token" };
}

function runCli(args, env) {
  return new Promise((resolveRun) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (c) => stdout.push(c));
    proc.stderr.on("data", (c) => stderr.push(c));
    proc.on("close", (code) => resolveRun({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

describe("openbuddy-cli", () => {
  test("help prints when no args given", async () => {
    const result = await runCli([], {});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Usage: openbuddy/);
    expect(result.stdout).toMatch(/status/);
    expect(result.stdout).toMatch(/exec/);
  });

  test("--help prints and exits 0", async () => {
    const result = await runCli(["--help"], {});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Usage:/);
  });

  test("unknown command emits structured error and exits 2", async () => {
    const result = await runCli(["bogus"], {});
    expect(result.code).toBe(2);
    const json = JSON.parse(result.stdout);
    expect(json.ok).toBe(false);
    expect(json.code).toBe("unknown-command");
  });

  test("status posts to host.describe and unwraps result.value", async () => {
    let received;
    const stub = await startStub(({ method, body }) => {
      received = { method, body };
      return { type: "server-response", rpcId: body.rpcId, result: { ok: true, value: { server: "stub", version: "test" } } };
    });
    try {
      const result = await runCli(["status"], {
        OPENBUDDY_HARNESS_URL: stub.url,
        OPENBUDDY_HARNESS_TOKEN: stub.token,
      });
      expect(result.code).toBe(0);
      expect(received.method).toBe("host.describe");
      expect(JSON.parse(result.stdout)).toEqual({ server: "stub", version: "test" });
    } finally {
      stub.server.close();
    }
  });

  test("sessions forwards --cwd and parses the response", async () => {
    let received;
    const stub = await startStub(({ method, body }) => {
      received = { method, body };
      return { type: "server-response", rpcId: body.rpcId, result: { ok: true, value: [{ id: "s1" }] } };
    });
    try {
      const result = await runCli(["sessions", "--cwd", "/tmp/foo"], {
        OPENBUDDY_HARNESS_URL: stub.url,
        OPENBUDDY_HARNESS_TOKEN: stub.token,
      });
      expect(result.code).toBe(0);
      expect(received.method).toBe("agent.session-list");
      expect(received.body.payload).toEqual({ cwd: "/tmp/foo" });
      expect(JSON.parse(result.stdout)).toEqual([{ id: "s1" }]);
    } finally {
      stub.server.close();
    }
  });

  test("exec creates a session when --session omitted, then prompts", async () => {
    const calls = [];
    const stub = await startStub(({ method, body }) => {
      calls.push({ method, payload: body.payload });
      if (method === "agent.new-session") return { type: "server-response", rpcId: body.rpcId, result: { ok: true, value: { sessionId: "s-new" } } };
      if (method === "agent.prompt") return { type: "server-response", rpcId: body.rpcId, result: { ok: true, value: { ok: true } } };
      return { type: "server-response", rpcId: body.rpcId, result: { ok: false, error: { code: "endpoint-not-registered", message: method, details: {} } } };
    });
    try {
      const result = await runCli(["exec", "--cwd", "/tmp", "hello world"], {
        OPENBUDDY_HARNESS_URL: stub.url,
        OPENBUDDY_HARNESS_TOKEN: stub.token,
      });
      expect(result.code).toBe(0);
      expect(calls.length).toBe(2);
      expect(calls[0].method).toBe("agent.new-session");
      expect(calls[0].payload.cwd).toBe("/tmp");
      expect(calls[1].method).toBe("agent.prompt");
      expect(calls[1].payload.sessionId).toBe("s-new");
      expect(calls[1].payload.text).toBe("hello world");
      const json = JSON.parse(result.stdout);
      expect(json.sessionId).toBe("s-new");
    } finally {
      stub.server.close();
    }
  });

  test("exec with --session reuses existing session", async () => {
    const calls = [];
    const stub = await startStub(({ method, body }) => {
      calls.push(method);
      return { type: "server-response", rpcId: body.rpcId, result: { ok: true, value: { ok: true } } };
    });
    try {
      const result = await runCli(["exec", "--session", "s-existing", "hi"], {
      OPENBUDDY_HARNESS_URL: stub.url,
      OPENBUDDY_HARNESS_TOKEN: stub.token,
    });
      expect(result.code).toBe(0);
      expect(calls).toEqual(["agent.prompt"]);
    } finally {
      stub.server.close();
    }
  });

  test("event-log rejects missing sessionId with usage error", async () => {
    const result = await runCli(["event-log"], {});
    expect(result.code).toBe(2);
    const json = JSON.parse(result.stdout);
    expect(json.code).toBe("usage");
    expect(json.message).toMatch(/usage:/);
  });

  test("abort wraps RPC error and exits 1", async () => {
    const stub = await startStub(({ method, body }) => ({
      type: "server-response",
      rpcId: body.rpcId,
      result: { ok: false, error: { code: "session-not-found", message: "no such session", details: {} } },
    }));
    try {
      const result = await runCli(["abort", "nope"], {
        OPENBUDDY_HARNESS_URL: stub.url,
        OPENBUDDY_HARNESS_TOKEN: stub.token,
      });
      expect(result.code).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.ok).toBe(false);
      expect(json.code).toBe("session-not-found");
    } finally {
      stub.server.close();
    }
  });

  test("--pretty flag emits multi-line JSON", async () => {
    const stub = await startStub(({ method, body }) => ({
      type: "server-response",
      rpcId: body.rpcId,
      result: { ok: true, value: { hello: "world" } },
    }));
    try {
      const result = await runCli(["--pretty", "status"], {
        OPENBUDDY_HARNESS_URL: stub.url,
        OPENBUDDY_HARNESS_TOKEN: stub.token,
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/\n/);
    } finally {
      stub.server.close();
    }
  });

  test("wait returns once terminal status is seen", async () => {
    let callCount = 0;
    const stub = await startStub(({ method, body }) => {
      if (method !== "agent.event-log") return null;
      callCount += 1;
      if (callCount < 3) {
        return { type: "server-response", rpcId: body.rpcId, result: { ok: true, value: [{ payload: { status: "running" } }] } };
      }
      return { type: "server-response", rpcId: body.rpcId, result: { ok: true, value: [{ payload: { status: "idle" } }] } };
    });
    try {
      const result = await runCli(["wait", "s1", "--timeout-ms", "3000"], {
        OPENBUDDY_HARNESS_URL: stub.url,
        OPENBUDDY_HARNESS_TOKEN: stub.token,
      });
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.status).toBe("idle");
      expect(callCount).toBeGreaterThanOrEqual(3);
    } finally {
      stub.server.close();
    }
  });
});
