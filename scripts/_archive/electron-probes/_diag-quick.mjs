/**
 * Quick diagnostic: launch Electron, capture renderer console + page errors,
 * check what window.api looks like, and bail.
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-diag-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });

console.log("[diag] launching electron...");
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--enable-logging"],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});

const consoleLines = [];
const pageErrors = [];

const page = await app.firstWindow({ timeout: 30_000 });
console.log("[diag] first window obtained");

page.on("console", (msg) => {
  consoleLines.push(`[${msg.type()}] ${msg.text()}`);
  if (consoleLines.length > 200) consoleLines.shift();
});
page.on("pageerror", (err) => {
  pageErrors.push(`PAGEERROR: ${err.message}\n${err.stack ?? ""}`);
});

await page.waitForTimeout(15_000);

const apiState = await page.evaluate(() => {
  return {
    hasApi: typeof window.api !== "undefined",
    apiVersion: window.api?.apiVersion,
    apiKeys: window.api ? Object.keys(window.api) : [],
    rootHtml: document.querySelector("#root")?.innerHTML?.slice(0, 600),
    rootChildText: document.querySelector("#root")?.textContent?.slice(0, 400),
    composerExists: !!document.querySelector("textarea.wb-composer__input"),
    noticeExists: !!document.querySelector(".app__notice"),
    noticeText: document.querySelector(".app__notice")?.textContent?.slice(0, 200),
  };
}).catch(e => ({ error: String(e) }));

console.log("\n[diag] ===== RESULT =====");
console.log("apiState:", JSON.stringify(apiState, null, 2));

console.log("\n[diag] ===== LAST 40 CONSOLE LINES =====");
for (const line of consoleLines.slice(-40)) console.log(line);

console.log("\n[diag] ===== PAGE ERRORS =====");
for (const err of pageErrors) console.log(err);

await app.close();
console.log("[diag] done");
process.exit(0);
