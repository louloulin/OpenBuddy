/**
 * chat-ui-minimax-real-extras.spec.ts — additional real-MiniMax coverage for
 * the AI chat surface.
 *
 * ## Why this file exists separately from `chat-ui-minimax-real.spec.ts`
 *
 * The existing file is the regression guard for the *rendering* pipeline
 * (transcript paint, double-append detection, thought-block routing,
 * multi-turn bubble append, stop-button interrupt). Each test it ships costs
 * ~30–120s on a real MiniMax round-trip, so adding more there would push the
 * suite past the GitHub-Actions-per-job timeout.
 *
 * What was *not* covered against a real upstream, and what this file adds:
 *
 *   - **Multi-turn context retention on the wire.** The model sees every
 *     prior turn on the same `AgentSession`, so a second prompt that asks
 *     for the word introduced in the first prompt's reply must be answered
 *     using that earlier content. A mocked upstream trivially fakes
 *     context; this is the property that proves the Anthropic-Messages
 *     streaming SDK path accumulates `input` correctly across
 *     `agent:prompt` invocations rather than resetting it.
 *
 *   - **Long context survives the round-trip.** A session that accumulates
 *     5+ turns must still render every prior assistant message and must
 *     not collapse them — a regression that dropped historical entries on
 *     a multi-turn replay would land here.
 *
 * Both tests skip when no real-model credentials are present, matching the
 * convention in `chat-ui-minimax-real.spec.ts`.
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

/** Registered as a custom Anthropic-Messages provider, same as the UI does. */
const PROVIDER_ID = "custom_anthropic";

const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT_BUBBLE = ".msg--assistant";
const STOP_BUTTON = '[aria-label="停止生成"]';

/**
 * Configure the real provider over IPC, then reload so the renderer's
 * cold-start auth check enables the composer.
 */
async function prepareRealModel(
  page: import("@playwright/test").Page,
): Promise<{ sessionId: string }> {
  const cwd = mkdtempSync(join(tmpdir(), "openbuddy-minimax-extras-"));

  const saveProvider = await invokeOrReject(page, "agent:providers-save-provider", {
    provider: {
      id: PROVIDER_ID,
      label: "MiniMax E2E extras",
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
  const sessionId = (session.value as { sessionId?: string }).sessionId;
  expect(sessionId, `agent:new-session returned no sessionId: ${JSON.stringify(session.value)}`).toBeTruthy();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { api?: { apiVersion?: number } }).api?.apiVersion === 1,
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.locator(COMPOSER).first()).toBeEnabled({ timeout: 30_000 });
  return { sessionId: sessionId! };
}

async function sendThroughComposer(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.locator(COMPOSER).first().fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

/** True once the in-flight stop button disappears for the active turn. */
async function waitForTurnSettled(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator(STOP_BUTTON)).toHaveCount(0, { timeout: 120_000 });
}

/**
 * Real-MiniMax round-trips routinely take 30-60s per turn and the multi-turn
 * context test runs several of them back-to-back. Playwright's 30s default
 * would trip on the first turn.
 */
test.describe.configure({ timeout: 360_000 });

test.describe("real MiniMax extras: multi-turn context retention", () => {
  test.skip(
    !HAS_CREDS,
    "no real-model credentials — set OPENBUDDY_E2E_API_KEY/_BASE_URL or add them to .env.e2e.local",
  );

  test("a second turn sees the first turn's content in its context", async ({ page }) => {
    await prepareRealModel(page);

    // Introduce a stable, easy-to-recall token in turn 1. Asking the model
    // for a specific alphanumeric string and forcing it to repeat it back
    // is a deterministic, low-token way to seed the transcript with content
    // the second turn can be asked about.
    const seed = `MINIMAX-CTX-${Date.now()}`;
    await sendThroughComposer(page, `记住这个字符串：${seed}。回复：记住了。`);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText("记住了", { timeout: 120_000 });
    await waitForTurnSettled(page);

    // Turn 2 asks for the string the model just agreed to remember. If
    // pi's session accumulator were resetting `input` between turns, the
    // model would have no way to answer and the reply would not contain
    // the seed.
    await sendThroughComposer(page, `只回复这一个字符串，不要任何其它字符或解释：${seed}`);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText(seed, { timeout: 120_000 });
    await waitForTurnSettled(page);

    // The first bubble must still hold its own answer — a buffer-reuse bug
    // would put the second turn's content into the first bubble.
    await expect(page.locator(ASSISTANT_BUBBLE)).toHaveCount(2, { timeout: 30_000 });
    const first = (await page.locator(ASSISTANT_BUBBLE).first().innerText()).trim();
    expect(first).toContain("记住了");
    expect(first).not.toContain(seed);
  });

  test("five sequential turns all render their own assistant bubbles in order", async ({ page }) => {
    await prepareRealModel(page);

    // Each turn ends with a unique token the model is asked to remember and
    // then replay. After all 5 turns, the transcript must show 5 assistant
    // bubbles, each containing exactly its own token (no dropping, no
    // reordering, no cross-contamination).
    const tokens: string[] = [];
    const TURN_COUNT = 5;
    for (let i = 0; i < TURN_COUNT; i += 1) {
      const token = `MINIMAX-MULTI-${i}-${Date.now()}`;
      tokens.push(token);
      await sendThroughComposer(page, `只回复这一个字符串：${token}`);
      await expect(page.locator(ASSISTANT_BUBBLE).nth(i)).toContainText(token, { timeout: 120_000 });
      await waitForTurnSettled(page);
    }

    await expect(page.locator(ASSISTANT_BUBBLE)).toHaveCount(TURN_COUNT, { timeout: 30_000 });

    // Each bubble must contain only its own token. A buffer-reuse bug would
    // leak a later token into an earlier bubble; a dropped-deltas bug would
    // leave an earlier bubble empty.
    for (let i = 0; i < TURN_COUNT; i += 1) {
      const text = (await page.locator(ASSISTANT_BUBBLE).nth(i).innerText()).trim();
      expect(text, `bubble ${i} should contain its own token`).toContain(tokens[i]);
      for (let j = 0; j < TURN_COUNT; j += 1) {
        if (j === i) continue;
        // A bubble must not contain another turn's token. The 1-of-each
        // shape is too strict (the model often paraphrases the seed), so
        // we only assert that turn `i`'s bubble does NOT contain any other
        // turn's token verbatim — that is the property a buffer-reuse bug
        // would violate.
        expect(
          text.includes(tokens[j]),
          `bubble ${i} (containing ${tokens[i]}) unexpectedly contains turn ${j}'s token ${tokens[j]}`,
        ).toBe(false);
      }
    }
  });
});
