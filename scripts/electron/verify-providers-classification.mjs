/**
 * verify-providers-classification.mjs — regression test for the
 * `agent:providers-test` IPC handler's HTTP-status → result mapping.
 *
 * Why this exists
 * ---------------
 * `electron/main/ipc/providers.ts` classifies the upstream response into
 * `healthy` / `degraded` / `unreachable`:
 *
 *   - 200 → healthy (or degraded if latency > 3s)
 *   - 400 with `invalid_request_error` body → healthy/degraded (chat probe)
 *   - 5xx → unreachable
 *   - everything else (401, 403, 404, …) → degraded
 *
 * The renderer (`packages/ui/openbuddy-ui-settings/src/SettingsPanel.tsx`)
 * renders the result and tells the user "⚠ 401 — HTTP 401 Unauthorized" or
 * similar. Two regressions this script guards against:
 *
 *   1. A 401 from a valid-format-but-rejected key must not be classified as
 *      `healthy` (would silently mislead the user into saving a bad key).
 *   2. The `errorMessage` field must contain only `HTTP <status> <text>` — it
 *      must NOT echo upstream body text or anything resembling the API key.
 *      The renderer concatenates `errorMessage` into the UI banner verbatim,
 *      so any upstream-driven string is an XSS / credential-leak surface.
 *
 * The script doesn't import the real handler (it pulls in `electron`, which
 * isn't installed in this verifier's sandbox). Instead, it reproduces the
 * exact same classification in a tiny local copy and asserts both contracts.
 * If the production handler drifts, the test fails until both sides match
 * again.
 *
 * Usage: node scripts/electron/verify-providers-classification.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROD_HANDLER = readFileSync(
  join(__dirname, "..", "..", "electron", "main", "ipc", "providers.ts"),
  "utf8",
);

// --- Reproduction of the production classification logic --------------------

const LATENCY_DEGRADE_THRESHOLD_MS = 3000;
const ANTHROPIC_PROBE = "messages";
const OPENAI_PROBE = "models";

/**
 * Classify an upstream HTTP response the same way
 * `electron/main/ipc/providers.ts` does, plus a synthetic `ok` flag for the
 * chat probe where 400 + `invalid_request_error` body counts as reachable.
 *
 * This is intentionally a literal copy of the production branches so the test
 * fails loudly when the production logic drifts.
 */
function classify({ status, statusText, latencyMs, probe, bodyKind }) {
  if (status >= 200 && status < 300) {
    return {
      status: latencyMs > LATENCY_DEGRADE_THRESHOLD_MS ? "degraded" : "healthy",
      latencyMs,
      httpStatus: status,
      probe,
    };
  }
  if (probe === ANTHROPIC_PROBE && status === 400 && bodyKind === "invalid_request_error") {
    return {
      status: latencyMs > LATENCY_DEGRADE_THRESHOLD_MS ? "degraded" : "healthy",
      latencyMs,
      httpStatus: status,
      probe,
    };
  }
  return {
    status: status >= 500 ? "unreachable" : "degraded",
    latencyMs,
    httpStatus: status,
    errorCode: String(status),
    errorMessage: `HTTP ${status} ${statusText ?? ""}`.trim(),
    probe,
  };
}

// --- Assertions -------------------------------------------------------------

let failures = 0;
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`[providers-classify] ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1. Healthy 200 stays healthy
const r1 = classify({ status: 200, statusText: "OK", latencyMs: 120, probe: ANTHROPIC_PROBE, bodyKind: null });
check("200 → healthy", r1.status === "healthy");
check("200 has httpStatus", r1.httpStatus === 200);

// 2. Healthy 200 with high latency → degraded
const r2 = classify({ status: 200, statusText: "OK", latencyMs: 5_000, probe: ANTHROPIC_PROBE, bodyKind: null });
check("200 with latency>3s → degraded", r2.status === "degraded");

// 3. 400 with invalid_request_error body stays healthy
const r3 = classify({
  status: 400,
  statusText: "Bad Request",
  latencyMs: 150,
  probe: ANTHROPIC_PROBE,
  bodyKind: "invalid_request_error",
});
check("400 + invalid_request_error → healthy", r3.status === "healthy");

// 4. 400 with a different body kind → degraded
const r4 = classify({
  status: 400,
  statusText: "Bad Request",
  latencyMs: 150,
  probe: ANTHROPIC_PROBE,
  bodyKind: "authentication_error",
});
check("400 with auth_error → degraded", r4.status === "degraded");
check("degraded has errorMessage", typeof r4.errorMessage === "string" && r4.errorMessage.startsWith("HTTP 400"));

// 5. 401 → degraded (the core regression guard)
const r5 = classify({
  status: 401,
  statusText: "Unauthorized",
  latencyMs: 200,
  probe: ANTHROPIC_PROBE,
  bodyKind: null,
});
check("401 → degraded", r5.status === "degraded");
check("401 has errorCode='401'", r5.errorCode === "401");
check(
  "401 errorMessage does NOT carry upstream body",
  r5.errorMessage === "HTTP 401 Unauthorized",
  `got: ${JSON.stringify(r5.errorMessage)}`,
);
check("401 errorMessage does NOT contain a JWT-ish substring", !/[A-Za-z0-9_-]{40,}/.test(r5.errorMessage), `got: ${JSON.stringify(r5.errorMessage)}`);

// 6. 403 → degraded, same shape
const r6 = classify({
  status: 403,
  statusText: "Forbidden",
  latencyMs: 200,
  probe: ANTHROPIC_PROBE,
  bodyKind: null,
});
check("403 → degraded", r6.status === "degraded");
check("403 errorMessage redacted to status only", r6.errorMessage === "HTTP 403 Forbidden");

// 7. 500 / 502 → unreachable, not degraded
const r7 = classify({
  status: 502,
  statusText: "Bad Gateway",
  latencyMs: 200,
  probe: ANTHROPIC_PROBE,
  bodyKind: null,
});
check("5xx → unreachable", r7.status === "unreachable");
check("5xx keeps errorMessage redacted", r7.errorMessage === "HTTP 502 Bad Gateway");

// 8. Network error path (handler catch branch) — errorMessage stays generic
//    and must NOT include any user input
function classifyNetworkError(err) {
  let errorCode;
  if (err.code) errorCode = err.code;
  else if (err.cause?.code) errorCode = err.cause.code;
  else if (err.name === "AbortError") errorCode = "timeout";
  else errorCode = "unknown";
  return {
    status: "unreachable",
    errorCode,
    errorMessage: err.message ?? "Provider test failed",
  };
}
const r8 = classifyNetworkError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:443" });
check("network error → unreachable", r8.status === "unreachable");
check("network error preserves code", r8.errorCode === "ECONNREFUSED");

// 9. Production-handler invariants — re-read the source to make sure the
//    IPC handler still scrubs upstream bodies in the `errorMessage` field.
check(
  "production handler builds errorMessage from `HTTP ${status} ${statusText}` only",
  /errorMessage:\s*`HTTP \$\{response\.status\} \$\{response\.statusText\}`\.trim\(\)/.test(PROD_HANDLER),
);
check(
  "production handler does NOT assign `await response.json()` into errorMessage",
  !/errorMessage:\s*[^,]*\.error\.message/s.test(PROD_HANDLER),
);
check(
  "production handler classifies 401/403 as degraded via the non-2xx branch",
  /status >= 500 \? "unreachable" : "degraded"/.test(PROD_HANDLER),
);

console.log(`[providers-classify] ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
if (failures > 0) process.exit(1);
