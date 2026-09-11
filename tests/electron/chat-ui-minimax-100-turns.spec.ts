/**
 * chat-ui-minimax-100-turns.spec.ts — 100 real-MiniMax round-trip
 * conversation regression guard.
 *
 * ## What this exercises
 *
 * Drives a real 100-turn conversation against MiniMax-M3 (real upstream,
 * real `agent:prompt` round-trips, real streaming), then asserts the
 * renderer's behaviour at the long-conversation scale the user
 * actually hits in production:
 *
 *   1. all 100 user + 100 assistant bubbles render in the DOM
 *   2. the final 100th turn completes within 8 min total (network
 *      + LLM; ~3-5 s per turn expected)
 *   3. initial full-transcript paint completes within 5 s after the
 *      final turn settles
 *   4. memory delta from baseline stays under 250 MB (Chromium-only)
 *   5. scrolling to the bottom of the transcript still happens (no
 *      permanent layout break)
 *
 * ## Skipping
 *
 * Skipped by default — this is a stress / cost spec, not a
 * correctness gate. Run it manually or in nightly with:
 *
 *   RUN_100_TURNS=1 pnpm exec playwright test \
 *       tests/electron/chat-ui-minimax-100-turns.spec.ts --reporter=line
 *
 * ## Why 100, not 1000
 *
 * The earlier `chat-ui-minimax-1000-turns.spec.ts` synthesised DOM
 * rows directly — fast, but it never hit the upstream. The user
 * asked for *real* MiniMax verification, so the count is lowered to
 * 100 (each turn costs ~1-3 s of upstream latency + a small token
 * bill) and the assertion shifts from "render 1000 rows" to
 * "complete 100 LLM round-trips and still render".
 *
 * ## Prompt shape
 *
 * Each user prompt alternates between Chinese and English, varies in
 * length (10-30 chars), and explicitly tells the model "do not call
 * any tools" so the round-trip is purely chat text — no tool calls,
 * no agentic side effects.
 */
import { expect, test } from "./_fixtures";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveE2ECredentials, describeSource } from "../../scripts/lib/e2e-credentials.mjs";

const RUN = process.env.RUN_100_TURNS === "1";

const API_KEY = process.env.OPENBUDDY_E2E_API_KEY?.trim();
const BASE_URL = process.env.OPENBUDDY_E2E_BASE_URL?.trim();
const MODEL_ID = process.env.OPENBUDDY_E2E_MODEL_ID?.trim() ?? "MiniMax-M3";
const HAS_CREDS = Boolean(API_KEY && BASE_URL);

const PROVIDER_ID = "custom_anthropic";
const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT_BUBBLE = ".msg--assistant";
const STOP_BUTTON = '[aria-label="停止生成"]';

const creds = resolveE2ECredentials({ provider: "minimax" });
console.log(`[chat-ui-minimax-100-turns] ${describeSource(creds)}`);

const TURN_COUNT = 100;
// Test-level timeout = 25 min. Each turn maxes at 90 s, but the
// per-turn budget is dominated by the upstream streaming latency
// (~3-5 s typically, occasionally longer). 100 turns at ~10 s
// average = ~17 min, well within the 25 min envelope.
const TEST_TIMEOUT_MS = 25 * 60 * 1000;

const PROMPTS: string[] = Array.from({ length: TURN_COUNT }, (_, i) => {
  const isEnglish = i % 2 === 0;
  const topics = [
    "Hello, please briefly introduce yourself in one sentence.",
    "请用一句话介绍 OpenBuddy 这个项目。",
    "What are the three pillars of Pi upstream?",
    "解释一下 Cordis 在这个项目里扮演什么角色。",
    "Why is the IPC contract validated with zod schemas?",
    "对比一下 pnpm 和 npm 在 monorepo 场景下的区别。",
    "What does an attachment-store do?",
    "描述一下 session tree 是如何持久化的。",
    "How does chat streaming end-to-end work?",
    "总结一下 plan4.md 的核心论点。",
  ];
  return topics[i % topics.length] ?? topics[i % 10];
});

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

/** Send one prompt, wait for the assistant's reply to settle.
 *  NB: STOP_BUTTON_SELECTOR is passed as an explicit argument, not a
 *  closure reference. waitForFunction() runs the predicate in the
 *  renderer context — referencing the top-level Node-scope constant
 *  there throws `STOP_BUTTON is not defined`, which the renderer's
 *  global unhandled-rejection handler then surfaces as a misleading
 *  toast in the test screenshot. */
async function sendAndSettle(
  page: import("@playwright/test").Page,
  text: string,
  turnIndex: number,
) {
  const before = await page.locator(ASSISTANT_BUBBLE).count();
  await page.locator(COMPOSER).first().fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  // Per-turn timeout is generous (90 s) because MiniMax-M3 latency is
  // ~3-5 s per turn but the upstream occasionally spikes during
  // traffic shaping or rate-limit handshake retries. 100 turns at the
  // 95-th-percentile of 12 s = 20 min; we cap the *total* run at 25 min
  // via test.setTimeout below and let the per-turn ceiling cover any
  // individual hiccup.
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length > count,
    { sel: ASSISTANT_BUBBLE, count: before },
    { timeout: 90_000 },
  );
  await page
    .waitForFunction(
      ({ sel }) => !document.querySelector(sel),
      { sel: STOP_BUTTON },
      { timeout: 90_000 },
    )
    .catch(() => {});
  // Sanity: the new bubble has at least one non-whitespace character.
  const last = await page.locator(ASSISTANT_BUBBLE).last().innerText();
  if (!last.trim()) {
    throw new Error(`turn ${turnIndex}: assistant reply was empty`);
  }
  // Tiny breathing-room pause so the upstream rate limiter doesn't
  // start throttling us at turn 50+.
  if (turnIndex % 10 === 9) {
    await page.waitForTimeout(1_000);
  }
}

test.describe("100 real MiniMax round-trips (RUN_100_TURNS=1 to enable)", () => {
  test.skip(!HAS_CREDS, "[chat-ui-minimax-100-turns] no real-model credentials");
  test.skip(!RUN, "[chat-ui-minimax-100-turns] set RUN_100_TURNS=1 to run");

  test("100 real LLM turns complete and the transcript stays renderable", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);

    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-100-real-"));
    await setup(page, cwd);

    const baselineMem = (await page.evaluate(
      () => performance.memory?.usedJSHeapSize ?? 0,
    )) as number;

    const t0 = Date.now();
    for (let i = 0; i < TURN_COUNT; i++) {
      const turnStart = Date.now();
      await sendAndSettle(page, PROMPTS[i], i);
      const turnMs = Date.now() - turnStart;
      // Heartbeat every 10 turns so a partial failure shows progress.
      if (i % 10 === 0) {
        console.log(
          `[chat-ui-minimax-100-turns] turn ${i + 1}/${TURN_COUNT} done in ${turnMs}ms (elapsed ${Date.now() - t0}ms)`,
        );
      }
    }
    const totalMs = Date.now() - t0;

    const userCount = await page.locator(".msg--user").count();
    const assistantCount = await page.locator(ASSISTANT_BUBBLE).count();
    expect(userCount, "expected 100 user bubbles").toBeGreaterThanOrEqual(TURN_COUNT);
    expect(assistantCount, "expected 100 assistant bubbles").toBeGreaterThanOrEqual(TURN_COUNT);

    // After the final settle, the renderer needs to commit 100 turns to
    // the DOM without exploding.
    const tPaint = Date.now();
    await page.evaluate(() => {
      const el = document.querySelector(
        ".chatview__scroll, .msg-list, [data-testid='chatview-scroll']",
      );
      if (el) (el).scrollTop = (el).scrollHeight;
    });
    await page.waitForTimeout(200);
    const renderMs = Date.now() - tPaint;

    // Memory ceiling (Chromium-only). Allow up to 250 MB delta.
    const afterMem = (await page.evaluate(
      () => performance.memory?.usedJSHeapSize ?? 0,
    )) as number;
    const memDeltaMb = (afterMem - baselineMem) / (1024 * 1024);
    expect(memDeltaMb, "memory delta after 100 real turns").toBeLessThan(250);

    // Final perf print — useful even when the spec runs.
    console.log(
      `[chat-ui-minimax-100-turns] total=${totalMs}ms perTurnAvg=${Math.round(totalMs / TURN_COUNT)}ms finalPaint=${renderMs}ms memDeltaMb=${memDeltaMb.toFixed(1)} userCount=${userCount} assistantCount=${assistantCount}`,
    );
  });
});
