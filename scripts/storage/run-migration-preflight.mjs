import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { preflightLegacySources } from "../../packages/runtime/openbuddy-storage/src/index.ts";

export async function runPreflightCli(manifestPath) {
  const absolute = resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absolute, "utf8"));
  if (!Array.isArray(manifest)) throw new Error("preflight manifest must be a JSON array");
  return preflightLegacySources(manifest);
}

const root = resolve(import.meta.dirname, "../..");
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const manifestFlag = args.indexOf("--manifest");
  if (manifestFlag < 0 || !args[manifestFlag + 1]) {
    console.error("usage: pnpm storage:preflight --manifest <json-manifest>");
    process.exitCode = 2;
  } else {
    const manifestPath = resolve(process.cwd(), args[manifestFlag + 1]);
    const report = await runPreflightCli(manifestPath);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
