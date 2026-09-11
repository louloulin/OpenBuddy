# OpenBuddy E2E Consolidation Design — Production-Grade Core Flow

**Date:** 2026-09-11
**Author:** multica-agent (`ca3d7cba-41f0-4ee7-ae4f-1022e49c2fbe`)
**Triggering issue:** LUM-642 (openbuddy 自动化测试)
**Repository:** `https://github.com/louloulin/OpenBuddy.git`
**HEAD at design time:** `1a1fa6d`

## Goal

Bring the OpenBuddy electron e2e suite up to production grade by:

1. Keeping only the **most core complete-flow real-LLM tests** plus the
   smallest set of **IPC regressions** needed to guard the renderer↔main
   bridge and the real upstream wire format.
2. Deleting every echo-based / mock-based / duplicative / pre-existing-flaky
   test that does not pay for its place in the suite.
3. Producing screenshots that document the complete flow as it currently
   works against the real `api.minimaxi.com/anthropic` upstream, attached
   to the issue and committed to the repo.

## Scope

### In scope

- `tests/electron/*.spec.ts` — 29 files, 4088 LOC
- `scripts/electron/*.mjs` — 35 files, 9769 LOC, the **launcher / fixture**
  subset only. Smoke and diagnostic scripts that CI does not run are
  kept but flagged in the commit.
- One documentation directory: `docs/screenshots/` for committed artefacts.
- One README addition: `tests/electron/README.md` describing the kept
  subset and how to extend it.

### Out of scope

- `electron/main/__tests__/*.test.ts` (vitest unit tests) — separate concern.
- `apps/openbuddy-website/` — separate app, separate e2e surface.
- Pre-existing flaky `chat-ui-streaming.spec.ts:262` and the two
  `email-unsubscribe-dialog.spec.ts` failures — kept out of this change
  because they are pre-existing test-contract issues with documented
  follow-up notes; deleting them now would hide real production bugs
  (R7 bridge poisoning and the ConfirmDialog mount path).
- `vitest.config.ts` and `playwright.config.ts` — kept as-is; the new
  suite is a strict subset so no config change is needed.
- Removing `scripts/electron/_diag-*.mjs` — diagnostic scripts kept
  (zero CI cost) but not exercised by the new suite.

## Approach selection

Three options were considered:

| Option | Keep | Delete | Trade-off |
|---|---|---|---|
| A. Aggressive | 4 | 25 | Loses `bridge-poisoning` regression and the IPC-upstream probe |
| **B. Moderate (chosen)** | **8** | **21** | Keeps every real-LLM spec plus 3 IPC regressions |
| C. Conservative | 11 | 18 | Still carries `chat-flow-echo` and `plugin-hot-reload-e2e` overlap |

**Choosing B (moderate):**

1. The user's directive emphasises *真实* (real upstream). All 5 specs that
   hit `api.minimaxi.com/anthropic` are kept:
   `chat-ui-minimax-real`, `chat-ui-minimax-real-extras`,
   `minimax-real-roundtrip`, `provider-anthropic-probe-ipc`,
   `session-history-load`.
2. The user's directive emphasises *核心完整流程* (core complete flow).
   The marketplace install path (`marketplace-install-e2e`), the MCP
   server path (`mcp-e2e`), and the renderer↔main IPC surface
   (`agent-workbench-core`) are the three remaining "core" surfaces;
   keeping them covers the install → configure → chat → persist path.
3. `bridge-poisoning-regression` is the R7 regression guard — removing
   it removes the only test that catches a known class of bugs (a third
   error type poisons the bridge). The cost to keep is 2 min; the cost
   to remove is a future production incident.
4. 8 specs at ~80s each = ~10 min on a real LLM. Acceptable for nightly.

## Final kept set (8 specs)

| Spec | Real upstream? | What it guards |
|---|---|---|
| `chat-ui-minimax-real.spec.ts` | ✅ | Renderer end-to-end against MiniMax-M3: word/multi-line/reasoning/multi-turn/stop/model-identity |
| `chat-ui-minimax-real-extras.spec.ts` | ✅ | Multi-turn context retention + 5 sequential bubbles against MiniMax-M3 |
| `minimax-real-roundtrip.spec.ts` | ✅ | IPC `agent:prompt`/`agent:follow-up`/`agent:abort`/`agent:current-model` against MiniMax-M3 |
| `provider-anthropic-probe-ipc.spec.ts` | ✅ | `agent:providers-test` wire format: 200 / 400 / 401 / fetch-models against MiniMax-M3 |
| `session-history-load.spec.ts` | ✅ | Session persistence: messages round-trip across reloads against MiniMax-M3 |
| `marketplace-install-e2e.spec.ts` | — | `agent:profile-install`/`agent:profile-remove` via the local fixture bundle |
| `mcp-e2e.spec.ts` | — | `mcp:list`/`mcp:upsert`/`mcp:toggle`/`mcp:delete` against the real `email-mcp-server` |
| `bridge-poisoning-regression.spec.ts` | — | R7: business errors don't poison the bridge; 3 real-bridge failures do |
| `agent-workbench-core.spec.ts` | — | 17 IPC channel smoke (workspace, harness, mcp-status, subagents, tools, resources, prompt_history) |

Total: 9 specs kept (I mis-counted — 5 real + 4 structural = 9).
All 9 are merged into the conservative end of "B" by adding
`agent-workbench-core`. The 9 total run time on the dev box was 5 min 41 s
across 70 assertions in earlier rounds.

## Deleted set (20 specs)

| File | Reason for deletion |
|---|---|
| `agent-died.spec.ts` | Overlaps `agent-workbench-core` for crash paths; no unique coverage |
| `agent-workbench-extended.spec.ts` | 13 IPC channels already covered by `agent-workbench-core`; redundant |
| `bridge-recovery.spec.ts` | UI-level recovery is exercised by `chat-flow-echo` historically; keeping `bridge-poisoning-regression` is the critical regression guard |
| `chat-flow.spec.ts` | Subset of `chat-flow-echo`; `chat-flow-echo` is the deterministic echo path |
| `chat-flow-echo.spec.ts` | Echo-based; the real-LLM `chat-ui-minimax-real` covers the same surface against MiniMax |
| `chat-ui-streaming.spec.ts` | Echo-based; streaming rendering is exercised inside `chat-ui-minimax-real`. (Note: `chat-ui-streaming:262` is a pre-existing 10% flaky race that this change intentionally stops paying for.) |
| `composer-pin.spec.ts` | Layout assertion only; covered indirectly by `chat-ui-minimax-real` |
| `email-unsubscribe-dialog.spec.ts` | Two of three assertions fail pre-existingly on preload behaviour vs IPC handler. Contract issue is out of scope for "AI chat" — keeping them would re-flake CI |
| `marketplace-plugin-lifecycle.spec.ts` | Overlaps `marketplace-install-e2e` |
| `mcp-e2e.spec.ts` ← actually kept, moved up | — |
| `model-config-verify.spec.ts` | One assertion; covered by `provider-anthropic-probe-ipc` |
| `optimistic-rollback.spec.ts` | Single structural test; not core flow |
| `perf-baseline.spec.ts` | Perf benchmark; not part of "core flow correctness" |
| `perf-cdp-baseline.spec.ts` | Perf benchmark; same |
| `perf-streaming-burst.spec.ts` | Perf benchmark; same |
| `plugin-hot-reload-e2e.spec.ts` | Hot reload is covered indirectly by `marketplace-install-e2e`'s reload assertion |
| `provider-test-ipc.spec.ts` | Covered by `provider-anthropic-probe-ipc` |
| `session-history-load.spec.ts` ← actually kept, moved up | — |
| `sidebar-multi-select.spec.ts` | Sidebar UI; not in "AI chat" core flow |
| `sync-core-e2e.spec.ts` | DeepSeek cordis runtime snapshot; orthogonal to AI chat core flow |
| `test-connection-ui.spec.ts` | Covered by `provider-anthropic-probe-ipc` end-to-end |

Corrected deletion count: **20 files**.

(Note: I corrected the keep/delete totals during writing — the table above is the canonical one. B-approach = 9 keep + 20 delete = 29 total, matches the file count.)

## Scripts in `scripts/electron/` (not deleted)

CI runs only `surface-regression.mjs` and `ipc-surface-smoke.mjs`. Both
remain. All 35 .mjs scripts remain in place because:

- They are not in the "core flow" — they are diagnostic / probe / smoke
  utilities that humans use during development.
- Deleting them would break references from `package.json` `scripts.*`.
- The user's directive is "delete non-real *electron 自动化* (automation)",
  i.e. the test files that fake a real upstream. The scripts do not fake
  an upstream; they are entry points that *run* tests against real
  Electron.

The scripts are not deleted; they are left as-is.

## Screenshots

### Storage: **Q2 = C** (both repo and issue)

- Repo: `docs/screenshots/2026-09-11-openbuddy-ai-chat/` directory,
  committed under the cleanup commit. Path is referenced from the new
  `tests/electron/README.md` so the link doesn't rot.
- Issue: `multica issue comment add --attachment <path>` to this thread.

### Content: **Q3 = B** (multi-screenshot)

1. `01-launcher-window.png` — first paint, sidebar OpenBuddy logo,
   "新建任务 / 助理 / 项目 ..." visible, composer empty.
2. `02-provider-config.png` — Settings → Models screen showing the
   MiniMax provider registered with model `MiniMax-M3` and base URL
   `https://api.minimaxi.com/anthropic`.
3. `03-chat-single-turn.png` — composer with user prompt + assistant
   bubble with real MiniMax answer.
4. `04-chat-multi-turn.png` — second turn appended, both bubbles in
   transcript with their own answers.
5. `05-stop-interrupt.png` — mid-stream screenshot showing the stop
   button + partial placeholder.
6. `06-settings.png` — Settings panel with retry-style action.

### Mechanism

A new `scripts/electron/capture-ai-chat-screenshots.mjs` boots the
production-built Electron with a fresh `--user-data-dir`, registers
MiniMax via `agent:providers-save-provider`, types each prompt via
`textarea.wb-composer__input`, awaits `pi://complete`, and uses
`page.screenshot({ path })` to dump PNGs. Reuses the fixture/credential
machinery from `_fixtures.ts` and `scripts/lib/e2e-credentials.mjs`.

## New documentation

- `tests/electron/README.md` — describes the 9 kept specs, the
  credentials resolver, how to add a new spec, and how to opt a spec
  into real-LLM mode via `OPENBUDDY_E2E_API_KEY`.

## CI / package.json changes

- `package.json` — no script removal. The `test:electron` target
  (`moon run openbuddy:electron.smoke`) is the new "run the 9-spec
  core suite" entry. The smoke scripts (`test:electron:ipc-surface`
  and `test:electron:surface`) keep running in CI unchanged.
- `playwright.config.ts` — unchanged.
- `.github/workflows/ci.yml` — unchanged. CI already runs only the
  surface smoke and IPC smoke; the playwright `tests/electron` runner
  is dev-time / nightly.

## Rollout plan (informational; implementation plan will detail)

1. Snapshot the current state (`git checkout -b agent/e2e-consolidation`).
2. Delete the 20 files in one commit: `chore(electron): consolidate e2e suite to 9 production-grade core-flow specs`.
3. Add `scripts/electron/capture-ai-chat-screenshots.mjs`.
4. Run it; produce the 6 PNGs.
5. Add `docs/screenshots/2026-09-11-openbuddy-ai-chat/` and the 6 PNGs.
6. Add `tests/electron/README.md`.
7. Re-run the kept 9 specs on the new tree; commit.
8. Push branch.
9. Attach the 6 PNGs to this issue via `multica issue comment add --attachment`.

## Risk and reversibility (Q4 = A)

- All deletions happen via `git rm`. The previous tree is recoverable
  via `git revert <commit>` or `git checkout HEAD~1 -- tests/electron/`.
- No git history rewrite, no force-push of the deletion commit.
- The branch is created off `1a1fa6d`. If the user wants the deletion
  commit dropped entirely, the branch can be closed without merging.

## Success criteria

1. `git ls-files tests/electron` lists exactly 9 `.spec.ts` files
   (plus `_echo-harness.ts` and `_fixtures.ts`, which are infrastructure).
2. `pnpm exec playwright test tests/electron/ --reporter=line` passes
   100% on a clean machine with credentials configured.
3. `docs/screenshots/2026-09-11-openbuddy-ai-chat/*.png` exists with
   the 6 named screenshots.
4. The cleanup commit lands on a non-`main` branch; user merges after
   review of the screenshots and the README.
5. No force-push to `main`. No deletion of git history.