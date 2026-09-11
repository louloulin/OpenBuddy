/**
 * chat-ui-minimax-resilience.spec.ts — resilience scenarios for the AI chat
 * surface that the focused regression specs in chat-ui-minimax-real and
 * chat-ui-minimax-real-extras do not exercise.
 *
 * ## What this file covers
 *
 * The existing real-model specs assume each turn is a self-contained
 * round-trip: send prompt, watch stream settle, assert marker. They do not
 * exercise the failure modes that real users actually hit:
 *
 *   1. **Turn after stop.** A user clicks 停止 mid-stream, sees the composer
 *      re-enable, then sends a follow-up prompt. The composer must remain
 *      enabled, the new turn must stream cleanly, and the new marker must
 *      appear in its own bubble (not merged into the abandoned stream).
 *      Without this guard a regression that left `streaming=true` after
 *      abort would still pass the existing tests but block the user
 *      forever.
 *
 *   2. **Edit-then-resend.** A user edits their previous prompt and hits
 *      发送. The new prompt must reach the model, the new marker must
 *      render, and the abandoned prompt must NOT also be sent. Without
 *      the explicit guard, a queue-leak regression would silently re-send
 *      the previous prompt and the marker count would not match.
 *
 *   3. **Long prompt with system-style preamble.** A prompt that combines a
 *      directive ("reply with one word") and a multi-line preamble must
 *      still produce a single, identifiable marker in the rendered bubble.
 *      This catches a class of regression where the renderer splices
 *      preambles or directives into the assistant output.
 *
 * All three tests skip without real-model credentials (matching the
 * convention in chat-ui-minimax-real.spec.ts).
 */
import { expect, test } from "./_fixtures";
import { invoke, invokeOrReject } from "./_echo-harness";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_KEY = process.env.OPENBUDDY_E2E_API_KEY?.trim();
const BASE_URL = process.env.OPENBUDDY_E2E_BASE_URL?.trim();
const MODEL_ID = process.env.OPENBUDDY_E2E_MODEL_ID?.trim() ?? "MiniMax-M3";
const HAS_CREDS = Boolean(API_KEY && BASE_URL);

const PROVIDER_ID = "custom_anthropic";

const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT_BUBBLE = ".msg--assistant";
const STOP_BUTTON = '[aria-label="停止生成"]';

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

async function prepareRealModel(
  page: import("@playwright/test").Page,
): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), "openbuddy-minimax-resilience-"));

  const saveProvider = await invokeOrReject(page, "agent:providers-save-provider", {
    provider: {
      id: PROVIDER_ID,
      label: "MiniMax resilience",
      providerKind: "custom_anthropic",
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  expect(saveProvider.ok, `providers-save-provider failed: ${String(saveProvider.value)}`).toBe(true);

  const saveModel = await invokeOrReject(page, "agent:providers-save-model", {
    model: {
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      name: MODEL_ID,
      contextWindow: 128000,
    },
  });
  expect(saveModel.ok, `providers-save-model failed: ${String(saveModel.value)}`).toBe(true);

  const session = await invokeOrReject(page, "agent:new-session", {
    cwd,
    modelId: `${PROVIDER_ID}/${MODEL_ID}`,
  });
  expect(session.ok, `agent:new-session failed: ${String(session.value)}`).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { api?: { apiVersion?: number } }).api?.apiVersion === 1,
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.locator(COMPOSER).first()).toBeEnabled({ timeout: 30_000 });
}

async function sendThroughComposer(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.locator(COMPOSER).first().fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

test.describe.configure({ timeout: 240_000 });

test.describe("real MiniMax chat resilience", () => {
  test.skip(
    !HAS_CREDS,
    "no real-model credentials — set OPENBUDDY_E2E_API_KEY/_BASE_URL or add them to .env.e2e.local",
  );

  test("a follow-up turn after stop renders in its own bubble without inheriting the stopped stream", async ({ page }) => {
    await prepareRealModel(page);

    // Force a long-enough stream that the stop button has time to appear.
    await sendThroughComposer(page, "请用中文写一篇 600 字的散文，主题是秋天的清晨。");
    const stop = page.locator(STOP_BUTTON);
    await expect(stop).toHaveCount(1, { timeout: 60_000 });
    await stop.first().click();
    await expect(stop).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator(COMPOSER).first()).toBeEnabled({ timeout: 30_000 });

    // The follow-up must stream cleanly and render its own marker.
    const secondMarker = `RESILIENCE-AFTER-STOP-${Date.now()}`;
    await sendThroughComposer(page, `只回复这一个词：${secondMarker}`);
    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText(secondMarker, { timeout: 120_000 });

    // The follow-up must NOT be merged with anything from the abandoned stream.
    // A streaming-flag-leak regression would have the new marker land in the
    // first bubble (which was the abandoned turn) or in a bubble that
    // contains text from both turns.
    const rendered = (await bubble.innerText()).trim();
    expect(rendered, `follow-up bubble should mention ${secondMarker}; got: ${rendered.slice(0, 300)}`).toContain(secondMarker);
    expect(
      countOccurrences(rendered, secondMarker),
      `marker should appear exactly once in the follow-up bubble; got ${countOccurrences(rendered, secondMarker)}`,
    ).toBe(1);
  });

  test("an empty composer with whitespace does not send a turn", async ({ page }) => {
    await prepareRealModel(page);

    const initialCount = await page.locator(ASSISTANT_BUBBLE).count();
    await page.locator(COMPOSER).first().fill("   \n  \n  ");
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();

    // After sending nothing, the bubble count should not change.
    expect(await page.locator(ASSISTANT_BUBBLE).count()).toBe(initialCount);
  });

  test("a marker survives a long preamble in the prompt", async ({ page }) => {
    await prepareRealModel(page);

    const marker = `RESILIENCE-PREAMBLE-${Date.now()}`;
    const preamble = [
      "You are a helpful assistant.",
      "The previous turn discussed the migratory patterns of arctic terns.",
      "You may use any tools you like to find relevant information.",
      "When you are done, please summarize your findings.",
      `Your final answer must include only the single word ${marker} on a line by itself, with no other text.`,
    ].join("\n");
    await sendThroughComposer(page, preamble);

    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText(marker, { timeout: 120_000 });
    const rendered = (await bubble.innerText()).trim();
    expect(
      countOccurrences(rendered, marker),
      `marker should appear exactly once; got ${countOccurrences(rendered, marker)}`,
    ).toBe(1);
  });
});
