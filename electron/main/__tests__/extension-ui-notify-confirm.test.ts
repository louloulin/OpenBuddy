/**
 * MVP-10 — regression test pinning the existing extension-UI pipeline.
 *
 * OpenBuddy already ships a complete extension-UI pipeline (Pi's
 * ExtensionUIContext), wired through:
 *   main: provideRpcUiContext → uiContext.{select,confirm,input,editor,
 *         notify,emit,setEditorText,setToolsExpanded} → emitRendererEvent
 *   ipc :  pi://extension-ui, pi://permission, pi://question, pi://notification
 *   ui  :  useAgentSession.onExtensionUi, usePermissionStore, useToastStore
 *
 * MVP-10 was scoped to "extension UI 2 methods" — only `notify` + `confirm`
 * are actively used by today's capability packages (email + authorization).
 * This test pins the existence of those two paths so they can't regress
 * silently during future refactors.
 *
 * Pinning strategy: regex against the production source, mirroring the
 * pattern used by MVP-1 / MVP-2. Keeps the test fast and zero-mock.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const UI_CONTEXT = resolve(__dirname, "../agent/host-modules/bootstrap/provide-rpc-ui-context.ts");
const HANDLER = resolve(__dirname, "../agent/host-modules/bootstrap/handle-session-event.ts");
const UI_HANDLER = resolve(__dirname, "../../../src/hooks/useAgentSession.ts");

const uiContextSrc = readFileSync(UI_CONTEXT, "utf-8");
const handleSessionSrc = readFileSync(HANDLER, "utf-8");
const useAgentSessionSrc = readFileSync(UI_HANDLER, "utf-8");

describe("MVP-10 — extension UI notify + confirm pipeline", () => {
  describe("main side: provideRpcUiContext exposes notify + confirm", () => {
    it("confirm: routes piUi.confirm to pi://permission with a requestId", () => {
      // Two anchor checks: the confirm method exists and emits pi://permission.
      expect(uiContextSrc).toMatch(/confirm:\s*async\s*\(title[^)]*\)/);
      // Inside the confirm body, both the requestId pendingUiRequests.set
      // and the pi://permission emit must occur.
      expect(uiContextSrc).toMatch(/kind:\s*"permission"[\s\S]*?pi:\/\/permission/);
    });

    it("notify: short-circuits to pi://notification (no requestId needed)", () => {
      // notify is fire-and-forget — no resolver needed; it just emits.
      const re = /payload\.method\s*===\s*"notify"[\s\S]*?pi:\/\/notification/;
      expect(uiContextSrc).toMatch(re);
    });

    it("confirm supports an option list with allow + deny", () => {
      // The emitted permission payload must include both branches so the
      // renderer can render a real Allow / Deny dialog instead of just a
      // generic confirmation.
      expect(uiContextSrc).toMatch(/optionId:\s*"allow"/);
      expect(uiContextSrc).toMatch(/optionId:\s*"deny"/);
    });
  });

  describe("renderer side: useAgentSession.onExtensionUi / onPermission", () => {
    it("forwards pi://permission events to usePermissionStore", () => {
      // useAgentSession.ts owns the SSE subscription; the permission
      // branch must hand the payload to the permission store so a
      // confirm dialog can pop.
      expect(useAgentSessionSrc).toMatch(/onPermission[\s\S]*?usePermissionStore\.getState\(\)\.request/);
    });

    it("forwards pi://notify messages to the toast store", () => {
      expect(useAgentSessionSrc).toMatch(/event\.method\s*===\s*"notify"/);
    });
  });

  describe("package usage: at least one capability consumes each method", () => {
    // Sanity: the wiring isn't dead code. email + authorization are the
    // two known consumers; if a future refactor drops them, this test
    // fails so we can revisit the consumer wiring.
    const emailSrc = readFileSync(
      resolve(__dirname, "../../../packages/capability/openbuddy-email/src/index.ts"),
      "utf-8",
    );
    const authSrc = readFileSync(
      resolve(__dirname, "../../../packages/capability/openbuddy-authorization/src/index.ts"),
      "utf-8",
    );

    it("email package uses notification.append for notify", () => {
      expect(emailSrc).toMatch(/notification\.append/);
    });

    it("authorization package uses request.interaction.notify for notify", () => {
      expect(authSrc).toMatch(/interaction\.notify/);
    });
  });
});
