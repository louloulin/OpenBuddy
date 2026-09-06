import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const mainDir = process.argv[2] ?? "out/main";
if (!existsSync(mainDir)) {
  console.error(`[main-chunks] missing build directory: ${mainDir}`);
  process.exit(1);
}

const files = readdirSync(mainDir)
  .map((name) => ({ name, path: join(mainDir, name) }))
  .filter(({ path }) => statSync(path).isFile() && path.endsWith(".js"));
const entry = files.find(({ name }) => name === "index.js");
const chunks = files.filter(({ name }) => name !== "index.js");

if (!entry) {
  console.error(`[main-chunks] missing main entry in ${mainDir}`);
  process.exit(1);
}
if (chunks.length === 0) {
  console.error("[main-chunks] expected at least one lazy main-process chunk");
  process.exit(1);
}

console.log(JSON.stringify({
  entry: entry.name,
  entryBytes: statSync(entry.path).size,
  chunks: chunks.map(({ name, path }) => ({ name, bytes: statSync(path).size })),
}, null, 2));
