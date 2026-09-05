/**
 * chat-ui-streaming.spec.ts — the transcript-rendering regression guard.
 *
 * ## Why this file exists
 *
 * Every other chat spec drives `api.invoke("agent:prompt")` and asserts the raw
 * `pi://update` payloads. None of them typed into the composer, and none of
 * them asserted that the transcript DOM actually rendered the streamed text. So
 * the renderer's chat pipeline — the coalescer, the store's streaming buffer,
 * ChatView's store subscription, MessageItem's memo — had zero end-to-end
 * coverage, and a family of bugs lived there happily:
 *
 *   - ChatView's `subscribeWithSelector` equality function compared only the
 *     last message's `id` and the array length. Streaming appends text to the
 *     *same* id, so it judged "unchanged" and the transcript froze at the
 *     placeholder while the backend streamed a complete, correct answer.
 *   - `onComplete` called `setStreaming(false)` before flushing the delta
 *     buffer, so the final render painted an empty bubble.
 *   - The delta flush used a bare `requestAnimationFrame`, which Electron stops
 *     delivering to an occluded window — the whole turn stayed in the buffer.
 *   - Two separate main-process bridges emitted every delta in two shapes, so
 *     text rendered doubled and interleaved ("DIDIAG-OKAG-OK").
 *   - One prompt produced four `pi://complete` events, running every
 *     once-per-turn side effect (usage accounting, notifications, message-queue
 *     release) four times.
 *
 * All of those were found by hand with an ad-hoc probe script. This spec is the
 * permanent version, and it uses the local echo upstream so it runs on every
 * `playwright test` with no credentials and no network.
 *
 * ## Assertion style
 *
 * Streaming text is asserted by EXACT OCCURRENCE COUNT, never `includes()`.
 * That distinction caught a real bug: the corrupted double-append
 * `DIDIAG-OKAG-OK` *contains* the substring `DIAG-OK`, so a `toContain`
 * assertion passed while the rendered transcript was visibly broken.
 */
import { expect, test } from "./_fixtures";
import {
  bootstrapEcho,
  collectText,
  installCapture,
  invoke,
  invokeOrReject,
  startEchoServer,
  stopEchoServer,
  type CaptureReader,
  type EchoServer,
} from "./_echo-harness";

/**
 * Long enough that the echo upstream splits it across several `text_delta`
 * events (it chunks its reply into 12-character pieces), so the test exercises
 * real multi-delta accumulation rather than a single-shot emit.
 */
const MARKER = "UISTREAM-PARITY-CHECK-ALPHA-BRAVO";
const PROMPT = `只回复 ${MARKER}`;
/** What the echo upstream replies with — see `anthropic-echo-provider.mjs`. */
const EXPECTED_REPLY = `ECHO ${MARKER}`;

const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT_BUBBLE = ".msg--assistant";

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Configure the echo upstream, then reload so the renderer boots with the
 * provider already available and the composer enabled.
 *
 * The reload matters: `apiReady` (and therefore the composer's `disabled`
 * attribute) is resolved during app boot from `agent:auth-status`, so a
 * provider registered into a live renderer does not enable the composer until
 * the next load.
 */
async function prepareRenderer(
  page: import("@playwright/test").Page,
  echoBaseUrl: string,
): Promise<CaptureReader> {
  await bootstrapEcho(page, echoBaseUrl);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  // Capture lives on `window`, so it must be installed AFTER the reload.
  const readCapture = await installCapture(page);
  await expect(page.locator(COMPOSER).first()).toBeEnabled({ timeout: 30_000 });
  return readCapture;
}

/** Type into the composer and press 发送, the way a user does. */
async function sendThroughComposer(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.locator(COMPOSER).first().fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

/**
 * Playwright's default per-test timeout is 30s. Each test here boots Electron,
 * registers a provider, reloads the renderer, and then drives one or two full
 * streaming turns — comfortable at `--workers=2`, but under the default
 * `fullyParallel` fan-out (7 workers on a 14-core box) the same work contends
 * for CPU and the multi-turn cases crossed 30s. Raising the budget for this file
 * keeps them deterministic instead of load-dependent; the per-expect timeouts
 * below still bound each individual wait.
 */
test.describe.configure({ timeout: 150_000 });

test.describe("chat transcript renders streamed text (echo upstream)", () => {
  let echo: EchoServer | null = null;

  test.beforeAll(async () => {
    echo = await startEchoServer("chat-ui-streaming");
  });

  test.afterAll(async () => {
    await stopEchoServer(echo);
    echo = null;
  });

  test("a composer-driven turn renders the assistant reply exactly once", async ({ page }) => {
    const readCapture = await prepareRenderer(page, echo!.baseUrl);
    await sendThroughComposer(page, PROMPT);

    // The assistant bubble must actually show the text. This is the assertion
    // the whole file exists for: the backend streaming correctly is not enough.
    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText(MARKER, { timeout: 60_000 });

    const rendered = (await bubble.innerText()).trim();

    // Exactly once — a double-append would still satisfy `toContainText`.
    expect(
      countOccurrences(rendered, MARKER),
      `marker rendered ${countOccurrences(rendered, MARKER)}x, expected 1. Transcript was:\n${rendered}`,
    ).toBe(1);

    // The reply must appear verbatim, not interleaved. The historical
    // corruption spliced two copies together ("DIDIAG-OKAG-OK"), which keeps
    // the marker present but destroys the surrounding text.
    expect(rendered).toContain(EXPECTED_REPLY);

    // And the renderer must not have dropped any delta: what the DOM shows has
    // to match what came over the wire.
    const capture = await readCapture();
    const wireText = collectText(capture.updates);
    expect(wireText).toContain(EXPECTED_REPLY);
    expect(capture.errors, `pi://error during turn: ${JSON.stringify(capture.errors)}`).toHaveLength(0);
  });

  test("one composer turn produces exactly one pi://complete", async ({ page }) => {
    const readCapture = await prepareRenderer(page, echo!.baseUrl);
    await sendThroughComposer(page, PROMPT);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText(MARKER, { timeout: 60_000 });

    // `pi://complete` can arrive just after the text paints; give it a beat
    // rather than racing it.
    await expect
      .poll(async () => (await readCapture()).completes.length, { timeout: 15_000, intervals: [250] })
      .toBeGreaterThan(0);
    // Then confirm it settles at exactly one and does not keep climbing.
    await page.waitForTimeout(1_500);

    const { completes } = await readCapture();
    expect(
      completes.length,
      `expected 1 pi://complete for one turn, got ${completes.length}: ${JSON.stringify(completes)}`,
    ).toBe(1);
  });

  test("the streaming placeholder is replaced, not left behind", async ({ page }) => {
    await prepareRenderer(page, echo!.baseUrl);
    await sendThroughComposer(page, PROMPT);

    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText(MARKER, { timeout: 60_000 });

    // "等待中" is the LoadingRow placeholder. The original stall bug left it on
    // screen forever while the answer never appeared, so its absence after the
    // turn is the direct regression signal.
    await expect(bubble).not.toContainText("等待中", { timeout: 15_000 });
    // Stop button must be gone once the turn settled.
    await expect(page.locator('[aria-label="停止生成"]')).toHaveCount(0, { timeout: 15_000 });
  });

  test("a second turn appends a new bubble instead of mutating the first", async ({ page }) => {
    await prepareRenderer(page, echo!.baseUrl);

    await sendThroughComposer(page, PROMPT);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText(MARKER, { timeout: 60_000 });

    const secondMarker = "UISTREAM-SECOND-TURN-CHARLIE";
    await sendThroughComposer(page, `只回复 ${secondMarker}`);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText(secondMarker, { timeout: 60_000 });

    await expect(page.locator(ASSISTANT_BUBBLE)).toHaveCount(2, { timeout: 15_000 });

    // The first bubble must still hold its own answer — the frozen-transcript
    // bug and the buffer-reuse bug both showed up as turn 2's text landing in
    // turn 1's bubble.
    const first = (await page.locator(ASSISTANT_BUBBLE).first().innerText()).trim();
    expect(countOccurrences(first, MARKER)).toBe(1);
    expect(first).not.toContain(secondMarker);
  });

  /**
   * Guards the delta-flush fallback. Electron throttles animation frames for a
   * hidden window and stops them entirely for an occluded one, while
   * `requestAnimationFrame` still *exists* — so a capability check cannot see
   * the difference. With a bare rAF flush, a turn that streamed while the
   * window was not compositing kept its entire response in the pending buffer
   * and rendered nothing. The 32ms timeout racing the frame is what fixes it.
   */
  test("text still renders when the window is hidden during the turn", async ({ page, electronApp }) => {
    await prepareRenderer(page, echo!.baseUrl);

    await sendThroughComposer(page, PROMPT);
    // Hide immediately so the stream arrives while frames are not being served.
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.hide();
    });
    await page.waitForTimeout(2_000);
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.show();
    });

    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText(MARKER, { timeout: 60_000 });
    expect(countOccurrences((await bubble.innerText()).trim(), MARKER)).toBe(1);
  });

  test("abort mid-turn settles the UI instead of leaving it spinning", async ({ page }) => {
    await prepareRenderer(page, echo!.baseUrl);
    await sendThroughComposer(page, PROMPT);

    // Abort is idempotent and safe even if the turn already finished; the point
    // is that the composer must return to a usable state either way.
    await invokeOrReject(page, "agent:abort", {});

    await expect(page.locator('[aria-label="停止生成"]')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(COMPOSER).first()).toBeEnabled({ timeout: 30_000 });
  });
});

test.describe("transcript survives a reload (history replay path)", () => {
  let echo: EchoServer | null = null;

  test.beforeAll(async () => {
    echo = await startEchoServer("chat-ui-streaming-replay");
  });

  test.afterAll(async () => {
    await stopEchoServer(echo);
    echo = null;
  });

  /**
   * Replay emits whole assistant messages as legacy `{ type: "text" }` parts
   * (`host-modules/session-store.ts`), a different shape from live streaming's
   * `text_delta`. `acceptTextShape()` in the renderer locks onto one shape per
   * turn, so this exercises the branch live streaming does not.
   */
  test("a completed turn re-renders once after reload", async ({ page }) => {
    await bootstrapEcho(page, echo!.baseUrl);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
    await expect(page.locator(COMPOSER).first()).toBeEnabled({ timeout: 30_000 });

    await sendThroughComposer(page, PROMPT);
    await expect(page.locator(ASSISTANT_BUBBLE).last()).toContainText(MARKER, { timeout: 60_000 });

    // Let the turn settle and persist before reloading.
    await expect(page.locator('[aria-label="停止生成"]')).toHaveCount(0, { timeout: 30_000 });

    const activeSession = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem("openbuddy.active-session") ?? "null") as unknown;
      } catch {
        return null;
      }
    });
    expect(activeSession, "renderer did not persist an active session id").toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

    const bubble = page.locator(ASSISTANT_BUBBLE).last();
    await expect(bubble).toContainText(MARKER, { timeout: 60_000 });
    const rendered = (await bubble.innerText()).trim();
    expect(
      countOccurrences(rendered, MARKER),
      `replayed transcript rendered the marker ${countOccurrences(rendered, MARKER)}x:\n${rendered}`,
    ).toBe(1);
  });
});
