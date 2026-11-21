#!/usr/bin/env node
// A5: offline dependency-policy gate over pnpm-lock.yaml.
//
// Usage: node tools/check-deps.mjs
// Fails when a registry package lost its integrity hash, a tarball is fetched over plain HTTP,
// or an importer declares a dependency the lockfile cannot resolve.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..");
const lock = parse(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"));
const packages = lock.packages ?? {};
const importers = lock.importers ?? {};

const problems = [];
let integrity = 0;
const stripPeers = (version) => String(version).replace(/\(.*$/, "");

for (const [key, meta] of Object.entries(packages)) {
  const resolution = meta?.resolution ?? {};
  if (typeof resolution.integrity === "string" && resolution.integrity) integrity += 1;
  else if (resolution.tarball) {
    if (!/^https:\/\//i.test(String(resolution.tarball))) problems.push(`${key}: insecure tarball ${resolution.tarball}`);
  } else if (resolution.directory) {
    // Local workspace link; nothing to verify.
  } else {
    problems.push(`${key}: missing resolution.integrity`);
  }
}

let checked = 0;
for (const [importer, entry] of Object.entries(importers)) {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, dep] of Object.entries(entry?.[section] ?? {})) {
      const version = typeof dep === "string" ? dep : dep?.version;
      if (!version) {
        problems.push(`${importer} ${section} ${name}: no resolved version`);
        continue;
      }
      if (String(version).startsWith("link:")) continue;
      checked += 1;
      const key = `${name}@${stripPeers(version)}`;
      if (!packages[key] && !packages[`/${name}/${stripPeers(version)}`]) {
        problems.push(`${importer} ${section} ${name}: ${key} missing from packages`);
      }
    }
  }
}

const summary = {
  packages: Object.keys(packages).length,
  withIntegrity: integrity,
  importers: Object.keys(importers).length,
  directDependencies: checked,
  problems: problems.slice(0, 20),
};
console.log(JSON.stringify(summary));
if (problems.length) {
  console.error(`DEPS_FAIL (${problems.length})\n  ${problems.slice(0, 20).join("\n  ")}`);
  process.exit(1);
}
console.log("DEPS_OK");
