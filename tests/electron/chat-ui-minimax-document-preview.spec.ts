/**
 * chat-ui-minimax-document-preview.spec.ts — office1 stage 0A coverage.
 *
 * Verifies the existing `FilePreview` PDF iframe branch renders correctly
 * inside a real Electron renderer. The PDF mime path was added in
 * plan4.2 (chip rendering only); this spec confirms the **content
 * preview** layer (FilePreview's `<iframe src="data:application/pdf;...
 * base64,...">`) works end-to-end against a real PDF binary.
 *
 * Skips when no real-model credentials are present (matches the
 * convention of the other real-MiniMax specs — even though this spec
 * does not actually hit MiniMax, the doc-preview iframe only
 * materialises inside the chat surface that requires the same
 * Electron + provider setup).
 */
import { expect, test } from "./_fixtures";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveE2ECredentials, describeSource } from "../../scripts/lib/e2e-credentials.mjs";

const API_KEY = process.env.OPENBUDDY_E2E_API_KEY?.trim();
const BASE_URL = process.env.OPENBUDDY_E2E_BASE_URL?.trim();
const MODEL_ID = process.env.OPENBUDDY_E2E_MODEL_ID?.trim() ?? "MiniMax-M3";
const HAS_CREDS = Boolean(API_KEY && BASE_URL);

const PROVIDER_ID = "custom_anthropic";
const COMPOSER = "textarea.wb-composer__input";

const creds = resolveE2ECredentials({ provider: "minimax" });
console.log(`[chat-ui-minimax-document-preview] ${describeSource(creds)}`);

// A real, valid 1-page PDF (the same one inlined in
// capture-ai-chat-screenshots.mjs; 541 bytes, body "OpenBuddy design
// doc"). The point of the test is the iframe rendering, not the PDF
// semantics, so a minimal valid file is enough.
const SAMPLE_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBv" +
  "Ymo8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1szIDAgUl0+PmVuZG9iagozIDAgb2Jq" +
  "PDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNCAw" +
  "IFI+Pj4+L01lZGlhQm94WzAgMCA2MTIgNzkyXS9Db250ZW50cyA1IDAgUj4+ZW5kb2Jq" +
  "CjQgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2" +
  "ZXRpY2E+PmVuZG9iago1IDAgb2JqPDwvTGVuZ3RoIDQ0Pj5zdHJlYW0KQlQgL0YxIDEy" +
  "IFRmIDUwIDcwMCBUZCAoT3BlbkJ1ZGR5IGRlc2lnbiBkb2MpIFRqIEVUCmVuZHN0cmVh" +
  "bQplbmRvYmoKeHJlZWowIDYKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAw" +
  "MDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCjAwMDAwMDAy" +
  "MTIgMDAwMDAgbgowMDAwMDAwMjcxIDAwMDAwIG4KdHJhaWxlcjw8L1NpemUgNi9Sb290" +
  "IDEgMCBSPj4Kc3RhcnR4cmVmCjM2NQolJUVPRg==";

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
  await page.evaluate(
    async ({ channel, args }) => window.api.invoke(channel, args),
    {
      channel: "agent:providers-save-model",
      args: {
        model: { providerId: PROVIDER_ID, modelId: MODEL_ID, name: MODEL_ID, contextWindow: 128_000, reasoning: false },
      },
    },
  );
  await page.evaluate(
    async ({ channel, args }) => window.api.invoke(channel, args),
    { channel: "agent:new-session", args: { cwd, modelId: `${PROVIDER_ID}/${MODEL_ID}` } },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });
}

test.describe("office1 stage 0A — document preview (PDF iframe)", () => {
  test.beforeEach(() => {
    test.skip(!HAS_CREDS, "[chat-ui-minimax-document-preview] no real-model credentials");
  });

  test("a pasted PDF produces a PDF chip with the file name in its title", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-pdf-preview-"));
    await setup(page, cwd);

    // Paste the PDF — the Composer's `onPaste` handler routes
    // application/pdf through `readAttachmentFile`, which surfaces a chip
    // under `.composer-image-attachments`.
    await page.evaluate(
      ({ b64, name }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], name, { type: "application/pdf" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const target = document.querySelector("textarea.wb-composer__input");
        if (!target) throw new Error("composer textarea not found");
        const event = new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
      },
      { b64: SAMPLE_PDF_BASE64, name: "OpenBuddy-Design.pdf" },
    );

    const chip = page
      .locator(".composer-image-attachments__chip")
      .first();
    await chip.waitFor({ state: "visible", timeout: 5_000 });

    // The chip's `title` attribute carries the file name so hover
    // reveals it; we assert against the same attribute for resilience
    // (the visible chip text uses an inline `<img>` for the thumbnail).
    const chipTitle = await chip.getAttribute("title");
    expect(chipTitle, "chip title should mention the PDF file name").toBe(
      "OpenBuddy-Design.pdf",
    );
  });

  test("a pasted PDF renders a real PDF preview in the chat transcript after send", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-pdf-transcript-"));
    await setup(page, cwd);

    // Paste the PDF into the real Composer (same path as the chip test),
    // then type a prompt and hit the real send button. The message must
    // travel the production chain:
    //   Composer.onSendContent → App.handleSendContent →
    //   session-store.pushOptimisticUserContent → ChatView → MessageItem →
    //   FilePreview (kind "pdf" → <iframe src="data:application/pdf;base64,...">)
    await page.evaluate(
      ({ b64, name }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], name, { type: "application/pdf" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const target = document.querySelector("textarea.wb-composer__input");
        if (!target) throw new Error("composer textarea not found");
        target.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      },
      { b64: SAMPLE_PDF_BASE64, name: "OpenBuddy-Design.pdf" },
    );

    const chip = page.locator(".composer-image-attachments__chip").first();
    await chip.waitFor({ state: "visible", timeout: 5_000 });

    const composer = page.locator(COMPOSER).first();
    await composer.fill("请查看这个 PDF 附件");
    await page.locator('button[aria-label="发送"]').first().click();

    // The optimistic user bubble renders through the real React transcript
    // tree — not a hand-built DOM host — so this asserts the full chain.
    const preview = page.locator(".file-preview--pdf").first();
    await preview.waitFor({ state: "visible", timeout: 15_000 });

    const iframe = page.locator(".file-preview--pdf iframe").first();
    await expect(iframe).toHaveAttribute("src", /^data:application\/pdf;base64,/);
    await expect(iframe).toHaveAttribute("title", "OpenBuddy-Design.pdf");
  });

  test("rejected MIME (.zip) does NOT surface a chip (toast wording may vary)", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-pdf-reject-"));
    await setup(page, cwd);

    await page.evaluate(() => {
      const bytes = Uint8Array.from(atob("PK fake zip bytes"), (c) => c.charCodeAt(0));
      const file = new File([bytes], "evil.zip", { type: "application/zip" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector("textarea.wb-composer__input");
      if (!target) throw new Error("composer textarea not found");
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });

    // 1s grace for any toast, then assert no chip rendered.
    await page.waitForTimeout(800);
    expect(
      await page.locator(".composer-image-attachments__chip").count(),
      "no chip for .zip",
    ).toBe(0);
  });
});
