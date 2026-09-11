# OpenBuddy Electron E2E Tests

The Electron end-to-end suite exercises the **core AI chat flow** against a
real MiniMax upstream plus a small set of IPC regressions that catch
production breakage the real-LLM specs do not surface on their own.

## Production-grade kept specs (run on every dev box and nightly CI)

| Spec | Real upstream? | What it guards |
|---|---|---|
| `chat-ui-minimax-real.spec.ts` | ✅ `api.minimaxi.com/anthropic` | Renderer end-to-end against MiniMax-M3: word/multi-line/reasoning/multi-turn/stop/model-identity |
| `chat-ui-minimax-real-extras.spec.ts` | ✅ | Multi-turn context retention + 5 sequential bubbles against MiniMax-M3 |
| `minimax-real-roundtrip.spec.ts` | ✅ | IPC `agent:prompt`/`agent:follow-up`/`agent:abort`/`agent:current-model` against MiniMax-M3 |
| `provider-anthropic-probe-ipc.spec.ts` | ✅ | `agent:providers-test` wire format: 200 / 400 / 401 / fetch-models |
| `session-history-load.spec.ts` | ✅ | Session persistence: messages round-trip across reloads |
| `agent-workbench-core.spec.ts` | — | 17 IPC channel smoke (workspace, harness, mcp-status, subagents, tools, resources, prompt_history) |
| `bridge-poisoning-regression.spec.ts` | — | R7 regression: business errors don't poison the bridge; 3 real-bridge failures do |
| `marketplace-install-e2e.spec.ts` | — | `agent:profile-install`/`agent:profile-remove` via the local fixture bundle |
| `mcp-e2e.spec.ts` | — | `mcp:list`/`mcp:upsert`/`mcp:toggle`/`mcp:delete` against the real `email-mcp-server` |

## Credentials

The five "real upstream" specs read credentials from (in order):

1. `OPENBUDDY_E2E_API_KEY` / `OPENBUDDY_E2E_BASE_URL` / `OPENBUDDY_E2E_MODEL_ID`
2. `.env.e2e.local` (gitignored)
3. `~/.pi/agent/auth.json` (where `pi auth login minimax` writes)

If none of the above contain a MiniMax key, the five specs skip cleanly
instead of failing, so a machine without credentials runs the rest of
the suite.

The shared resolver is `scripts/lib/e2e-credentials.mjs`; the same module
also scrubs every `ANTHROPIC_*` / `OPENAI_*` / `*_API_KEY` / `AWS_*` env
var before the Electron child boots, so a developer's shell does not
make the app under test believe a provider is already configured.

## Running

```bash
# All 9 production-grade specs
pnpm exec playwright test tests/electron/ --reporter=line

# Only the real-upstream specs
pnpm exec playwright test tests/electron/ \
  --grep "real MiniMax|provider-anthropic-probe-ipc|session-history-load" \
  --reporter=line
```

A clean box with `~/.pi/agent/auth.json["minimax"]` populated runs the
full 9-spec suite in roughly 5–7 minutes (the real-LLM round-trips
dominate).

## Adding a new real-LLM spec

Copy one of the five kept real-LLM specs as a template. The contract:

1. Import `test` from `./_fixtures` (not from `@playwright/test`) — the
   fixture launches Electron with an isolated `--user-data-dir` and
   scrubs provider credentials from the env.
2. Resolve credentials via `process.env.OPENBUDDY_E2E_API_KEY` etc. and
   `test.skip(!HAS_CREDS, ...)` when no key is present so a
   credential-less machine still runs the suite.
3. Register the provider via `agent:providers-save-provider` and the
   model via `agent:providers-save-model` (same IPC the Settings UI uses),
   then create a session via `agent:new-session` and reload the renderer
   so it picks up the registered model.
4. Drive the composer (`textarea.wb-composer__input`) and assert on the
   real transcript (`.msg--assistant`) — never on a mock upstream.
5. Use `test.describe.configure({ mode: "serial" })` if the spec depends
   on state from an earlier spec in the same file (the fixture
   isolates `--user-data-dir` per test).

## Why these 9 and not 29

This directory used to hold 29 specs (~4088 LOC) covering every IPC
channel individually plus every echo/mocked path. After the
2026-09-11 consolidation (LUM-642), the directory holds 9 specs:

- Every spec that hit a real upstream is kept.
- The IPC regressions that catch production breakage (R7 bridge
  poisoning, agent-workbench 17-channel smoke, marketplace install
  via the local fixture, MCP against the real `email-mcp-server`)
  are kept.
- Echo-only / mocked / duplicative / pre-existing-flaky specs are
  deleted. The deletion is recoverable via `git revert <commit>` —
  see `docs/superpowers/specs/2026-09-11-openbuddy-e2e-consolidation-design.md`.

The two non-spec files in this directory are infrastructure:

- `_fixtures.ts` — the Electron launcher fixture shared by every spec.
- `_echo-harness.ts` — `invoke` / `invokeOrReject` helpers used by
  both real-LLM and structural specs.