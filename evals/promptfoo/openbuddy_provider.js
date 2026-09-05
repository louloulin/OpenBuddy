// Custom promptfoo provider that drives a real OpenBuddy Electron harness via
// HTTP RPC. Requires promptfoo CLI >=0.50. Honors OPENBUDDY_E2E_* env vars.
// No mock fallback: missing creds → the prompt call errors with a clear
// message so the eval is fail-closed.
const http = require("http");
const https = require("https");

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const e2eKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const e2eBase = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const e2eModel = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";
const required = process.env.OPENBUDDY_E2E_REQUIRED === "1";

if (!baseUrl || !token) {
  throw new Error("OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN are required");
}
if (!required || !(e2eKey && e2eBase && e2eModel)) {
  throw new Error("Real Promptfoo evaluation requires OPENBUDDY_E2E_REQUIRED=1 and complete credentials/base/model");
}

function rpc(method, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const lib = url.protocol === "https:" ? https : http;
    const rpcId = `pf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify({ type: "client-request", rpcId, method, payload: payload || {} });
    const req = lib.request(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { chunks += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(chunks)); }
        catch (error) { reject(new Error(`Non-JSON RPC (status=${res.statusCode}): ${chunks.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function readEvents(sessionId, limit = 600) {
  const response = await rpc("agent.event-log", { sessionId, limit });
  if (!response?.result?.ok) throw new Error(`event-log RPC failed: ${JSON.stringify(response)}`);
  const entries = response.result.value;
  if (!Array.isArray(entries)) throw new Error("event-log RPC returned invalid entries");
  return entries.filter((entry) => entry?.sessionId === sessionId).slice(-limit);
}
async function waitAssistantEnd(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readEvents(sessionId, 400);
    const starts = events.filter((event) => event.type === "agent/start");
    if (starts.length > 0) {
      const last = starts[starts.length - 1].sequence;
      const post = events.filter((event) => event.sequence >= last && event.sessionId === sessionId);
      if (post.some((event) => event.type === "assistant/end") && post.some((event) => event.type === "agent/settled")) {
        return last;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`assistant/end timeout for session=${sessionId}`);
}

class OpenBuddyProvider {
  constructor(options = {}) {
    this.config = options;
    this.providerId = options.id ?? "openbuddy-electron-harness";
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context) {
    const safeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newSession = await rpc("session.create", { cwd: `${process.env.OPENBUDDY_EVAL_CWD ?? "/tmp/openbuddy-eval"}/promptfoo-${safeId}`, modelId: `custom_anthropic/${e2eModel}` });
    if (!newSession?.result?.ok) throw new Error(`session.create failed: ${JSON.stringify(newSession)}`);
    const sessionId = newSession.result.value.sessionId;
    const turns = Array.isArray(context?.vars?.turns) ? context.vars.turns : [prompt];
    let lastStart = 0;
    let cursor = 0;
    for (const turn of turns) {
        await rpc("session.prompt", { sessionId, text: turn });
        lastStart = await waitAssistantEnd(sessionId, 90_000);
        const turnEvents = (await readEvents(sessionId, 600)).filter((event) => event.sequence > cursor).sort((a, b) => a.sequence - b.sequence);
        const lifecycle = ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"];
        let position = -1;
        for (const type of lifecycle) {
          const found = turnEvents.findIndex((event, index) => index > position && event.type === type);
          if (found < 0) throw new Error(`promptfoo missing lifecycle event ${type}`);
          position = found;
        }
        const serialized = turnEvents.map((event) => JSON.stringify(event.payload ?? event)).join("\n");
        if (![e2eModel, "custom_anthropic", "anthropic-messages"].every((value) => serialized.includes(value))) throw new Error("promptfoo missing provider/model/api evidence");
        cursor = Math.max(cursor, ...turnEvents.map((event) => event.sequence));
    }
    const events = await readEvents(sessionId, 600);
    const reply = events
      .filter((event) => event.sequence >= lastStart && event.sessionId === sessionId && event.type === "assistant/update")
      .map((event) => {
        const text = event.payload?.text;
        if (typeof text === "string") return text;
        if (text?.delta) return text.delta;
        if (text?.text) return text.text;
        if (Array.isArray(text)) return text.map((entry) => entry?.text ?? "").join("");
        return "";
      })
      .join("");
    return { output: reply, sessionId };
  }
}

module.exports = OpenBuddyProvider;
