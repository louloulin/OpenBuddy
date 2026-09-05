// Real harness client for OpenBuddy Electron Main harness server.
// Usage:
//   OPENBUDDY_HARNESS_URL=http://127.0.0.1:PORT \
//   OPENBUDDY_HARNESS_TOKEN=secret \
//   node evals/node/harness_client.mjs <command> [...args]
//
// Commands:
//   describe                              → host.describe RPC
//   sessions <cwd>                        → session.list
//   init <cwd>                            → agent:init via HTTP RPC
//   new-session <cwd> [model]             → agent:new-session via HTTP RPC
//   prompt <sessionId> <text>             → agent:prompt via HTTP RPC
//   event-log <sessionId> [limit]         → fetch event log
//   open-mux [sinceJson|sinceSeq]         → opens WebSocket mux stream, prints events
import { request } from "node:http";
import { request as httpsRequest } from "node:https";
import WebSocket from "ws";

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
if (!baseUrl) {
  console.error("OPENBUDDY_HARNESS_URL is required");
  process.exit(2);
}
if (!token) {
  console.error("OPENBUDDY_HARNESS_TOKEN is required");
  process.exit(2);
}

function rpc(method, payload, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const lib = url.protocol === "https:" ? httpsRequest : request;
    const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify({ type: "client-request", rpcId, method, payload: payload ?? {} });
    const req = lib(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(signal ? { signal } : {}),
    }, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { chunks += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(chunks);
          resolve({ rpcId, status: res.statusCode, body: json });
        } catch (error) {
          reject(new Error(`Non-JSON RPC response (status=${res.statusCode}): ${chunks.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function eventLog(sessionId, limit = 200) {
  const response = await rpc("agent.event-log", { sessionId, limit });
  if (!response?.body?.result?.ok) {
    throw new Error(`event-log RPC failed: ${JSON.stringify(response?.body ?? response)}`);
  }
  const events = response.body.result.value;
  if (!Array.isArray(events)) throw new Error("event-log RPC returned invalid entries");
  return events.filter((event) => event?.sessionId === sessionId).slice(-limit);
}

function streamMux({ since, signal, onEvent }) {
  const url = new URL(`${baseUrl.replace(/^http/, "ws")}/api/events.mux`);
  if (since !== undefined) url.searchParams.set("since", typeof since === "string" ? since : JSON.stringify(since));
  const socket = new WebSocket(url.toString(), { headers: { authorization: `Bearer ${token}` } });
  socket.on("open", () => onEvent({ kind: "open" }));
  socket.on("message", (data) => {
    try {
      const payload = JSON.parse(String(data));
      onEvent({ kind: "message", payload });
    } catch (error) {
      onEvent({ kind: "error", error: String(error) });
    }
  });
  socket.on("close", () => onEvent({ kind: "close" }));
  socket.on("error", (error) => onEvent({ kind: "error", error: String(error) }));
  signal?.addEventListener("abort", () => socket.close());
  return socket;
}

const [, , command, ...args] = process.argv;
const ctrl = new AbortController();
process.on("SIGINT", () => ctrl.abort());

switch (command) {
  case "describe": {
    const result = await rpc("host.describe", {});
    console.log(JSON.stringify(result));
    break;
  }
  case "sessions": {
    const cwd = args[0] ?? process.cwd();
    const result = await rpc("session.list", { cwd });
    console.log(JSON.stringify(result));
    break;
  }
  case "prompt": {
    const [sessionId, ...text] = args;
    if (!sessionId || text.length === 0) { console.error("usage: prompt <sessionId> <text>"); process.exit(2); }
    const result = await rpc("session.prompt", { sessionId, text: text.join(" ") });
    console.log(JSON.stringify(result));
    break;
  }
  case "event-log": {
    const [sessionId, limitText] = args;
    if (!sessionId) { console.error("usage: event-log <sessionId> [limit]"); process.exit(2); }
    const events = await eventLog(sessionId, Number(limitText ?? 200));
    console.log(JSON.stringify(events.map((event) => ({ type: event.type, sequence: event.sequence, sessionId: event.sessionId, payloadType: event.payload?.type }))));
    break;
  }
  case "open-mux": {
    let since;
    if (args[0]) {
      try { since = JSON.parse(args[0]); }
      catch { since = Number(args[0]); }
    }
    streamMux({ since, signal: ctrl.signal, onEvent: (event) => {
      if (event.kind === "message") console.log(JSON.stringify(event.payload));
      else console.log(JSON.stringify({ kind: event.kind, ...(event.error ? { error: event.error } : {}) }));
    }});
    await new Promise((resolve) => setTimeout(resolve, 5000));
    break;
  }
  default: {
    console.error("unknown command:", command);
    process.exit(2);
  }
}
