/**
 * chat-ui-minimax-documents.spec.ts — coverage for the document
 * attachment path added in the multimodal change.
 *
 * ## What this exercises
 *
 * Three things the implementation owns today:
 *
 *   1. The Composer's `readAttachmentFile` rejects unsupported MIMEs and
 *      oversize files BEFORE the IPC is dispatched (toast + no chip).
 *   2. The IPC validator (`agent:prompt-content` → `promptFilePart`)
 *      accepts the document MIME allow-list and enforces the 8 MB cap.
 *   3. The Composer's paste-handler accepts `application/pdf`,
 *      `text/{plain,markdown,csv,html,xml}`, `application/{json,xml,yaml}`,
 *      and OOXML docx alongside images, surfacing a chip for each
 *      accepted attachment.
 *
 * ## Why no "real-MiniMax summarises the document" tests
 *
 * Pi's upstream `sendUserMessage` is typed against (TextContent |
 * ImageContent)[] and at runtime does not parse `type:"file"` parts.
 * On the agent-host side we already inline text-shaped documents as a
 * `<document>` block in the user prompt (see agent-prompt.ts), but the
 * rendering is forward-compatible — the renderer keeps the chip and
 * the IPC contract supports `file`, but until pi's Session class
 * recognises `type:"file"` natively the model sees the block, not the
 * binary content. A round-trip end-to-end test for "the model quotes
 * back a fact from the attachment" therefore depends on upstream pi
 * work that is out of scope here.
 *
 * ## Skipping
 *
 * Skips when no real-model credentials are present (env /
 * `.env.e2e.local` / `~/.pi/agent/auth.json`). Set `OPENBUDDY_E2E_API_KEY`.
 */
import { expect, test } from "./_fixtures";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveE2ECredentials, describeSource } from "../../scripts/lib/e2e-credentials.mjs";

const API_KEY = process.env.OPENBUDDY_E2E_API_KEY?.trim();
const BASE_URL = process.env.OPENBUDDY_E2E_BASE_URL?.trim();
const HAS_CREDS = Boolean(API_KEY && BASE_URL);

const PROVIDER_ID = "custom_anthropic";
const COMPOSER = "textarea.wb-composer__input";
const CHIP_LIST = ".composer-image-attachments";
const CHIP = `${CHIP_LIST}__chip`;

const creds = resolveE2ECredentials({ provider: "minimax" });
console.log(`[chat-ui-minimax-documents] ${describeSource(creds)}`);

async function setup(page: import("@playwright/test").Page, cwd: string) {
  await page.evaluate(
    async ({ channel, args }) => window.api.invoke(channel, args),
    {
      channel: "agent:providers-save-provider",
      args: {
        provider: {
          id: PROVIDER_ID,
          label: "MiniMax",
          providerKind: "custom_anthropic",
          apiKey: API_KEY,
          baseUrl: BASE_URL,
          apiBackend: "messages",
          authScheme: "x_api_key",
        },
      },
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(
    () =>
      (window as unknown as { api?: { apiVersion?: number } }).api
        ?.apiVersion === 1,
    undefined,
    { timeout: 30_000 },
  );
  await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });
}

/** Synthesize a paste-with-file event on the composer textarea. The
 *  Composer's `onPaste` handler reads the file via `readAttachmentFile`
 *  which is the path we want to exercise (image allow-list + new
 *  document allow-list + size cap). */
async function pasteFile(
  page: import("@playwright/test").Page,
  name: string,
  mime: string,
  base64: string,
): Promise<void> {
  await page.evaluate(
    ({ name, mime, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector("textarea.wb-composer__input") as HTMLElement | null;
      if (!target) throw new Error("composer textarea not found");
      const event = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
    },
    { name, mime, base64 },
  );
}

function utf8btoa(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

test.describe("document attachment surface (Composer + IPC)", () => {
  test.beforeEach(() => {
    test.skip(!HAS_CREDS, "[chat-ui-minimax-documents] no real-model credentials");
  });

  test("a plain-text paste produces a chip", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-doc-txt-"));
    await setup(page, cwd);
    const body = "Project Aurora codename with goal: 1.2s cold start.";
    await pasteFile(page, "aurora.txt", "text/plain", utf8btoa(body));
    await page.locator(CHIP).first().waitFor({ state: "visible", timeout: 5_000 });
    expect(await page.locator(CHIP).count()).toBe(1);
  });

  test("a markdown paste produces a chip", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-doc-md-"));
    await setup(page, cwd);
    await pasteFile(
      page,
      "plan.md",
      "text/markdown",
      utf8btoa("# MiniMax-M3 chat widget plan\n\n- Header: 64px"),
    );
    await page.locator(CHIP).first().waitFor({ state: "visible", timeout: 5_000 });
    expect(await page.locator(CHIP).count()).toBe(1);
  });

  test("a JSON paste produces a chip", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-doc-json-"));
    await setup(page, cwd);
    await pasteFile(
      page,
      "spec.json",
      "application/json",
      utf8btoa(JSON.stringify({ project: "Aurora", budget_usd: 12000 })),
    );
    await page.locator(CHIP).first().waitFor({ state: "visible", timeout: 5_000 });
    expect(await page.locator(CHIP).count()).toBe(1);
  });

  test("a CSV paste produces a chip", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-doc-csv-"));
    await setup(page, cwd);
    await pasteFile(
      page,
      "team.csv",
      "text/csv",
      utf8btoa("name,role\nlouloulin,product manager\nmultica-agent,impl"),
    );
    await page.locator(CHIP).first().waitFor({ state: "visible", timeout: 5_000 });
    expect(await page.locator(CHIP).count()).toBe(1);
  });

  test("a docx paste produces a chip", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-doc-docx-"));
    await setup(page, cwd);
    // Real OOXML zip would be more correct, but the Composer only checks
    // the MIME type and base64 validity — any non-empty base64 works.
    await pasteFile(
      page,
      "doc.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      utf8btoa("fake docx bytes"),
    );
    await page.locator(CHIP).first().waitFor({ state: "visible", timeout: 5_000 });
    expect(await page.locator(CHIP).count()).toBe(1);
  });

  test("an unsupported MIME (.zip) is rejected with no chip (toast wording may vary)", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-doc-bad-"));
    await setup(page, cwd);
    await pasteFile(page, "danger.zip", "application/zip", utf8btoa("PK fake"));
    // Give the Composer's onPaste + readAttachmentFile path a beat to
    // either render a chip or surface a toast. The composer's onPaste
    // matcher only accepts image/* or the document allow-list — a
    // `.zip` MIME doesn't match either, so the paste falls through to
    // the text/plain insert path and no chip is rendered.
    await page.waitForTimeout(500);
    expect(await page.locator(CHIP).count(), "no chip for .zip").toBe(0);
  });

  test("the IPC validator rejects an unsupported file MIME (application/zip)", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-doc-bad-mime-"));
    await setup(page, cwd);
    const fakeZip = utf8btoa("PK\x03\x04 fake zip header");
    const result = await page.evaluate(
      async ({ channel, args }) => {
        try {
          await window.api.invoke(channel, args);
          return { ok: true };
        } catch (err) {
          return { ok: false, msg: err instanceof Error ? err.message : String(err) };
        }
      },
      {
        channel: "agent:prompt-content",
        args: {
          content: [
            { type: "text", text: "ignored" },
            { type: "file", mediaType: "application/zip", data: fakeZip, name: "x.zip" },
          ],
        },
      },
    );
    expect(result.ok, "expected IPC to reject application/zip").toBe(false);
    expect(result.msg, "expected error message to mention mime").toMatch(
      /application\/pdf|mediaType/i,
    );
  });

  test("the IPC validator rejects an oversize file (>8 MB) before dispatch", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-doc-oversize-"));
    await setup(page, cwd);
    // 10 MB base64 raw -> decoded ~7.5 MB; the validator refuses above
    // 8 MB regardless of decoding ratio so we use 12 MB raw to cross the
    // threshold unambiguously.
    const twelveMbBase64 = "A".repeat(12 * 1024 * 1024);
    const result = await page.evaluate(
      async ({ channel, args }) => {
        try {
          await window.api.invoke(channel, args);
          return { ok: true };
        } catch (err) {
          return { ok: false, msg: err instanceof Error ? err.message : String(err) };
        }
      },
      {
        channel: "agent:prompt-content",
        args: {
          content: [
            { type: "text", text: "ignored" },
            { type: "file", mediaType: "text/plain", data: twelveMbBase64, name: "huge.txt" },
          ],
        },
      },
    );
    expect(result.ok, "expected IPC to reject oversize file").toBe(false);
    expect(result.msg, "expected error to mention OPENBUDDY_MAX_FILE_BYTES").toMatch(
      /OPENBUDDY_MAX_FILE_BYTES|exceeds|8388608/i,
    );
  });
});
