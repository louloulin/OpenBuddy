import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-audit-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Try window.api.invoke("audit:list")
const auditList = await page.evaluate(async () => {
  const api = window.api;
  if (!api?.invoke) return { apiFound: false };
  // Record an event first
  const recordResult = await api.invoke("audit:record", {
    event: "probe.test",
    outcome: "info",
    subject: "r18-final-verification",
    detail: { source: "probe" },
  });
  const listResult = await api.invoke("audit:list", { limit: 10 });
  return {
    apiFound: true,
    apiVersion: api.apiVersion,
    recordResult,
    listCount: listResult?.events?.length,
    firstEvents: listResult?.events?.slice(0, 3).map(e => ({ event: e.event, subject: e.subject, hash: e.hash })),
  };
});
console.log("AUDIT:", JSON.stringify(auditList, null, 2));

await app.close();
process.exit(0);
