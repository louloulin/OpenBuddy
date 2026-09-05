// Real Terminal-Bench / SWE-bench-style repo-level task against OpenBuddy.
//
// Generates a deterministic buggy project under /tmp, drives the Pi agent
// through the harness to read/write files, then asserts the agent produced
// the expected patch.  No mocks; relies on the agent's real read/edit tools.
//
// Usage:
//   OPENBUDDY_HARNESS_URL=http://127.0.0.1:PORT \
//   OPENBUDDY_HARNESS_TOKEN=secret \
//   OPENBUDDY_E2E_API_KEY=... OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
//   OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 OPENBUDDY_E2E_REQUIRED=1 \
//   node evals/node/run_repo_fix.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const e2eKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const e2eBase = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const e2eModel = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";
const required = process.env.OPENBUDDY_E2E_REQUIRED === "1";

if (!baseUrl || !token) { console.error("OPENBUDDY_HARNESS_URL/TOKEN required"); process.exit(2); }
if (!required || !(e2eKey && e2eBase && e2eModel)) { console.error("Real repo-fix evaluation requires OPENBUDDY_E2E_REQUIRED=1 and complete credentials/base/model"); process.exit(2); }

function rpc(method, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const lib = url.protocol === "https:" ? httpsRequest : httpRequest;
    const rpcId = `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify({ type: "client-request", rpcId, method, payload: payload || {} });
    const req = lib(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { chunks += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(chunks)); }
        catch (error) { reject(new Error(`Non-JSON RPC status=${res.statusCode}: ${chunks.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function readEvents(sessionId, limit = 800) {
  const response = await rpc("agent.event-log", { sessionId, limit });
  if (!response?.result?.ok) throw new Error(`event-log RPC failed: ${JSON.stringify(response)}`);
  const entries = response.result.value;
  if (!Array.isArray(entries)) throw new Error("event-log RPC returned invalid entries");
  return entries.filter((entry) => entry?.sessionId === sessionId).slice(-limit);
}
async function waitForAssistantEnd(sessionId, timeoutMs = 180_000) {
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`assistant/end timeout for session=${sessionId}`);
}

function buildBuggyRepo() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-repo-fix-"));
  mkdirSync(join(root, "src"));
  // Buggy implementation: always returns 0 even on negative inputs.
  writeFileSync(join(root, "src", "sum.js"), `export function sum(a, b) {
  // BUG: should handle negatives and NaN
  const parsed = Number(a) + Number(b);
  return parsed < 0 ? 0 : parsed;
}
export function expectSum(expected, actual) {
  if (actual !== expected) throw new Error(\`expected \${expected} got \${actual}\`);
}
`);
  // Test file: passes when sum(1,2)===3 but fails for sum(-1,2)===1.
  writeFileSync(join(root, "src", "sum.test.js"), `import { sum } from "./sum.js";
const cases = [
  [1, 2, 3],
  [-1, 2, 1],
  [Number.NaN, 1, Number.NaN],
];
for (const [a, b, expected] of cases) {
  const actual = sum(a, b);
  if (Number.isNaN(expected) ? !Number.isNaN(actual) : actual !== expected) {
    console.error(\`FAIL sum(\${a},\${b}) expected=\${expected} got=\${actual}\`);
    process.exit(1);
  }
}
console.log("OK");
`);
  writeFileSync(join(root, "package.json"), `{"name":"openbuddy-eval-repo","type":"module","scripts":{"test":"node src/sum.test.js"}}`);
  return root;
}

async function main() {
  const repoPath = buildBuggyRepo();
  try {
    const newSession = await rpc("session.create", { cwd: repoPath, modelId: `custom_anthropic/${e2eModel}` });
    if (!newSession?.result?.ok) throw new Error(`session.create failed: ${JSON.stringify(newSession)}`);
    const sessionId = newSession.result.value.sessionId;
    const task = [
      `The repo at ${repoPath} contains src/sum.js with a bug.`,
      "Read src/sum.js and src/sum.test.js, then fix sum.js so the test in src/sum.test.js passes.",
      "After fixing, run `node src/sum.test.js` and reply ONLY with the literal string REPO-FIX-OK or REPO-FIX-FAIL plus a 1-line reason; do not explain further.",
    ].join("\n");
    await rpc("session.prompt", { sessionId, text: task });
    const lastStart = await waitForAssistantEnd(sessionId);
    const events = await readEvents(sessionId, 800);
    const extractText = (value, depth = 0) => {
      if (depth > 8 || value === null || value === undefined) return "";
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map((entry) => extractText(entry, depth + 1)).join("");
      if (typeof value !== "object") return "";
      const record = value;
      for (const key of ["text", "delta", "content", "assistantMessageEvent", "message", "data", "payload"]) {
        if (record[key] !== undefined) {
          const text = extractText(record[key], depth + 1);
          if (text) return text;
        }
      }
      return "";
    };
    const reply = events
      .filter((event) => event.sequence >= lastStart && event.sessionId === sessionId && (event.type === "assistant/update" || event.type === "assistant/end"))
      .map((event) => extractText(event.payload ?? event))
      .join("");
    const toolEvents = events.filter((event) => event.type === "tool/start" || event.type === "tool/end");
    const { spawnSync } = await import("node:child_process");
    const testRun = spawnSync(process.execPath, ["src/sum.test.js"], { cwd: repoPath, encoding: "utf8" });
    const testsPassed = testRun.status === 0 && testRun.stdout.includes("OK");
    const summary = {
      schema: "openbuddy.redacted-evidence.v1",
      framework: "terminal-bench-style",
      session: createHash("sha256").update(sessionId).digest("hex").slice(0, 12),
      toolEvents: toolEvents.length,
      testsPassed,
      marker: reply.includes("REPO-FIX-OK") ? "REPO-FIX-OK" : (reply.includes("REPO-FIX-FAIL") ? "REPO-FIX-FAIL" : null),
    };
    if (process.env.OPENBUDDY_EVIDENCE_DIR) {
      mkdirSync(process.env.OPENBUDDY_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.OPENBUDDY_EVIDENCE_DIR, "repo-fix.json"), JSON.stringify(summary, null, 2));
    }
    console.log(JSON.stringify({ ...summary, evidenceArtifact: process.env.OPENBUDDY_EVIDENCE_DIR ? join(process.env.OPENBUDDY_EVIDENCE_DIR, "repo-fix.json") : null }, null, 2));
    process.exit(summary.marker === "REPO-FIX-OK" && summary.testsPassed ? 0 : 2);
  } finally {
    try { rmSync(repoPath, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

main().catch((error) => { console.error(error?.stack ?? String(error)); process.exit(1); });
