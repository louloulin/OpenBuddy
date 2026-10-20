import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17af-"));
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

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(2500);

// Click 审计追踪
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = buttons.find((el) => (el.textContent ?? "").trim() === "审计追踪");
  if (t) t.click();
});
await page.waitForTimeout(2500);

const panel = await page.evaluate(() => {
  const p = document.querySelector(".settings-modal__panel");
  if (!p) return { found: false };
  const rows = Array.from(p.querySelectorAll(".audit-trail__row"));
  return {
    found: true,
    title: p.querySelector("h2, h3")?.textContent?.trim(),
    rows: rows.length,
    sample: rows.slice(0, 4).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent?.trim())),
    chainHint: (p.textContent ?? "").includes("链式 SHA-256"),
    hasSearch: !!p.querySelector("input[type='search']"),
    hasClear: !!Array.from(p.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("清空本地审计")),
  };
});
console.log("PANEL:", JSON.stringify(panel, null, 2));

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-audit-final.png") });

const file = join(userData, "audit.jsonl");
const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
console.log("FILE:", JSON.stringify({ exists: existsSync(file), count: lines.length, sample: lines.slice(0, 3).map((l) => { try { const j = JSON.parse(l); return { event: j.event, subject: j.subject, hash: j.hash }; } catch { return l; } }) }, null, 2));

await app.close();
process.exit(0);
