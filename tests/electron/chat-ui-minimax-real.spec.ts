/**
 * chat-ui-minimax-real.spec.ts — composer-driven verification against a REAL LLM.
 *
 * ## What this covers that nothing else does
 *
 * `minimax-real-roundtrip.spec.ts` talks to a real model but only through
 * `api.invoke("agent:prompt")`, asserting raw `pi://update` payloads.
 * `chat-ui-streaming.spec.ts` drives the composer and asserts the transcript,
 * but against the deterministic local echo upstream. Neither combination caught
 * the bug class that actually shipped: the backend streamed a correct answer,
 * every wire assertion passed, and the transcript showed nothing but a
 * "等待中" placeholder — for minutes.
 *
 * The reason a real model matters here rather than just the echo is timing.
 * MiniMax-M3 answers a one-word prompt in ~1.4s, delivering all deltas and the
 * terminal event inside a couple of animation frames. That burst is what lost
 * the race against the renderer's flush scheduling; the echo upstream, being
 * local and instant in a different way, did not reproduce it reliably.
 *
 * ## Skipping
 *
 * Credentials resolve through `scripts/lib/e2e-credentials.mjs`
 * (environment → `.env.e2e.local` → `~/.pi/agent/auth.json`), hydrated into
 * `process.env` by `playwright.config.ts`. With no credentials on the machine
 * this whole file skips and the rest of the suite is unaffected.
 *
 * ## Assertion style
 *
 * Occurrence counts, never `includes()`. The corrupted double-append this
 * suite exists to catch ("DIDIAG-OKAG-OK") *contains* the marker, so a
 * `toContain` assertion passed while the transcript was visibly broken. A
 * repeated-substring check backs it up, because a real model's exact wording
 * around the marker cannot be pinned the way the echo's can.
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

/** The placeholder rendered while a turn is in flight. */
const PENDING_PLACEHOLDER = "等待中";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Detect the signature of a double-appended stream.
 *
 * The failure mode interleaves two copies of the same content, which shows up
 * as an immediately-repeated substring of non-trivial length ("DIDIAG-OKAG-OK"
 * contains "DI" twice back to back around the split). Natural model prose does
 * produce short repeats, so the threshold is deliberately >=4 characters.
 */
function hasAdjacentRepeat(text: string): string | null {
  const match = text.match(/(.{4,})\1/su);
  return match ? match[1] : null;
}

/**
 * Configure the real provider over IPC, then reload so the renderer's
 * cold-start auth check enables the composer.
 */
async function prepareRealModel(
  page: import("@playwright/test").Page,
  opts: { reasoning?: boolean; thinkingLevel?: "off" | "low" | "medium" | "high" } = {},
): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), "openbuddy-minimax-ui-"));

  const saveProvider = await invokeOrReject(page, "agent:providers-save-provider", {
    provider: {
      id: PROVIDER_ID,
      label: "MiniMax E2E",
      providerKind: "custom_anthropic",
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  expect(saveProvider.ok, `providers-save-provider failed: ${String(saveProvider.value)}`).toBe(true);

  // `reasoning: true` is what lets `agent:set-thinking-level` actually take —
  // pi clamps any level to "off" for a model registered without it, which
  // silently disables the entire thought channel. See the bridge/store fix.
  const saveModel = await invokeOrReject(page, "agent:providers-save-model", {
    model: {
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      name: MODEL_ID,
      contextWindow: 128000,
      ...(opts.reasoning ? { reasoning: true } : {}),
    },
  });
  expect(saveModel.ok, `providers-save-model failed: ${String(saveModel.value)}`).toBe(true);

  const session = await invokeOrReject(page, "agent:new-session", {
    cwd,
    modelId: `${PROVIDER_ID}/${MODEL_ID}`,
  });
  expect(session.ok, `agent:new-session failed: ${String(session.value)}`).toBe(true);

  if (opts.thinkingLevel && opts.thinkingLevel !== "off") {
    const applied = await invokeOrReject(page, "agent:set-thinking-level", { level: opts.thinkingLevel });
    expect(applied.ok, `set-thinking-level failed: ${String(applied.value)}`).toBe(true);
    // Prove the level actually took (not clamped to "off"), otherwise a
    // "reasoning renders" test would pass vacuously with no thought stream.
    expect(
      (applied.value as { level?: string })?.level,
      `thinking level was clamped: ${JSON.stringify(applied.value)} — model likely saved without reasoning:true`,
    ).toBe(opts.thinkingLevel);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { api?: { apiVersion?: number } }).api?.apiVersion === 1,
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.locator(COMPOSER).first()).toBeEnabled({ timeout: 30_000 });
}

/** Capture completes so the once-per-turn contract can be asserted. */
async function captureCompletes(page: import("@playwright/test").Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __realUiCompletes?: unknown[];
      api?: { events?: { on: (c: string, h: (p: unknown) => void) => () => void } };
    };
    w.__realUiCompletes = [];
    const api = w.api;
    if (!api?.events?.on) throw new Error("renderer bridge events.on is unavailable");
    api.events.on("pi://complete", (payload) => {
      (w.__realUiCompletes as unknown[]).push(payload);
    });
  });
  return async () =>
    page.evaluate(
      () => ((window as unknown as { __realUiCompletes?: unknown[] }).__realUiCompletes ?? []).length,
    );
}

async function sendThroughComposer(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.locator(COMPOSER).first().fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

/**
 * Playwright's default per-test timeout is 30s, which is not enough here: each
 * test boots Electron, registers a provider, reloads the renderer, and then
 * waits on a real network round-trip to MiniMax (plus a 600-word generation in
 * one case). The generous per-expect timeouts below are meaningless without
 * raising the test budget that contains them.
 */
test.describe.configure({ timeout: 240_000 });

test.describe("real MiniMax turn renders in the transcript", () => {
  test.skip(
    !HAS_CREDS,
    "no real-model credentials — set OPENBUDDY_E2E_API_KEY/_BASE_URL or add them to .env.e2e.local",
  );

  test("a one-word answer renders exactly once and settles", async ({ page }) => {
    await prepareRealModel(page);
    const readCompletes = await captureCompletes(page);

    const marker = `UIREAL-${Date.now()}`;
    await sendThroughComposer(page, `只回复这一个词：${marker}`);

    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText(marker, { timeout: 120_000 });

    const rendered = (await bubble.innerText()).trim();
    expect(
      countOccurrences(rendered, marker),
      `marker rendered ${countOccurrences(rendered, marker)}x, expected 1. Transcript:\n${rendered}`,
    ).toBe(1);

    const repeat = hasAdjacentRepeat(rendered);
    expect(repeat, `transcript contains an adjacent repeated run (${JSON.stringify(repeat)}), which is the double-append signature:\n${rendered}`).toBeNull();

    // The turn must actually finish: placeholder gone, stop button gone.
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0, { timeout: 60_000 });
    await expect(bubble).not.toContainText(PENDING_PLACEHOLDER);

    // Exactly one terminal event. Pi emits turn_end, agent_end AND
    // agent_settled per prompt; mapping each to `pi://complete` gave four, and
    // every once-per-turn side effect (usage accounting, desktop notification,
    // message-queue release) ran four times.
    await page.waitForTimeout(1_500);
    const completes = await readCompletes();
    expect(completes, `expected 1 pi://complete for one real turn, got ${completes}`).toBe(1);
  });

  /**
   * A longer answer means many more deltas across many more frames, which is
   * where an off-by-one in delta merging or a dropped flush shows up as
   * duplicated or missing spans rather than a total stall.
   */
  test("a multi-line answer accumulates without duplicating spans", async ({ page }) => {
    await prepareRealModel(page);

    await sendThroughComposer(
      page,
      "用中文分三行回答，每行以 LINE 开头并编号：LINE1、LINE2、LINE3，不要输出其他内容。",
    );

    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText("LINE3", { timeout: 120_000 });
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0, { timeout: 60_000 });

    const rendered = (await bubble.innerText()).trim();
    for (const token of ["LINE1", "LINE2", "LINE3"]) {
      expect(
        countOccurrences(rendered, token),
        `${token} appeared ${countOccurrences(rendered, token)}x in:\n${rendered}`,
      ).toBe(1);
    }
  });

  /**
   * Reasoning must not be printed as the answer.
   *
   * A coalescer in `ipc/index.ts` used to enqueue `thinking_delta` into the
   * same buffer it used for answer text and publish it on
   * `agent_message_chunk`, so reasoning tokens arrived labelled as visible
   * text. Separately, the renderer fed `agent_thought_chunk` into
   * `appendStreamingDelta` with its default "text" kind, merging reasoning into
   * the answer body. `MessageItem` renders `thought` parts as a collapsible
   * 深度思考 block, so correct behaviour is: reasoning either appears inside
   * that block or not at all — never inline in the answer.
   *
   * This asserts the observable invariant rather than requiring the provider to
   * emit reasoning (whether it does depends on the model and request options).
   */
  test("reasoning renders in the thought block and never leaks into the answer body", async ({ page }) => {
    // Enable reasoning + high thinking. `prepareRealModel` asserts the level was
    // NOT clamped to "off" — that assertion alone is the regression guard for
    // the saveModel-drops-reasoning bug (MiniMax-M3 reasons, but a model saved
    // without `reasoning:true` reports no thinking support and clamps to off).
    await prepareRealModel(page, { reasoning: true, thinkingLevel: "high" });

    await sendThroughComposer(
      page,
      "请先展示你的推理过程，再在最后单独一行输出：ANSWER=<24除以6的结果>。",
    );

    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText("ANSWER=", { timeout: 120_000 });
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0, { timeout: 60_000 });

    // A reasoning turn must produce a collapsible 深度思考 block. This is the
    // channel that was completely dead before the fixes: no thought part was
    // ever created during streaming.
    const thought = bubble.locator(".msg__thought");
    await expect(thought).toHaveCount(1, { timeout: 15_000 });

    // The answer body must carry exactly one ANSWER= line and the result — the
    // reasoning prose belongs in the thought block, not spliced into the answer
    // (the "reasoning leaked into the answer" regression).
    const bodyText = (
      await bubble
        .locator(".msg__body")
        .first()
        .innerText()
        .catch(async () => await bubble.innerText())
    ).trim();
    expect(
      countOccurrences(bodyText, "ANSWER="),
      `ANSWER= appeared ${countOccurrences(bodyText, "ANSWER=")}x in the answer body:\n${bodyText}`,
    ).toBe(1);
    expect(bodyText).toContain("4");

    // The English/analysis reasoning the model streams into the thought channel
    // must not also be present verbatim in the answer body. Assert the thought
    // block has real content and the answer body is short (a one-line answer),
    // which together rule out the merge-into-answer failure.
    const thoughtText = (await thought.innerText()).trim();
    expect(thoughtText.length, "thought block should contain the reasoning").toBeGreaterThan("深度思考".length);
    expect(
      bodyText.length,
      `answer body looks like it absorbed the reasoning (too long):\n${bodyText}`,
    ).toBeLessThan(200);
  });

  test("a follow-up turn appends a second bubble with its own answer", async ({ page }) => {
    await prepareRealModel(page);

    const first = `UIREAL-A-${Date.now()}`;
    await sendThroughComposer(page, `只回复这一个词：${first}`);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText(first, { timeout: 120_000 });
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0, { timeout: 60_000 });

    const second = `UIREAL-B-${Date.now()}`;
    await sendThroughComposer(page, `只回复这一个词：${second}`);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText(second, { timeout: 120_000 });
    await expect(page.locator(STOP_BUTTON)).toHaveCount(0, { timeout: 60_000 });

    await expect(page.locator(ASSISTANT_BUBBLE)).toHaveCount(2, { timeout: 30_000 });

    // Turn 1's bubble must still hold turn 1's answer. Both the frozen
    // transcript bug and the buffer-reuse bug surfaced as turn 2's text
    // appearing inside turn 1.
    const firstBubble = (await page.locator(ASSISTANT_BUBBLE).first().innerText()).trim();
    expect(countOccurrences(firstBubble, first)).toBe(1);
    expect(firstBubble).not.toContain(second);
  });

  test("stop button interrupts a long answer and returns the composer", async ({ page }) => {
    await prepareRealModel(page);

    await sendThroughComposer(page, "请用中文写一篇 600 字的散文，主题是秋天的清晨。");

    // Stop as soon as the control appears — the point is that an interrupt
    // mid-stream settles the UI rather than leaving it spinning.
    const stop = page.locator(STOP_BUTTON);
    await expect(stop).toHaveCount(1, { timeout: 60_000 });
    await stop.first().click();

    await expect(stop).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator(COMPOSER).first()).toBeEnabled({ timeout: 30_000 });

    // If an assistant bubble exists it must be settled, not stuck on the
    // placeholder. An abort landing before the first delta legitimately leaves
    // no bubble at all, so zero bubbles is an acceptable outcome — the property
    // under test is "no bubble left spinning forever", not "a bubble exists".
    const bubbles = page.locator(ASSISTANT_BUBBLE);
    if ((await bubbles.count()) > 0) {
      await expect(bubbles.last()).not.toContainText(PENDING_PLACEHOLDER, { timeout: 30_000 });
    }
  });

  test("agent:current-model reflects the real upstream after a UI-driven turn", async ({ page }) => {
    await prepareRealModel(page);

    const marker = `UIREAL-MODEL-${Date.now()}`;
    await sendThroughComposer(page, `只回复这一个词：${marker}`);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText(marker, { timeout: 120_000 });

    const current = await invoke<{ id?: string; provider?: string }>(page, "agent:current-model");
    expect(current?.id).toBe(MODEL_ID);
    expect(current?.provider).toBe(PROVIDER_ID);
  });
});
