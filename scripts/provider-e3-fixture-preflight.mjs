#!/usr/bin/env node
/**
 * Credential-free provider E3 fixture gate.
 *
 * This exercises the provider lifecycle contract in memory only: attribution,
 * isolation, change events, failure rollback, and error propagation. It never
 * contacts a provider and never reads ambient credentials.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const output = resolve(process.argv.find((arg) => arg.startsWith("--json="))?.slice(7) ?? "evidence/provider/provider-e3-fixture.json");
const checks = [];
const check = (name, ok, details = {}) => { checks.push({ name, ok, ...details }); return ok; };
const credentials = ["OPENBUDDY_E2E_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"];
const ambientCredentials = credentials.filter((key) => process.env[key]);
check("fixture:no-network", true, { transport: "in-memory", networkCalls: 0 });
check("fixture:no-credentials", ambientCredentials.length === 0, { ambientCredentialNames: ambientCredentials, policy: "fixture gate refuses provider credentials" });

const registry = new Map();
const events = [];
const register = (id, source) => {
  if (id === "rejected") throw new Error("fixture provider rejected");
  const record = { id, source, registeredAt: 1 };
  registry.set(id, record);
  events.push({ kind: "register", record });
  return record;
};
const unregister = (id) => {
  const record = registry.get(id);
  registry.delete(id);
  if (record) events.push({ kind: "unregister", record });
};
const first = register("fixture-openai", "pi-extension");
const second = register("fixture-anthropic", "pi-extension");
check("lifecycle:multi-provider-attribution", first.source === "pi-extension" && second.source === "pi-extension" && registry.size === 2, { providerIds: [...registry.keys()] });
unregister("fixture-openai");
check("lifecycle:unregister-isolation", !registry.has("fixture-openai") && registry.has("fixture-anthropic"), { remaining: [...registry.keys()] });
const beforeFailure = registry.size;
let failure;
try { register("rejected", "pi-extension"); } catch (error) { failure = String(error); }
check("lifecycle:failure-rollback", registry.size === beforeFailure && events.every((event) => event.record.id !== "rejected"), { error: failure });
check("lifecycle:change-events", events.map((event) => event.kind).join(",") === "register,register,unregister", { eventCount: events.length });
check("lifecycle:error-propagation", failure === "Error: fixture provider rejected", { error: failure });
unregister("fixture-anthropic");
check("lifecycle:clean-dispose", registry.size === 0, { remaining: registry.size });

const report = {
  schema: "openbuddy.provider-e3-fixture.v1",
  generatedAt: new Date().toISOString(),
  evidenceLevel: "E3-fixture",
  realProvider: false,
  realNetwork: false,
  credentialsUsed: false,
  checks,
  ok: checks.every((entry) => entry.ok),
  blockedRealProviderE3: true,
  realProviderBlocker: "No approved temporary provider credentials; fixture evidence must not be counted as real-provider evidence",
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${output}`);
if (!report.ok) process.exitCode = 2;
