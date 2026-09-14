/**
 * chat-ui-minimax-plan-mode.spec.ts — coverage for the Pi plan-mode
 * extension wired through `pi-plan-mode.ts` (plan4.4 §B).
 *
 * ## What this exercises
 *
 * Three pieces of the plan-mode surface that the renderer touches:
 *
 *   1. The IPC contract: `plan-mode:get` / `plan-mode:set-enabled` /
 *      `plan-mode:set-plan` / `plan-mode:approve` / `plan-mode:reject`
 *      all return *something* (null stub today) without throwing
 *      "no handler registered". The current Electron IPC dispatch
 *      (`electron/main/ipc/misc.ts:234-238`) registers them as legacy
 *      / 3rd-party placeholder channels so the preload allow-list stays
 *      in sync.
 *   2. The slash-command surface: `/plan` appears in
 *      `agent:commands-list` once a session is created, because the
 *      Pi plan-mode extension registers it through
 *      `createPiPlanModeExtension()`'s `pi.registerCommand("plan", …)`.
 *   3. The plan-mode IPC round-trip: setting an enabled flag and
 *      reading it back through the same channel must not throw or
 *      surface "no handler registered" — a regression guard against
 *      someone stripping the IPC registrations during refactor.
 *
 * ## Why a real-LLM-gated spec
 *
 * The full `/plan` flow (plan → review → approve → re-prompt) requires
 * a real LLM to generate a Markdown plan that the user can approve.
 * Without `OPENBUDDY_E2E_API_KEY` + `OPENBUDDY_E2E_BASE_URL` this
 * spec skips, the same way the other chat-ui-minimax-*.spec.ts files
 * do.
 *
 * ## Skipping
 *
 * Default skip when `OPENBUDDY_E2E_API_KEY` / `OPENBUDDY_E2E_BASE_URL`
 * are missing. Opt in by exporting both before running
 * `pnpm exec playwright test tests/electron/chat-ui-minimax-plan-mode.spec.ts`.
 */
import { expect, test } from "./_fixtures";
import { mkdtempSync, mkdirSync } from "node:fs";
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
console.log(`[chat-ui-minimax-plan-mode] ${describeSource(creds)}`);

async function configure(page: import("@playwright/test").Page, cwd: string): Promise<void> {
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
}

test.describe("chat-ui-minimax-plan-mode (plan4.4 §B)", () => {
  test.skip(!HAS_CREDS, "OPENBUDDY_E2E_API_KEY + OPENBUDDY_E2E_BASE_URL required");

  test("/plan slash command is registered in agent:commands-list", async ({ page }) => {
    const userData = mkdtempSync(join(tmpdir(), "openbuddy-plan-mode-spec-"));
    const workspace = join(userData, "ws");
    mkdirSync(workspace, { recursive: true });

    await configure(page, workspace);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached" });
    await page.locator(COMPOSER).first().waitFor({ state: "visible" });

    const commands = await page.evaluate(
      async ({ channel, args }) => window.api.invoke(channel, args),
      { channel: "agent:commands-list", args: undefined },
    );

    expect(Array.isArray(commands)).toBe(true);
    const planCommand = (commands as Array<{ name: string }>).find((command) => command.name === "plan");
    expect(planCommand, "expected /plan command to be registered by the pi-plan-mode extension").toBeDefined();
  });

  test("plan-mode:get IPC handler is wired (no 'no handler registered' error)", async ({ page }) => {
    const userData = mkdtempSync(join(tmpdir(), "openbuddy-plan-mode-spec-"));
    const workspace = join(userData, "ws");
    mkdirSync(workspace, { recursive: true });

    await configure(page, workspace);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached" });

    // The channel returns a stub today; the assertion we care about is
    // "the call resolves instead of throwing no handler registered".
    const result = await page.evaluate(
      async ({ channel, args }) => {
        try {
          return { ok: true, value: await window.api.invoke(channel, args) };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      },
      { channel: "plan-mode:get", args: { sessionId: "fake-session" } },
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  test("plan-mode:set-enabled + plan-mode:get round-trip does not throw", async ({ page }) => {
    const userData = mkdtempSync(join(tmpdir(), "openbuddy-plan-mode-spec-"));
    const workspace = join(userData, "ws");
    mkdirSync(workspace, { recursive: true });

    await configure(page, workspace);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached" });

    const setResult = await page.evaluate(
      async ({ channel, args }) => {
        try {
          await window.api.invoke(channel, args);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      },
      { channel: "plan-mode:set-enabled", args: { sessionId: "fake-session", enabled: true } },
    );
    expect(setResult.ok, JSON.stringify(setResult)).toBe(true);

    const getResult = await page.evaluate(
      async ({ channel, args }) => {
        try {
          return { ok: true, value: await window.api.invoke(channel, args) };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      },
      { channel: "plan-mode:get", args: { sessionId: "fake-session" } },
    );
    expect(getResult.ok, JSON.stringify(getResult)).toBe(true);
  });

  test("plan-mode:set-plan + plan-mode:approve + plan-mode:reject channels are wired", async ({ page }) => {
    const userData = mkdtempSync(join(tmpdir(), "openbuddy-plan-mode-spec-"));
    const workspace = join(userData, "ws");
    mkdirSync(workspace, { recursive: true });

    await configure(page, workspace);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached" });

    const channels = [
      { channel: "plan-mode:set-plan", args: { sessionId: "fake-session", plan: "1. inspect 2. edit" } },
      { channel: "plan-mode:approve", args: { sessionId: "fake-session" } },
      { channel: "plan-mode:reject", args: { sessionId: "fake-session" } },
    ];
    for (const call of channels) {
      const result = await page.evaluate(
        async ({ channel, args }) => {
          try {
            await window.api.invoke(channel, args);
            return { ok: true };
          } catch (error) {
            return { ok: false, error: String(error) };
          }
        },
        call,
      );
      expect(result.ok, `${call.channel} -> ${JSON.stringify(result)}`).toBe(true);
    }
  });
});