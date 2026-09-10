/**
 * verify-credentials-helper.mjs — sanity check that scripts/lib/e2e-credentials.mjs
 *   1. resolves our local .env.e2e.local into a usable credential
 *   2. scrubs the right set of provider credential env vars
 *   3. never prints the key itself, only length + provenance
 *
 * Runs as pure node — no test framework, no install needed. Exits non-zero on
 * any assertion failure so it can be wired into pre-commit / CI later.
 *
 * Usage: node scripts/electron/verify-credentials-helper.mjs
 */
import {
  PROVIDER_CREDENTIAL_ENV_VARS,
  REPO_ROOT,
  describeSource,
  parseDotEnv,
  readDotEnvLocal,
  resolveE2ECredentials,
  scrubProviderCredentials,
} from "../lib/e2e-credentials.mjs";

let failures = 0;
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  const tag = ok ? "ok  " : "FAIL";
  console.log(`[cred-helper] ${tag} ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log(`[cred-helper] REPO_ROOT=${REPO_ROOT}`);

// 1. parseDotEnv
const sample = [
  "# comment",
  "",
  'OPENBUDDY_E2E_API_KEY="abc123"',
  "OPENBUDDY_E2E_BASE_URL=https://example.test/v1",
  "SINGLE_QUOTED='value with spaces'",
  "INVALID LINE WITHOUT EQ",
].join("\n");
const parsed = parseDotEnv(sample);
check("parseDotEnv strips comments", parsed["# comment"] === undefined);
check("parseDotEnv handles double quotes", parsed.OPENBUDDY_E2E_API_KEY === "abc123");
check("parseDotEnv handles single quotes", parsed.SINGLE_QUOTED === "value with spaces");
check("parseDotEnv preserves URL", parsed.OPENBUDDY_E2E_BASE_URL === "https://example.test/v1");

// 2. readDotEnvLocal — read our actual .env.e2e.local
const local = readDotEnvLocal();
check("readDotEnvLocal finds .env.e2e.local", Object.keys(local).length > 0);
check("readDotEnvLocal has api key", typeof local.OPENBUDDY_E2E_API_KEY === "string" && local.OPENBUDDY_E2E_API_KEY.length > 100, `key length=${local.OPENBUDDY_E2E_API_KEY?.length ?? 0}`);
check("readDotEnvLocal has baseUrl", local.OPENBUDDY_E2E_BASE_URL?.startsWith("https://"));

// 3. resolveE2ECredentials
const creds = resolveE2ECredentials();
check("resolveE2ECredentials returns apiKey", typeof creds.apiKey === "string" && creds.apiKey.length > 100);
check("resolveE2ECredentials returns baseUrl", creds.baseUrl?.startsWith("https://"));
check("resolveE2ECredentials returns modelId", typeof creds.modelId === "string" && creds.modelId.length > 0);
check("resolveE2ECredentials source recorded", typeof creds.source === "string" && creds.source.length > 0);

// 4. describeSource never contains the key
const desc = describeSource(creds);
check("describeSource does NOT contain the key", !desc.includes(creds.apiKey));
check("describeSource contains length", desc.includes(`${creds.apiKey.length} chars`));
check("describeSource contains provider/model/baseUrl", desc.includes(creds.provider) && desc.includes(creds.modelId) && desc.includes(creds.baseUrl));

// 5. scrubProviderCredentials strips every known provider-credential var
const dirty = {
  PATH: "/usr/bin",
  HOME: "/root",
  ...Object.fromEntries(PROVIDER_CREDENTIAL_ENV_VARS.map((k, i) => [k, `value-${i}`])),
  LANG: "en_US.UTF-8",
};
const scrubbed = scrubProviderCredentials(dirty);
check("scrubProviderCredentials preserves PATH", scrubbed.PATH === "/usr/bin");
check("scrubProviderCredentials preserves HOME", scrubbed.HOME === "/root");
check("scrubProviderCredentials preserves LANG", scrubbed.LANG === "en_US.UTF-8");
for (const v of PROVIDER_CREDENTIAL_ENV_VARS) {
  check(`scrub strips ${v}`, scrubbed[v] === undefined, scrubbed[v] !== undefined ? `leaked: ${v}` : "");
}

// 6. scrubProviderCredentials drops undefined entries
const withUndef = { A: "x", B: undefined, PATH: "/bin" };
const scrubbed2 = scrubProviderCredentials(withUndef);
check("scrub drops undefined values", !("B" in scrubbed2));
check("scrub keeps defined values", scrubbed2.A === "x");

console.log(`[cred-helper] ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
if (failures > 0) process.exit(1);
