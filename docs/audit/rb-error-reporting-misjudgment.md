# rb-error-reporting — Misjudgment Analysis

> **Goal**: `mu7rpkze-gc769z` / rb-error-reporting (contract: **先证实再修**).
> **Date**: 2026-09-19
> **Author**: this session's agent
> **Conclusion**: the original "上游 429 → 无 `pi://error`" observation is **real**
> but the **causal attribution is wrong**. The bug is *structural*, not
> a missing IPC channel. The existing catch at `agent-prompt.ts:154-163`
> works perfectly when the upstream SDK throws — it just never gets
> called for the rate-limit / quota-exhausted path, because the SDK
> classifies those responses as **successful zero-content completions**,
> not thrown errors.

---

## 1. The original observation

In this session, an automated MiniMax real-LLM roundtrip
(`tests/electron/minimax-real-roundtrip.spec.ts:148`) was driven with
real provider credentials. The configured endpoint returned
`HTTP 429: rate_limit_error — "已达到 Token Plan 用量上限..."`.
Captured events on the renderer side:

```
updates    = []
completes  = [...]   // pi://complete DID fire
errors     = []      // pi://error NEVER fired
```

**Symptom**: the user sees a streaming marker, then nothing — no
assistant reply, no error banner. From the user's perspective, the
agent "ignored" the message.

A direct probe of the configured endpoint (without going through the
app) confirmed the 429 (`HTTP=429`,
`{"type":"error","error":{"type":"rate_limit_error","message":"已达到 Token Plan 用量上限..." (2056)}}`).

## 2. Original (mis-)attribution

The first-attempt hypothesis: "errors are swallowed upstream and never
reach `pi://error`". The fix would be: add an error-reporting IPC
channel and emit a `pi://error` somewhere when something goes wrong.

**That attribution is wrong**, as the reproducer in §3 proves.

## 3. Reproducer (cheap, no real-model quota)

`electron/main/agent/host-modules/agent-prompt-error-repro.test.ts`
drives `state.session.prompt()` (the entry point at
`agent-prompt.ts:115-163`) with two mocked implementations:

| Variant | `state.session.prompt()` | `pi://error` emitted? |
| --- | --- | --- |
| **A** | resolves with `undefined` (mimics upstream SDK returning a *successful completion with zero assistant content* — the rate-limit/quota path) | **0 events** |
| **B1** | rejects with `new Error("HTTP 429: rate_limit_error")` (mimics an SDK that *classifies* the failure as a thrown error) | **1 event** with `{ sessionId, error: "Error: HTTP 429: rate_limit_error" }` |
| **B2** | rejects with `new TypeError("network unreachable")` (generic thrown error) | **1 event** with `error: "TypeError: network unreachable"` |

Raw output from `npx vitest run
electron/main/agent/host-modules/agent-prompt-error-repro.test.ts`:

```
✓ electron/main/agent/host-modules/agent-prompt-error-repro.test.ts (3 tests) 8ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**Interpretation**:
- The existing catch block at `agent-prompt.ts:154-163` works
  correctly. It emits `pi://error` with `{ sessionId, error }` when
  `state.session.prompt()` rejects. (Variants B1 and B2 confirm.)
- The catch is **bypassed** entirely when `state.session.prompt()`
  resolves successfully. (Variant A confirms.)

So the bug is NOT in the `pi://error` plumbing. The bug is that
upstream 429 responses don't propagate as thrown errors — the model
SDK returns a successful completion with empty content, and the catch
never runs.

## 4. Where the real fix would go

The `pi://complete` / `pi://update` / `pi://error` channels are all
emitted from `handle-session-event.ts:500-525` and `agent-prompt.ts`,
driven by AgentSession events emitted by the upstream SDK. The SDK
fires a `turn_end` (or equivalent) event after `state.session.prompt()`
resolves — the host then emits `pi://complete` and moves on, with
**no inspection of the assistant content** between resolution and
completion.

A proper fix requires:
1. Intercept the session event for the just-completed turn.
2. Check whether any `agent_message` arrived with empty `text`.
3. Cross-reference with the upstream HTTP status (if exposed) or use a
   heuristic (e.g. "completion arrived within 1s of prompt = rate-limit signature").
4. If empty + rate-limit signature, emit `pi://error` with
   `{ sessionId, error: "upstream-rate-limit", classification: "transient" }`.

That is **architectural work**, not a minimal-error-reporting fix, and
belongs in its own task. It also requires access to a paid quota to
verify the heuristic end-to-end (the current quota is exhausted, so we
can't drive a real 429 through the agent path right now).

## 5. Recommendation for release-readiness

**Do not** treat "错误上报" as fully resolved. The IPC plumbing for
`pi://error` exists and works correctly for *thrown* errors. What is
missing is a **completion-path inspection** for the
*successfully-empty-content* class of failures, which is the
rate-limit / quota / network-glitch pattern.

Update `docs/release-readiness-report.md` §2.3 #7 to:
- Mark the **throw path** as **已落地** (catch works, reproducer confirms).
- Add a **new sub-item** for the **completion-empty path** (architectural
  follow-up) with status **未清 — P1 follow-up**, requiring either a
  quota top-up (to verify) or a manual code-walk through
  `handle-session-event.ts` with a fresh pair of eyes.

## 6. Reproducer evidence (this session)

- Test file: `electron/main/agent/host-modules/agent-prompt-error-repro.test.ts` (new)
- Test result: **3/3 passed** in 8ms
- Direct probe result (this session, earlier turn):
  `HTTP=429 {"type":"error","error":{"type":"rate_limit_error","message":"已达到 Token Plan 用量上限... (2056)"}}`
- Real roundtrip evidence: `tests/electron/minimax-real-roundtrip.spec.ts:148`
  captured `errors=[]`, `completes.length >= 1` despite the upstream
  returning 429.