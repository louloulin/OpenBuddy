#!/usr/bin/env node
// OpenBuddy CLI — thin RPC client for the Electron harness server.
//
// Usage:
//   openbuddy [--url URL] [--token TOKEN] [--pretty] <command> [args]
//
// Environment:
//   OPENBUDDY_HARNESS_URL    — base URL of harness server (default http://127.0.0.1:7333)
//   OPENBUDDY_HARNESS_TOKEN  — bearer token (preferred Authorization header value)
//   OPENBUDDY_HARNESS_FILE   — path to a JSON file holding { url, token }
//                               (useful for state files written by Electron main).
//
// Commands:
//   status                                   → host.describe (system info)
//   sessions [--cwd <dir>]                   → agent.session-list
//   workspaces                               → workspace.list
//   providers                                → llm.providers
//   models                                   → llm.models
//   new-session [--cwd <dir>] [--model <id>] → agent.new-session
//   exec [--cwd <dir>] [--session <id>] [--model <id>] [--image <path>...] <prompt>
//                                             → agent.prompt (returns session id, follows stream)
//   resume <sessionId> [--tail]              → load + optionally tail events
//   tail <sessionId> [--since N]             → stream agent.event-log updates
//   event-log <sessionId> [--limit N]        → agent.event-log (snapshot)
//   abort <sessionId>                        → agent.abort
//   wait <sessionId> [--timeout-ms N]        → poll until session idle
//   help                                     → print this message
//
// All commands emit JSON on stdout (unless --pretty). Errors emit
// { "ok": false, "code", "message", "details" } on stdout with exit code != 0.

import process from "node:process";

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function readHarnessFile() {
  const file = process.env.OPENBUDDY_HARNESS_FILE;
  if (!file) return undefined;
  try {
    const fsx = _require("node:fs");
    const raw = fsx.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to read OPENBUDDY_HARNESS_FILE=${file}: ${error.message}`);
  }
}

function resolveEndpoint() {
  const file = readHarnessFile();
  const url = process.env.OPENBUDDY_HARNESS_URL ?? file?.url ?? "http://127.0.0.1:7333";
  const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? file?.token ?? "";
  return { url: url.replace(/[/]+$/, ""), token };
}

function parseFlags(argv) {
  const flags = { positional: [], pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pretty") flags.pretty = true;
    else if (arg === "--cwd") flags.cwd = argv[++i];
    else if (arg === "--model") flags.model = argv[++i];
    else if (arg === "--session") flags.session = argv[++i];
    else if (arg === "--image") (flags.images ??= []).push(argv[++i]);
    else if (arg === "--since") flags.since = argv[++i];
    else if (arg === "--limit") flags.limit = argv[++i];
    else if (arg === "--tail") flags.tail = true;
    else if (arg === "--timeout-ms") flags.timeoutMs = Number(argv[++i]);
    else if (arg === "--url") flags.url = argv[++i];
    else if (arg === "--token") flags.token = argv[++i];
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg?.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
    else flags.positional.push(arg);
  }
  return flags;
}

function rpcId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function rpcCall(baseUrl, token, payload, { signal } = {}) {
  const http = await import("node:http");
  const https = await import("node:https");
  const url = new URL(`${baseUrl}/api/${payload.method}`);
  const lib = url.protocol === "https:" ? https.request : http.request;
  const id = payload.rpcId ?? rpcId("cli");
  const body = JSON.stringify({
    type: "client-request",
    rpcId: id,
    method: payload.method,
    payload: payload.body ?? {},
  });
  return new Promise((resolve, reject) => {
    const req = lib(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-openbuddy-client": "openbuddy-cli",
      },
      ...(signal ? { signal } : {}),
    }, (res) => {
      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = chunks.join("");
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text), rpcId: id });
        } catch (error) {
          reject(new Error(`non-JSON response (status=${res.statusCode}): ${text.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function unwrap(response) {
  if (response?.body?.result?.ok === true) return response.body.result.value;
  if (response?.body?.result?.ok === false) {
    const err = response.body.result.error;
    const wrapped = new Error(err?.message ?? "RPC failed");
    wrapped.code = err?.code ?? "internal";
    wrapped.details = err?.details ?? {};
    throw wrapped;
  }
  if (response?.status && response.status >= 400) {
    const wrapped = new Error(`HTTP ${response.status}: ${JSON.stringify(response.body).slice(0, 200)}`);
    wrapped.code = "http-error";
    wrapped.details = { status: response.status };
    throw wrapped;
  }
  return response?.body;
}

function emit(value, flags) {
  if (flags.pretty) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  } else {
    process.stdout.write(JSON.stringify(value) + "\n");
  }
}

function emitError(error) {
  const fallbackCode = typeof error?.message === "string" && error.message.startsWith("usage:") ? "usage" : "internal";
  const payload = {
    ok: false,
    code: error.code ?? fallbackCode,
    message: error.message,
    details: error.details ?? {},
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function fileToDataUrl(pathStr) {
  const fsx = await import("node:fs/promises");
  const buf = await fsx.readFile(pathStr);
  const lower = pathStr.toLowerCase();
  const mime = lower.endsWith(".png") ? "image/png"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg"
    : lower.endsWith(".webp") ? "image/webp"
    : lower.endsWith(".gif") ? "image/gif"
    : "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Commands
// ───────────────────────────────────────────────────────────────────────────

const COMMANDS = {
  help: {
    summary: "Print this help message",
    run: async () => {
      process.stdout.write(HELP_TEXT);
      return { ok: true };
    },
  },
  status: {
    summary: "Describe harness server (host.describe)",
    run: async ({ baseUrl, token }) => unwrap(await rpcCall(baseUrl, token, { method: "host.describe" })),
  },
  providers: {
    summary: "List LLM providers (llm.providers)",
    run: async ({ baseUrl, token }) => unwrap(await rpcCall(baseUrl, token, { method: "llm.providers" })),
  },
  models: {
    summary: "List LLM models (llm.models)",
    run: async ({ baseUrl, token }) => unwrap(await rpcCall(baseUrl, token, { method: "llm.models" })),
  },
  workspaces: {
    summary: "List workspaces (workspace.list)",
    run: async ({ baseUrl, token }) => unwrap(await rpcCall(baseUrl, token, { method: "workspace.list" })),
  },
  sessions: {
    summary: "List sessions in cwd (agent.session-list)",
    run: async ({ baseUrl, token, flags }) => {
      const payload = {};
      if (flags.cwd) payload.cwd = flags.cwd;
      return unwrap(await rpcCall(baseUrl, token, { method: "agent.session-list", body: payload }));
    },
  },
  "new-session": {
    summary: "Create a new session (agent.new-session)",
    run: async ({ baseUrl, token, flags }) => {
      const payload = {};
      if (flags.cwd) payload.cwd = flags.cwd;
      if (flags.model) payload.model = flags.model;
      return unwrap(await rpcCall(baseUrl, token, { method: "agent.new-session", body: payload }));
    },
  },
  exec: {
    summary: "Send a prompt (creates session if needed, then agent.prompt)",
    run: async ({ baseUrl, token, flags }) => {
      const text = flags.positional.join(" ").trim();
      if (!text && !(flags.images?.length)) {
        throw new Error("usage: exec [--cwd <dir>] [--session <id>] [--model <id>] [--image <path>]... <prompt>");
      }
      let sessionId = flags.session;
      if (!sessionId) {
        const initPayload = {};
        if (flags.cwd) initPayload.cwd = flags.cwd;
        if (flags.model) initPayload.model = flags.model;
        const created = unwrap(await rpcCall(baseUrl, token, { method: "agent.new-session", body: initPayload }));
        sessionId = created?.sessionId ?? created?.id ?? created?.session?.id;
        if (!sessionId) throw new Error("agent.new-session did not return a sessionId");
      }
      const body = { sessionId, text };
      if (flags.images?.length) {
        body.images = [];
        for (const image of flags.images) body.images.push(await fileToDataUrl(image));
      }
      const result = unwrap(await rpcCall(baseUrl, token, { method: "agent.prompt", body }));
      return { sessionId, ...(typeof result === "object" && result !== null ? result : { value: result }) };
    },
  },
  resume: {
    summary: "Resume a session (load + optionally tail events)",
    run: async ({ baseUrl, token, flags }) => {
      const [sessionId] = flags.positional;
      if (!sessionId) throw new Error("usage: resume <sessionId> [--tail]");
      const payload = { sessionId };
      if (flags.cwd) payload.cwd = flags.cwd;
      const loaded = unwrap(await rpcCall(baseUrl, token, { method: "agent.session-load", body: payload }));
      return flags.tail ? { ...loaded, tail: "see openbuddy tail " + sessionId + " for live events" } : loaded;
    },
  },
  tail: {
    summary: "Stream events for a session (SSE over events.mux)",
    run: async ({ baseUrl, token, flags }) => {
      const [sessionId] = flags.positional;
      if (!sessionId) throw new Error("usage: tail <sessionId> [--since N]");
      const http = await import("node:http");
      const https = await import("node:https");
      const sseUrl = new URL(`${baseUrl}/api/events.mux`);
      if (flags.since !== undefined) sseUrl.searchParams.set("since", String(flags.since));
      const lib = sseUrl.protocol === "https:" ? https.request : http.request;
      const req = lib(sseUrl, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          const wrapped = new Error(`tail failed: HTTP ${res.statusCode}`);
          wrapped.code = "http-error";
          throw wrapped;
        }
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (!data) continue;
            if (data === "[DONE]") return;
            try {
              const json = JSON.parse(data);
              if (!sessionId || json?.sessionId === sessionId || json?.payload?.sessionId === sessionId) {
                process.stdout.write(JSON.stringify(json) + "\n");
              }
            } catch {
              process.stdout.write(data + "\n");
            }
          }
        });
        res.on("end", () => process.stdout.write(JSON.stringify({ kind: "end" }) + "\n"));
      });
      req.on("error", (error) => {
        const wrapped = new Error(error.message);
        wrapped.code = "http-error";
        throw wrapped;
      });
      req.end();
      await new Promise(() => {});
      return { sessionId };
    },
  },
  "event-log": {
    summary: "Get agent event-log snapshot (agent.event-log)",
    run: async ({ baseUrl, token, flags }) => {
      const [sessionId] = flags.positional;
      if (!sessionId) throw new Error("usage: event-log <sessionId> [--limit N]");
      const payload = { sessionId };
      if (flags.limit !== undefined) payload.limit = Number(flags.limit);
      if (flags.since !== undefined) payload.sinceSequence = Number(flags.since);
      return unwrap(await rpcCall(baseUrl, token, { method: "agent.event-log", body: payload }));
    },
  },
  abort: {
    summary: "Abort a running session (agent.abort)",
    run: async ({ baseUrl, token, flags }) => {
      const [sessionId] = flags.positional;
      if (!sessionId) throw new Error("usage: abort <sessionId>");
      return unwrap(await rpcCall(baseUrl, token, { method: "agent.abort", body: { sessionId } }));
    },
  },
  wait: {
    summary: "Poll event-log until session is idle (or timeout)",
    run: async ({ baseUrl, token, flags }) => {
      const [sessionId] = flags.positional;
      if (!sessionId) throw new Error("usage: wait <sessionId> [--timeout-ms N]");
      const timeoutMs = flags.timeoutMs ?? 60_000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const events = unwrap(await rpcCall(baseUrl, token, {
          method: "agent.event-log",
          body: { sessionId, limit: 50 },
        }));
        const tail = Array.isArray(events) ? events[events.length - 1] : undefined;
        const status = tail?.payload?.status ?? tail?.payload?.state ?? tail?.type;
        if (status === "idle" || status === "completed" || status === "aborted" || status === "error") {
          return { sessionId, status, events: events.length };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const error = new Error(`wait timed out after ${timeoutMs}ms`);
      error.code = "timeout";
      throw error;
    },
  },
};

const HELP_TEXT = `Usage: openbuddy [--url URL] [--token TOKEN] [--pretty] <command> [args]

Commands:
  status                            Describe harness server
  sessions [--cwd DIR]              List sessions
  workspaces                        List workspaces
  providers                         List LLM providers
  models                            List LLM models
  new-session [--cwd DIR] [--model ID]
                                    Create a new session
  exec [--cwd DIR] [--session ID] [--model ID] [--image PATH]...
                                    Send prompt (creates session if needed)
  resume <sessionId> [--tail]       Load (and optionally tail) a session
  tail <sessionId> [--since N]      Stream events for a session (Ctrl+C to exit)
  event-log <sessionId> [--limit N] Get event log snapshot
  abort <sessionId>                 Abort a running session
  wait <sessionId> [--timeout-ms N] Poll until session idle
  help                              Print this help

Environment:
  OPENBUDDY_HARNESS_URL    harness server base URL (default http://127.0.0.1:7333)
  OPENBUDDY_HARNESS_TOKEN  bearer token (preferred Authorization header value)
  OPENBUDDY_HARNESS_FILE   path to JSON file holding { url, token }
`;

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

function applyEndpointOverride(endpoint, flags) {
  return {
    url: (flags.url ?? endpoint.url).replace(/[/]+$/, ""),
    token: flags.token ?? endpoint.token,
  };
}

async function main() {
  const raw = process.argv.slice(2);
  let flags;
  try {
    flags = parseFlags(raw);
  } catch (error) {
    emitError(Object.assign({}, error, { code: error.code || "usage" }));
    process.stderr.write("\n" + HELP_TEXT);
    process.exit(2);
  }
  if (flags.help || raw.length === 0) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  const positional = flags.positional;
  const command = positional[0];
  // The outer argv may contain command flags after the command name.
  // parseFlags already pulled them into flags.{cwd, model, images, ...}
  // so we just hand flags straight through (without positional, which is
  // now empty after the command name).
  const commandFlags = Object.assign({}, flags);
  commandFlags.positional = positional.slice(1);
  const endpoint = applyEndpointOverride(resolveEndpoint(), flags);
  const handler = COMMANDS[command];
  if (!handler) {
    emitError({ code: "unknown-command", message: "unknown command: " + command });
    process.exit(2);
  }
  try {
    const value = await handler.run({ baseUrl: endpoint.url, token: endpoint.token, flags: commandFlags });
    if (value !== undefined) emit(value, commandFlags);
  } catch (error) {
    emitError(error);
    const code = error?.code === "usage" || (typeof error?.message === "string" && error.message.startsWith("usage:")) ? 2 : 1;
    process.exit(code);
  }
}

process.stdin.on("error", () => {});
if (process.stdin.isTTY === false) process.stdin.resume();

main().catch((error) => {
  emitError(error);
  process.exit(1);
});
