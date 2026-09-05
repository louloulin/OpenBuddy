/**
 * composer-pin.spec.ts — guards the chat composer against scrolling out of
 * view when the transcript grows tall.
 *
 * ## Why this test exists
 *
 * The composer's fixed-bottom pinning is load-bearing for the chat UX. The user
 * expectation is "I always type at the bottom of the viewport, regardless of
 * transcript length" — the same as every modern chat client. An earlier
 * investigation suspected the composer's container might be inside the
 * transcript's scroll region; this test pins the actual behavior so any
 * future layout regression (a stray `</div>`, an extra `flex:1`, an
 * accidental position:absolute) lights up immediately.
 *
 * The assertion is structural, not pixel-based: it checks that the composer's
 * containing element is NOT a descendant of the scroll container, AND that the
 * composer and the transcript top sit at different y-coordinates from the
 * viewport bottom when the transcript is tall enough to force internal
 * scrolling.
 *
 * Skips without MiniMax credentials because forcing a tall transcript requires
 * running multiple prompts end-to-end.
 */
import { expect, test } from "./_fixtures";
import { invokeOrReject } from "./_echo-harness";

const COMPOSER = "textarea.wb-composer__input";
const STOP_BUTTON = '[aria-label="停止生成"]';
const ASSISTANT_BUBBLE = ".msg--assistant";

const HAS_CREDS = Boolean(
  (process.env.OPENBUDDY_E2E_API_KEY ?? "").trim() &&
    (process.env.OPENBUDDY_E2E_BASE_URL ?? "").trim(),
);

// Long enough to overflow any reasonable chat column on a 1280×800 viewport.
const LONG_MARKERS = ["PIN-AAA", "PIN-BBB", "PIN-CCC"] as const;

// 600px viewport + 3 follow-up turns + height-stability check pushes past the
// 30s default test budget. The CLI's --timeout flag is for the inner expect/
// waitForFunction wait; the outer per-test budget is set here.
test.describe.configure({ timeout: 240_000 });

test.describe("chat composer stays pinned to the bottom", () => {
  test.skip(!HAS_CREDS, "no real-model credentials — set OPENBUDDY_E2E_* to enable");

  test("the composer never becomes a descendant of the transcript scroll", async ({ page }) => {
    // Wait for the renderer to boot (fixture already launched Electron with a
    // real provider config). Do NOT `page.goto("about:blank")` — the Electron
    // window IS the page; navigating kills the app.
    await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });

    // Walk up the DOM from the composer and confirm we never hit the scroll
    // container. If the composer is nested inside `.chatview__scroll`, an
    // ancestor in this list will match, and the test fails.
    const composerIsInsideScroll = await page.evaluate((composerSelector) => {
      const composer = document.querySelector(composerSelector);
      if (!composer) return false;
      for (let n = composer.parentElement; n; n = n.parentElement) {
        if (n.classList.contains("chatview__scroll")) return true;
      }
      return false;
    }, COMPOSER);

    expect(
      composerIsInsideScroll,
      "composer is nested inside .chatview__scroll — a tall transcript will push it out of view",
    ).toBe(false);
  });

  test("a tall transcript keeps the composer visible at the viewport bottom", async ({ page }) => {
    // Without provider config, the composer stays disabled — register MiniMax
    // before driving turns, mirroring chat-ui-minimax-real.spec.ts.
    const cwd = "/tmp/openbuddy-composer-pin";
    await invokeOrReject(page, "agent:providers-save-provider", {
      provider: {
        id: "custom_anthropic",
        label: "MiniMax",
        providerKind: "custom_anthropic",
        apiKey: process.env.OPENBUDDY_E2E_API_KEY,
        baseUrl: process.env.OPENBUDDY_E2E_BASE_URL,
        apiBackend: "messages",
        authScheme: "x_api_key",
      },
    });
    await invokeOrReject(page, "agent:providers-save-model", {
      model: {
        providerId: "custom_anthropic",
        modelId: process.env.OPENBUDDY_E2E_MODEL_ID?.trim() ?? "MiniMax-M3",
        name: "MiniMax-M3",
        contextWindow: 128000,
      },
    });
    await invokeOrReject(page, "agent:new-session", {
      cwd,
      modelId: `custom_anthropic/${process.env.OPENBUDDY_E2E_MODEL_ID?.trim() ?? "MiniMax-M3"}`,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
    await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
    await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });
    // Small viewport so the transcript overflows in fewer turns.
    await page.setViewportSize({ width: 1280, height: 600 });

    // Drive enough turns to overflow the transcript area. Each one appends a
    // new assistant bubble plus a user bubble, so 3 turns is plenty for the
    // chat column to require scrolling.
    for (const marker of LONG_MARKERS) {
      const bubbleBefore = await page.locator(ASSISTANT_BUBBLE).count();
      await page.locator(COMPOSER).first().fill(`输出 ${marker}，并围绕它写一段约 50 字的解释。`);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.waitForFunction(
        ({ count, needle }) => {
          const nodes = [...document.querySelectorAll(".msg--assistant")];
          if (nodes.length <= count) return false;
          return (nodes[nodes.length - 1].innerText ?? "").includes(needle);
        },
        { count: bubbleBefore, needle: marker },
        { timeout: 120_000 },
      );
      await page
        .waitForFunction(() => !document.querySelector('[aria-label="停止生成"]'), undefined, {
          timeout: 60_000,
        })
        .catch(() => {});
    }

    // The transcript should now require internal scrolling.
    const scrollMetrics = await page.evaluate(() => {
      const scroller = document.querySelector(".chatview__scroll");
      if (!(scroller instanceof HTMLElement)) return null;
      return {
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        canScroll: scroller.scrollHeight > scroller.clientHeight + 20,
      };
    });
    expect(scrollMetrics, "transcript scroll container is missing").not.toBeNull();
    expect(
      scrollMetrics!.canScroll,
      `transcript does not overflow after 3 turns (scrollHeight=${scrollMetrics!.scrollHeight}, clientHeight=${scrollMetrics!.clientHeight})`,
    ).toBe(true);

    // Now the real assertion: even with a scrollable transcript, the composer
    // must sit within the bottom of the viewport. We measure the composer's
    // bounding rect against the scroll container — the composer's bottom
    // should be at or below the scroller's bottom (it lives in a footer that
    // is a sibling of the scroll region), AND it must be visible inside the
    // viewport (bottom within viewport bounds, not above the scroller).
    const layout = await page.evaluate((composerSelector) => {
      const composer = document.querySelector(composerSelector);
      const scroller = document.querySelector(".chatview__scroll");
      const footer = document.querySelector(".chatview__footer");
      const main = document.querySelector(".chatview__main");
      if (!(composer instanceof HTMLElement)) return { composer: null };
      const cr = composer.getBoundingClientRect();
      const sr = scroller instanceof HTMLElement ? scroller.getBoundingClientRect() : null;
      const fr = footer instanceof HTMLElement ? footer.getBoundingClientRect() : null;
      const mr = main instanceof HTMLElement ? main.getBoundingClientRect() : null;
      const isInFooter =
        footer instanceof HTMLElement ? (composer.closest(".chatview__footer") !== null) : null;
      return {
        composer: { top: cr.top, bottom: cr.bottom, left: cr.left, right: cr.right, height: cr.height },
        scroller: sr ? { top: sr.top, bottom: sr.bottom } : null,
        footer: fr ? { top: fr.top, bottom: fr.bottom } : null,
        main: mr ? { top: mr.top, bottom: mr.bottom } : null,
        isInFooter,
      };
    }, COMPOSER);

    expect(layout.composer, "composer not found in DOM").not.toBeNull();
    // The composer must live inside the footer (a sibling of the scroll region),
    // not inside the scroll container.
    expect(layout.isInFooter, "composer is not contained inside .chatview__footer").toBe(true);
    // The composer's bottom must be at or below the scroller's bottom — i.e.
    // it sits BELOW the scrollable region, not inside it. If this fails the
    // composer lives in the scrollable column and scrolls away.
    expect(
      layout.composer!.bottom,
      `composer.bottom (${layout.composer!.bottom}) should be >= scroller.bottom (${layout.scroller!.bottom}); the composer must sit below the transcript scroll area`,
    ).toBeGreaterThanOrEqual(layout.scroller!.bottom);
    // And the composer must be inside the viewport — visible to the user.
    expect(
      layout.composer!.bottom,
      `composer.bottom (${layout.composer!.bottom}) is below the viewport bottom`,
    ).toBeLessThanOrEqual(layout.main!.bottom + 1);

    // Real symptom: a long transcript used to shrink the composer because
    // `chatview__footer` had no `flex-shrink: 0` — `flex: 1` on the scroll
    // container wasn't enough when nothing told the footer to stay at its
    // intrinsic height. Lock the composer's pixel height so any future
    // regression that lets the transcript squeeze the composer lights up.
    const initialHeight = layout.composer!.height;
    // Add several turns of substantial content to force real layout pressure,
    // not just one bubble that could be absorbed without overflow.
    for (let i = 0; i < 3; i += 1) {
      const bubbleBeforeX = await page.locator(ASSISTANT_BUBBLE).count();
      await page
        .locator(COMPOSER)
        .first()
        .fill(`补充一段关于 OpenBuddy 与 pi-web 差异的对比说明，编号为 ${i}。`);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.waitForFunction(
        ({ count }) => document.querySelectorAll(".msg--assistant").length > count,
        { count: bubbleBeforeX },
        { timeout: 60_000 },
      );
      await page.waitForFunction(() => !document.querySelector(STOP_BUTTON), undefined, {
        timeout: 30_000,
      }).catch(() => {});
    }
    const finalHeight = await page.evaluate((sel) => {
      const n = document.querySelector(sel);
      return n instanceof HTMLElement ? n.getBoundingClientRect().height : 0;
    }, COMPOSER);
    expect(
      Math.abs(finalHeight - initialHeight),
      `composer height shifted from ${initialHeight} to ${finalHeight} after adding a turn — the footer is being squeezed by the transcript (missing flex-shrink:0)`,
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("chat composer stays pinned to the bottom (echo path, no credentials needed)", () => {
  // 5 echo turns can take 100s+ under load. Default 30s is too short.
  test.describe.configure({ timeout: 240_000 });

  let echo: { proc: import("node:child_process").ChildProcess; baseUrl: string } | null = null;

  test.beforeAll(async () => {
    const { startEchoServer } = await import("./_echo-harness");
    echo = await startEchoServer("composer-pin");
  });

  test.afterAll(async () => {
    const { stopEchoServer } = await import("./_echo-harness");
    await stopEchoServer(echo);
    echo = null;
  });

  test("echo-driven tall transcript keeps the composer at the viewport bottom", async ({ page }) => {
    const { bootstrapEcho } = await import("./_echo-harness");
    await bootstrapEcho(page, echo!.baseUrl);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
    await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });
    await page.setViewportSize({ width: 1280, height: 600 });

    // 5 echo-driven turns. The echo reply is `ECHO <MARKER>`,` which is short,
    // but each turn appends a real user bubble + the echo's markdown rendered
    // back, so 5 turns is enough to overflow the column.
    for (let i = 0; i < 5; i += 1) {
      const before = await page.locator(ASSISTANT_BUBBLE).count();
      const marker = `ECHO-PIN-${i}-${Date.now()}`;
      await page.locator(COMPOSER).first().fill(`只回复 ${marker}`);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.waitForFunction(
        ({ count, needle }) => {
          const nodes = [...document.querySelectorAll(".msg--assistant")];
          if (nodes.length <= count) return false;
          return (nodes[nodes.length - 1].innerText ?? "").includes(needle);
        },
        { count: before, needle: marker },
        { timeout: 120_000 },
      );
      await page.waitForFunction(() => !document.querySelector(STOP_BUTTON), undefined, {
        timeout: 60_000,
      }).catch(() => {});
    }

    // The transcript overflows.
    const scrollMetrics = await page.evaluate(() => {
      const scroller = document.querySelector(".chatview__scroll");
      if (!(scroller instanceof HTMLElement)) return null;
      return {
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        canScroll: scroller.scrollHeight > scroller.clientHeight + 20,
      };
    });
    expect(scrollMetrics).not.toBeNull();
    expect(
      scrollMetrics!.canScroll,
      `transcript should overflow but doesn't (scrollHeight=${scrollMetrics!.scrollHeight}, clientHeight=${scrollMetrics!.clientHeight})`,
    ).toBe(true);

    // The composer stays pinned BELOW the scroll region.
    const layout = await page.evaluate((composerSelector) => {
      const composer = document.querySelector(composerSelector);
      const scroller = document.querySelector(".chatview__scroll");
      if (!(composer instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
        return { composer: null };
      }
      const cr = composer.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      return { composer: { top: cr.top, bottom: cr.bottom }, scroller: { bottom: sr.bottom } };
    }, COMPOSER);
    expect(layout.composer).not.toBeNull();
    expect(
      layout.composer!.bottom,
      `composer (${layout.composer!.bottom}) must sit at or below the transcript scroll area (${layout.scroller!.bottom})`,
    ).toBeGreaterThanOrEqual(layout.scroller!.bottom);
  });
});