# OpenBuddy CLI Reference (`openbuddy`)

OpenBuddy ships a Node-based CLI that talks to the **same harness server**
the Electron app exposes to its renderer (`http://127.0.0.1:<port>/api/*`).
This means every capability the GUI can trigger is reachable from a
shell: create sessions, tail them, send prompts, abort, wait for completion,
and inspect provider / model metadata.

The CLI is intentionally a **thin client** — it does not start a new
Electron instance, does not own state, and does not duplicate IPC
validation. All authentication, replay protection, and intent journaling
remain on the harness server (`electron/main/harness/harness-server.ts`).

## Install

`openbuddy` is declared in the root `package.json` `bin` field, so
`pnpm install` (or `npm install -g openbuddy`) puts it on `$PATH`:

```
  bin/openbuddy          # bash wrapper, sets cwd & forwards to node
  bin/openbuddy-cli.mjs  # the actual Node entrypoint
  package.json#bin       # openbuddy -> ./bin/openbuddy
                         # openbuddy-cli -> ./bin/openbuddy-cli.mjs
```

Both binaries read three environment variables:

- `OPENBUDDY_HARNESS_URL` — base URL (default `http://127.0.0.1:7333`)
- `OPENBUDDY_HARNESS_TOKEN` — bearer token used in `Authorization: Bearer ...`
- `OPENBUDDY_HARNESS_FILE` — path to a JSON file holding `{ url, token }`

When the Electron app is running it persists these values to a state
file under userData; `OPENBUDDY_HARNESS_FILE` lets you point the CLI at
that file without exporting variables manually.

## Commands

| Command | RPC method | Notes |
| --- | --- | --- |
| `openbuddy status` | `host.describe` | Server info / version |
| `openbuddy sessions [--cwd DIR]` | `agent.session-list` | List sessions in cwd |
| `openbuddy workspaces` | `workspace.list` | List known workspaces |
| `openbuddy providers` | `llm.providers` | List LLM providers |
| `openbuddy models` | `llm.models` | List LLM models |
| `openbuddy new-session [--cwd DIR] [--model ID]` | `agent.new-session` | Create session |
| `openbuddy exec [--cwd DIR] [--session ID] [--model ID] [--image PATH...] PROMPT` | `agent.new-session` + `agent.prompt` | Send prompt; auto-creates session unless `--session` is given |
| `openbuddy resume SESSION_ID [--tail]` | `agent.session-load` | Load (and optionally tail) a session |
| `openbuddy tail SESSION_ID [--since N]` | SSE over `/api/events.mux` | Stream events; Ctrl+C to exit |
| `openbuddy event-log SESSION_ID [--limit N] [--since N]` | `agent.event-log` | Snapshot of agent events |
| `openbuddy abort SESSION_ID` | `agent.abort` | Abort a running session |
| `openbuddy wait SESSION_ID [--timeout-ms N]` | polls `agent.event-log` | Block until terminal status (`idle` / `completed` / `aborted` / `error`) |
| `openbuddy help` | — | Print command summary |

## Output contract

All commands emit **exactly one** JSON value on stdout and exit with:

- `0` — success
- `1` — RPC / network error (error object also JSON-printed)
- `2` — usage error (missing positional arg, unknown command, parse failure)

Errors are emitted as:

```json
{ "ok": false, "code": "session-not-found", "message": "...", "details": {} }
```

Add `--pretty` to pretty-print the JSON value (handy for humans, never for
machine consumers).

## Examples

```bash
# Confirm the Electron app is reachable
openbuddy status

# Create a session in /tmp/proj and send a prompt
openbuddy exec --cwd /tmp/proj "List the top 5 files by size"

# Reuse an existing session
openbuddy exec --session sess-abc "Now group them by directory"

# Stream live events for a session
openbuddy tail sess-abc --since 100

# Wait up to 30s for completion, then dump event log
openbuddy wait sess-abc --timeout-ms 30000 && \
  openbuddy event-log sess-abc --limit 200

# Abort a stuck session
openbuddy abort sess-abc

# Inspect available models before launching a heavy job
openbuddy --pretty models | jq '.[] | select(.provider=="openai")'
```

## How it talks to the app

Every command sends a single `POST /api/<method>` request:

```http
POST /api/agent.prompt HTTP/1.1
Host: 127.0.0.1:7333
Authorization: Bearer <token>
Content-Type: application/json
X-Openbuddy-Client: openbuddy-cli

{
  "type": "client-request",
  "rpcId": "cli-...",
  "method": "agent.prompt",
  "payload": { "sessionId": "sess-abc", "text": "..." }
}
```

The harness server (`electron/main/harness/harness-server.ts`) validates
the token, replays the request via `dispatchRpc`, persists side-effect
intents for recovery, and returns:

```json
{
  "type": "server-response",
  "rpcId": "cli-...",
  "result": { "ok": true, "value": { ... } }
}
```

Replayable methods (`host.describe`, `llm.providers`, `session.list`, …)
are idempotent and may be re-issued on connection failure. Side-effect
methods (`agent.prompt`, `agent.abort`, …) get a fresh `rpcId` per call;
see `docs/pi-extension-architecture.md` for the recovery semantics.

## Why a CLI? (vs. Codex CLI)

Codex CLI popularized `codex exec "<prompt>"` for headless / CI usage.
OpenBuddy's CLI is the same shape — `openbuddy exec "<prompt>"` — but
the model runtime is the **same Electron host** the GUI uses, so:

- Single process tree: GUI, eval harness, IDE plugin, and CI all share
  the harness server, the agent runtime, and the extension sandbox.
- No duplicated auth, plugins, or session state.
- Worktree, AGENTS.md, and other OpenBuddy features are inherited
  automatically because we route through the real `agentHost.init()` path.

See `docs/analysis/codex-app-specific-gap.md` for the long-form
comparison and follow-up roadmap.

## Testing

```bash
node --test bin/__tests__/openbuddy-cli.test.mjs
```

11 tests cover: help / unknown-command / exit-code contract / JSON
output, plus per-command coverage of `status`, `sessions`, `exec`
(auto-create + reuse paths), `event-log`, `abort`, `--pretty`, and `wait`.