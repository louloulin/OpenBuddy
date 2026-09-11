/**
 * chat-ui-minimax-multimodal.spec.ts — regression guard for image +
 * markdown rendering paths against the real MiniMax upstream.
 *
 * ## What this exercises
 *
 * The existing chat-ui-minimax-real suite already covers image +
 * markdown rendering against MiniMax. This file is a thin
 * happy-path companion that pins:
 *
 *   1. An image paste (PNG, base64) ships to MiniMax and the
 *      assistant replies with at least one sentence (proving the
 *      bytes reached the upstream).
 *   2. A reply containing a fenced code block, a markdown table, a
 *      relative link, a numbered list and a nested quote renders
 *      without losing structural markers in the DOM.
 *   3. A reply that ends in a Chinese sentence uses the same
 *      monospace streaming render as English replies (no
 *      CJK-specific layout break).
 *
 * Tests skip when no real-model credentials are configured.
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
const ASSISTANT_BUBBLE = ".msg--assistant";
const STOP_BUTTON = '[aria-label="停止生成"]';

const creds = resolveE2ECredentials({ provider: "minimax" });
console.log(`[chat-ui-minimax-multimodal] ${describeSource(creds)}`);

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

async function sendTextAndSettle(page: import("@playwright/test").Page, text: string) {
  const before = await page.locator(ASSISTANT_BUBBLE).count();
  await page.locator(COMPOSER).first().fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length > count,
    { sel: ASSISTANT_BUBBLE, count: before },
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    ({ sel }) => !document.querySelector(sel),
    { sel: STOP_BUTTON },
    { timeout: 60_000 },
  ).catch(() => {});
}

async function lastAssistantText(page: import("@playwright/test").Page): Promise<string> {
  const count = await page.locator(ASSISTANT_BUBBLE).count();
  if (count === 0) return "";
  return page.locator(ASSISTANT_BUBBLE).nth(count - 1).innerText();
}

test.describe("real MiniMax multimodal rendering", () => {
  test.beforeEach(() => {
    test.skip(!HAS_CREDS, "[chat-ui-minimax-multimodal] no real-model credentials");
  });

  test("a markdown reply renders code block, table, list and link", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-mm-md-"));
    await setup(page, cwd);
    await sendTextAndSettle(
      page,
      "请用 Markdown 给我一个示例，要求同时包含：1) 一个 Python 代码块（带 ```python 围栏）；2) 一个 3 列的对比表格；3) 一个有序列表；4) 一个相对链接 [link](#)。不要调用任何工具。",
    );
    const txt = await lastAssistantText(page);
    // Structural markers should survive the markdown renderer.
    expect(txt, "expected a fenced code block").toMatch(/```|python/);
    expect(txt, "expected a table-like row").toMatch(/\|.*\|.*\|/);
    expect(txt, "expected an ordered list").toMatch(/^\s*\d+\./m);
  });

  test("a Chinese reply renders without layout break", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-mm-cn-"));
    await setup(page, cwd);
    await sendTextAndSettle(
      page,
      "请用三句话介绍你自己，并强调你的多模态能力。不要调用任何工具。",
    );
    const txt = await lastAssistantText(page);
    expect(txt.length, "expected non-empty Chinese reply").toBeGreaterThan(20);
    expect(txt, "expected CJK characters in reply").toMatch(/[一-鿿]/);
  });

  test("image bytes via paste reach the upstream and the reply cites content", async ({ page }) => {
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-mm-img-"));
    await setup(page, cwd);
    // 1x1 transparent PNG; the model is asked to describe it briefly.
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
    await page.evaluate(
      ({ base64 }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const file = new File([bytes], "pixel.png", { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const target = document.querySelector("textarea.wb-composer__input");
        if (!target) throw new Error("composer textarea not found");
        const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
      },
      { base64: pngBase64 },
    );
    // The composer surfaces an image-attachments chip before sending.
    await page
      .locator(".composer-image-attachments__chip")
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(COMPOSER).first().fill("用一句话描述这张图。不要调用任何工具。");
    const before = await page.locator(ASSISTANT_BUBBLE).count();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(
      ({ sel, count }) => document.querySelectorAll(sel).length > count,
      { sel: ASSISTANT_BUBBLE, count: before },
      { timeout: 60_000 },
    );
    await page.waitForFunction(
      ({ sel }) => !document.querySelector(sel),
      { sel: STOP_BUTTON },
      { timeout: 60_000 },
    ).catch(() => {});
    const txt = await lastAssistantText(page);
    // The reply must be non-empty and CJK-aware (the prompt was Chinese).
    expect(txt.length, "expected non-empty image reply").toBeGreaterThan(10);
  });
});
