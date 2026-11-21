#!/usr/bin/env node
// A5: deterministic CycloneDX SBOM from pnpm-lock.yaml (no network, no node_modules).
//
// Usage: node tools/gen-sbom.mjs [--out release/sbom.cdx.json] [--timestamp]
// The output is sorted and timestamp-free by default so two runs are byte-identical.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const OUT = resolve(ROOT, arg("--out", "release/sbom.cdx.json"));
const LOCK = join(ROOT, "pnpm-lock.yaml");
const lock = parse(readFileSync(LOCK, "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** `name@version` (v9) or `/name/version` (v6); scoped names keep their slash. */
export function splitKey(key) {
  if (key.startsWith("/")) {
    const at = key.indexOf("/", 1);
    const scopeAt = key.startsWith("/@") ? key.indexOf("/", 1) : -1;
    const cut = scopeAt > 0 ? key.indexOf("/", scopeAt + 1) : at;
    if (cut < 0) return null;
    return { name: key.slice(1, cut), version: key.slice(cut + 1) };
  }
  const at = key.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

const ALG = { sha512: "SHA-512", sha256: "SHA-256", sha1: "SHA-1" };
function hashOf(integrity) {
  if (typeof integrity !== "string") return undefined;
  for (const part of integrity.split(/\s+/)) {
    const dash = part.indexOf("-");
    if (dash < 0) continue;
    const alg = ALG[part.slice(0, dash)];
    if (!alg) continue;
    const base64 = part.slice(dash + 1);
    try {
      return { alg, content: Buffer.from(base64, "base64").toString("hex") };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function componentsFromLock(lock) {
  const components = [];
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    const id = splitKey(key);
    if (!id) continue;
    const hash = hashOf(meta?.resolution?.integrity);
    const purl = `pkg:npm/${id.name.replace(/^@/, "%40")}@${id.version}`;
    components.push({
      type: "library",
      "bom-ref": purl,
      name: id.name,
      version: id.version,
      purl,
      ...(hash ? { hashes: [hash] } : {}),
    });
  }
  return components.sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
}

const components = componentsFromLock(lock);
if (!components.length) {
  console.error("SBOM_FAIL pnpm-lock.yaml has no packages");
  process.exit(1);
}
const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    ...(argv.includes("--timestamp") ? { timestamp: new Date().toISOString() } : {}),
    component: { type: "application", name: pkg.name, version: pkg.version, purl: `pkg:npm/${pkg.name}@${pkg.version}` },
    tools: [{ vendor: "OpenBuddy", name: "gen-sbom", version: "1" }],
  },
  components,
};
writeFileSync(OUT, `${JSON.stringify(bom, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output: OUT, components: components.length, bytes: JSON.stringify(bom).length }));
console.log("SBOM_OK");
