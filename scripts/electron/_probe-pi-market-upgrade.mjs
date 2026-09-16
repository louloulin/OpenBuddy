import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-pi-mkt-up-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const piExtRoot = join(userData, "pi-extensions");
mkdirSync(piExtRoot, { recursive: true });

function makeRegistry(version, files) {
  return {
    version: 1,
    extensions: [{
      id: "demo.upgrade-test",
      name: "Upgrade Test",
      publisher: "openbuddy",
      description: "演示升级回滚",
      version,
      versions: ["1.0.0", "1.1.0"],
      kinds: ["extension"],
      capabilities: [{ id: "tools.demo", risk: "low" }],
      files,
    }],
  };
}

const V100 = JSON.stringify({
  schema: "openbuddy.plugin.v1",
  id: "demo.upgrade-test",
  version: "1.0.0",
  surface: "pi",
  provides: [{ type: "tool", name: "demo", description: "v1" }],
}, null, 2);
const V110 = JSON.stringify({
  schema: "openbuddy.plugin.v1",
  id: "demo.upgrade-test",
  version: "1.1.0",
  surface: "pi",
  provides: [{ type: "tool", name: "demo", description: "v1.1 (new)" }],
}, null, 2);

writeFileSync(join(piExtRoot, "registry.json"), JSON.stringify(makeRegistry("1.0.0", {
  "openbuddy.plugin.json": V100,
  "README.md": "# v1.0.0\n",
}), null, 2));

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

console.log("\n=== STEP 1: install 1.0.0 ===");
const inst = await invoke("agent:pi-market-install", { id: "demo.upgrade-test", version: "1.0.0" });
console.log(JSON.stringify(inst, null, 2).slice(0, 500));

console.log("\n=== STEP 2: lockfile after install ===");
const lock1 = await invoke("agent:pi-market-lockfile", undefined);
const ext1 = lock1?.extensions?.["demo.upgrade-test"];
console.log("version:", ext1?.version, "integrity:", ext1?.integrity?.slice(0, 16));

// Update registry to advertise 1.1.0
writeFileSync(join(piExtRoot, "registry.json"), JSON.stringify(makeRegistry("1.1.0", {
  "openbuddy.plugin.json": V110,
  "README.md": "# v1.1.0 (upgraded)\n",
}), null, 2));

console.log("\n=== STEP 3: upgrade to 1.1.0 ===");
const up = await invoke("agent:pi-market-upgrade", { id: "demo.upgrade-test", version: "1.1.0" });
console.log(JSON.stringify(up, null, 2).slice(0, 500));

console.log("\n=== STEP 4: lockfile after upgrade ===");
const lock2 = await invoke("agent:pi-market-lockfile", undefined);
const ext2 = lock2?.extensions?.["demo.upgrade-test"];
console.log("version:", ext2?.version, "integrity:", ext2?.integrity?.slice(0, 16), "history:", ext2?.history);

console.log("\n=== STEP 5: rollback ===");
const rb = await invoke("agent:pi-market-rollback", { id: "demo.upgrade-test" });
console.log(JSON.stringify(rb, null, 2).slice(0, 500));

console.log("\n=== STEP 6: lockfile after rollback ===");
const lock3 = await invoke("agent:pi-market-lockfile", undefined);
const ext3 = lock3?.extensions?.["demo.upgrade-test"];
console.log("version:", ext3?.version, "integrity:", ext3?.integrity?.slice(0, 16), "history:", ext3?.history);

console.log("\n=== STEP 7: audit ===");
const audit = await invoke("agent:pi-market-audit", { limit: 20 });
const actions = audit?.entries?.map((e) => `${e.action}${e.outcome === "failure" ? "[FAIL]" : ""}`) ?? [];
console.log("audit actions:", actions);

console.log("\nERRORS:", JSON.stringify(errs));
await app.close();
process.exit(0);
