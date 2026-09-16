import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-pi-mkt-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const piExtRoot = join(userData, "pi-extensions");
mkdirSync(piExtRoot, { recursive: true });

const PLUGIN_V100 = JSON.stringify({
  schema: "openbuddy.plugin.v1",
  id: "demo.pi-sample",
  version: "1.0.0",
  surface: "pi",
  provides: [{ type: "tool", name: "demo-hello", description: "打招呼" }],
}, null, 2);

// Use a "files" field directly (matches the bridge's expected format)
const registry = {
  version: 1,
  extensions: [
    {
      id: "demo.pi-sample",
      name: "Demo Pi Sample",
      publisher: "openbuddy",
      description: "演示 Pi 扩展 — R18 端到端验证用",
      version: "1.0.0",
      versions: ["1.0.0"],
      kinds: ["extension"],
      capabilities: [
        { id: "tools.demo-hello", risk: "low" },
      ],
      files: {
        "openbuddy.plugin.json": PLUGIN_V100,
        "README.md": "# Demo Pi Sample v1.0.0\n",
      },
    },
  ],
};
writeFileSync(join(piExtRoot, "registry.json"), JSON.stringify(registry, null, 2));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

async function invoke(channel, args) {
  return await page.evaluate(async ([c, a]) => {
    return await window.api.invoke(c, a).catch((e) => ({ error: String(e?.message ?? e) }));
  }, [channel, args]);
}

console.log("\n=== STEP 1: list ===");
const list = await invoke("agent:pi-market-list", { query: "" });
console.log("entries count:", list?.extensions?.length ?? list?.entries?.length);
console.log("first:", JSON.stringify(list?.extensions?.[0] ?? list?.entries?.[0] ?? null, null, 2).slice(0, 600));

console.log("\n=== STEP 2: install demo.pi-sample ===");
const install = await invoke("agent:pi-market-install", { id: "demo.pi-sample", version: "1.0.0" });
console.log(JSON.stringify(install, null, 2).slice(0, 800));

console.log("\n=== STEP 3: lockfile after install ===");
const lock = await invoke("agent:pi-market-lockfile", undefined);
console.log(JSON.stringify(lock, null, 2).slice(0, 800));

console.log("\n=== STEP 4: try install same id again (should fail — already installed) ===");
const reInstall = await invoke("agent:pi-market-install", { id: "demo.pi-sample", version: "1.0.0" });
console.log(JSON.stringify(reInstall, null, 2).slice(0, 500));

console.log("\n=== STEP 5: try rollback (no history yet) ===");
const rollback = await invoke("agent:pi-market-rollback", { id: "demo.pi-sample" });
console.log(JSON.stringify(rollback, null, 2).slice(0, 500));

console.log("\n=== STEP 6: audit ===");
const audit = await invoke("agent:pi-market-audit", { limit: 20 });
console.log(JSON.stringify(audit, null, 2).slice(0, 1500));

console.log("\n=== STEP 7: filesystem check ===");
const fsCheck = await page.evaluate(async ({ dataDir }) => {
  const fs = await import("node:fs/promises");
  const out = {};
  try {
    const lockfile = await fs.readFile(`${dataDir}/pi-extensions/installed.json`, "utf8");
    out.lockfile = JSON.parse(lockfile);
  } catch (e) { out.lockfileError = String(e.message); }
  try {
    const dirList = await fs.readdir(`${dataDir}/pi-extensions/demo.pi-sample`);
    out.installedVersions = dirList;
    for (const v of dirList) {
      try {
        const stat = await fs.stat(`${dataDir}/pi-extensions/demo.pi-sample/${v}`);
        out[`${v}_isDir`] = stat.isDirectory();
        out[`${v}_isFile`] = stat.isFile();
      } catch {}
    }
  } catch (e) { out.installDirError = String(e.message); }
  try {
    const auditRaw = await fs.readFile(`${dataDir}/pi-extensions/audit.jsonl`, "utf8");
    out.auditLines = auditRaw.split("\n").filter(Boolean).length;
  } catch (e) { out.auditError = String(e.message); }
  return out;
}, { dataDir: userData });
console.log(JSON.stringify(fsCheck, null, 2));

console.log("\nERRORS:", JSON.stringify(errs));
await app.close();
process.exit(0);
